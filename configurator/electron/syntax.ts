import { execFile, type ExecException } from 'node:child_process'
import { win32 } from 'node:path'
import type { LangId } from '../src/core/languages'
import type { SyntaxProblem, SyntaxReport } from '../src/platform/types'
import { findAutoHotkey } from './macropad'
import { resolveInside } from './nodeFolder'

// Runs a command file's syntax check. No electron imports here, so the module can be
// unit-tested in plain Node; every test injects exec and platform, so none starts a process.

/** AutoHotkey shows a dialog for some errors even with /ErrorStdOut; the check gives up after this. */
export const CHECK_TIMEOUT_MS = 10_000

const NOT_INSTALLED = 'AutoHotkey is not installed, so the syntax was not checked.'
const NEEDS_WINDOWS = 'The syntax check needs Windows.'
const TOO_SLOW = 'The syntax check did not finish within 10 seconds.'
const AHK_TOO_SLOW = `${TOO_SLOW} AutoHotkey may be showing an error window.`
const TOO_MUCH_OUTPUT = 'The syntax check wrote more than the app can read, so its result is not shown.'
const AHK_NOT_STARTED = 'AutoHotkey could not be started, so the syntax was not checked.'
const COULD_NOT_RUN = 'The syntax check could not run'
const POWERSHELL_NOT_STARTED = `${COULD_NOT_RUN}: powershell.exe could not be started.`
const ANSWER_UNREADABLE = `${COULD_NOT_RUN}: its answer could not be read.`

/** Validates main.ahk rather than the saved file, so every include loads as the macropad loads it. */
export function ahkCheckCommand(exe: string, root: string): { file: string; args: string[] } {
  return { file: exe, args: ['/ErrorStdOut=UTF-8', '/Validate', String.raw`${root}\ahk\main.ahk`] }
}

/** `<file> (<line>) : ==> <message>`, as AutoHotkey writes a load-time error. */
const AHK_ERROR = /^(.+) \((\d+)\) : ==> (.*)$/
const SPECIFICALLY = /^\s*Specifically:/

/** A path inside `root` made folder-relative with /; any other path as AutoHotkey printed it. */
function folderPath(file: string, root: string): string {
  const rel = win32.relative(root, file)
  if (rel === '' || rel === '..' || rel.startsWith('..\\') || win32.isAbsolute(rel)) return file
  return rel.replaceAll('\\', '/')
}

/**
 * The problems in AutoHotkey's /ErrorStdOut output: one per error line, with a following
 * `Specifically: …` line joined to its message. Output with no error line is kept as one problem.
 */
export function parseAhkErrors(output: string, root: string): SyntaxProblem[] {
  const problems: SyntaxProblem[] = []
  for (const line of output.split(/\r?\n/)) {
    const error = AHK_ERROR.exec(line)
    const last = problems.at(-1)
    if (error) problems.push({ path: folderPath(error[1], root), line: Number(error[2]), message: error[3].trim() })
    else if (last && SPECIFICALLY.test(line)) last.message = `${last.message} ${line.trim()}`
  }
  const rest = output.trim()
  if (problems.length === 0 && rest !== '') return [{ path: null, line: null, message: rest }]
  return problems
}

/**
 * Parses the file named by OMB_CHECK_FILE and prints its errors as JSON. The path never goes into
 * the command text, so no quoting in it can change the command. UTF-8 without a byte-order mark,
 * as PROCESS_QUERY explains; -InputObject keeps [] and a one-item array as arrays.
 * A file the parser cannot read (gone, locked by another program) is not thrown: the parser lists it
 * as a FileReadError among the errors, on line 0, which would pass for a syntax error in the file.
 * It is written alone to the error stream, as the one line powershellReason takes, with exit 1; so is
 * any exception the parse throws, by the catch (innermost message). Left to PowerShell, an uncaught
 * error comes wrapped in its own layout.
 */
export const PS_PARSE_QUERY =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  'try { ' +
  '$errors = $null; ' +
  '[void][System.Management.Automation.Language.Parser]::ParseFile($env:OMB_CHECK_FILE, [ref]$null, [ref]$errors); ' +
  "$unread = $errors | Where-Object { $_.ErrorId -eq 'FileReadError' } | Select-Object -First 1; " +
  'if ($unread) { [Console]::Error.WriteLine($unread.Message); exit 1 } ' +
  'ConvertTo-Json -InputObject @($errors | ForEach-Object { @{ line = $_.Extent.StartLineNumber; message = $_.Message } }) -Compress ' +
  '} catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; [Console]::Error.WriteLine($e.Message); exit 1 }'

/** The PowerShell parser's errors, from PS_PARSE_QUERY's JSON, all in the file at `rel`. */
export function parsePsErrors(json: string, rel: string): SyntaxProblem[] {
  const parsed: unknown = JSON.parse(json)
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as { line?: unknown; message?: unknown }[]
  return rows.map((row) => ({
    path: rel,
    line: typeof row.line === 'number' ? row.line : null,
    message: typeof row.message === 'string' ? row.message : '',
  }))
}

type Exec = typeof execFile

interface Ran {
  error: ExecException | null
  stdout: string
  stderr: string
}

/** Runs a check hidden; execFile kills it when CHECK_TIMEOUT_MS passes, and sets error.killed. */
function run(exec: Exec, file: string, args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve) => {
    exec(
      file,
      args,
      { windowsHide: true, timeout: CHECK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    )
  })
}

export interface CheckDeps {
  exec?: Exec
  env?: NodeJS.ProcessEnv
  /** The AutoHotkey to run; null when there is none. Left out, it is looked for with findAutoHotkey. */
  ahkExe?: string | null
  platform?: NodeJS.Platform
}

/**
 * Why a check that was cut short has no result: too much output, too little time, or null when
 * the checker ended by itself. The output limit comes first, as exceeding it kills the child too.
 */
function cutShort(error: ExecException | null, tooSlow: string): string | null {
  if (!error) return null
  if ((error as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return TOO_MUCH_OUTPUT
  return error.killed ? tooSlow : null
}

/** PowerShell's words for why it ended with an error: the first line of its error stream that is not empty, without its full stop(s). */
function powershellReason(stderr: string): string {
  const first = stderr.split(/\r?\n/).find((line) => line.trim() !== '')
  if (first === undefined) return 'powershell.exe ended with an error'
  // Not `.replace(/\.+$/, '')`: that backtracks quadratically on a long run of dots that does not end the line.
  const reason = first.trim()
  let end = reason.length
  while (end > 0 && reason[end - 1] === '.') end--
  return reason.slice(0, end)
}

async function checkAhk(root: string, exe: string, exec: Exec, env: NodeJS.ProcessEnv): Promise<SyntaxReport> {
  const { file, args } = ahkCheckCommand(exe, root)
  const { error, stdout, stderr } = await run(exec, file, args, env)
  const stopped = cutShort(error, AHK_TOO_SLOW)
  if (stopped !== null) return { skipped: stopped }
  if (!error) return { ok: true }
  const problems = parseAhkErrors(`${stdout}\n${stderr}`, root)
  // Failed without a word: AutoHotkey did not run at all.
  if (problems.length === 0) return { skipped: AHK_NOT_STARTED }
  return { ok: false, problems }
}

async function checkPowerShell(abs: string, rel: string, exec: Exec, env: NodeJS.ProcessEnv): Promise<SyntaxReport> {
  const args = ['-NoProfile', '-NonInteractive', '-Command', PS_PARSE_QUERY]
  const { error, stdout, stderr } = await run(exec, 'powershell.exe', args, { ...env, OMB_CHECK_FILE: abs })
  const stopped = cutShort(error, TOO_SLOW)
  if (stopped !== null) return { skipped: stopped }
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') return { skipped: POWERSHELL_NOT_STARTED }
  // Never the error's own message: for a failed start it is the whole command text.
  if (error) return { skipped: `${COULD_NOT_RUN}: ${powershellReason(stderr)}.` }
  let problems: SyntaxProblem[]
  try {
    problems = parsePsErrors(stdout, rel)
  } catch {
    return { skipped: ANSWER_UNREADABLE }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/**
 * Checks the syntax of the command file at `rel` in the folder `root`. Throws only for a path
 * outside the folder, before anything runs. Whenever the checker could not run, or could not read
 * the file, it resolves to `{ skipped }` with a line a person can read.
 */
export async function checkSyntax(lang: LangId, root: string, rel: string, deps: CheckDeps = {}): Promise<SyntaxReport> {
  const abs = resolveInside(root, rel)
  const { exec = execFile, env = process.env, platform = process.platform } = deps
  if (platform !== 'win32') return { skipped: NEEDS_WINDOWS }

  if (lang === 'ahk') {
    const exe = deps.ahkExe === undefined ? findAutoHotkey(env) : deps.ahkExe
    if (!exe) return { skipped: NOT_INSTALLED }
    return checkAhk(root, exe, exec, env)
  }
  return checkPowerShell(abs, rel, exec, env)
}
