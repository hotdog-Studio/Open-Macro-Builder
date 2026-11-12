import { execFile, type ExecFileException } from 'node:child_process'
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

/** Validates main.ahk rather than the saved file, so every include loads as the macropad loads it. */
export function ahkCheckCommand(exe: string, root: string): { file: string; args: string[] } {
  return { file: exe, args: ['/ErrorStdOut=UTF-8', '/Validate', `${root}\\ahk\\main.ahk`] }
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
 */
export const PS_PARSE_QUERY =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  '$errors = $null; ' +
  '[void][System.Management.Automation.Language.Parser]::ParseFile($env:OMB_CHECK_FILE, [ref]$null, [ref]$errors); ' +
  'ConvertTo-Json -InputObject @($errors | ForEach-Object { @{ line = $_.Extent.StartLineNumber; message = $_.Message } }) -Compress'

/** The PowerShell parser's errors, from PS_PARSE_QUERY's JSON, all in the file at `rel`. */
export function parsePsErrors(json: string, rel: string): SyntaxProblem[] {
  const parsed: unknown = JSON.parse(json)
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as { line?: unknown; message?: unknown }[]
  return rows.map((row) => ({
    path: rel,
    line: typeof row.line === 'number' ? row.line : null,
    message: String(row.message ?? ''),
  }))
}

type Exec = typeof execFile

interface Ran {
  error: ExecFileException | null
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
 * Checks the syntax of the command file at `rel` in the folder `root`. Throws for a path outside
 * the folder before anything runs, and when the checker could not run at all.
 */
export async function checkSyntax(lang: LangId, root: string, rel: string, deps: CheckDeps = {}): Promise<SyntaxReport> {
  const abs = resolveInside(root, rel)
  const { exec = execFile, env = process.env, platform = process.platform } = deps
  if (platform !== 'win32') return { skipped: NEEDS_WINDOWS }

  if (lang === 'ahk') {
    const exe = deps.ahkExe === undefined ? findAutoHotkey(env) : deps.ahkExe
    if (!exe) return { skipped: NOT_INSTALLED }
    const { file, args } = ahkCheckCommand(exe, root)
    const { error, stdout, stderr } = await run(exec, file, args, env)
    if (error?.killed) return { skipped: AHK_TOO_SLOW }
    if (!error) return { ok: true }
    const problems = parseAhkErrors(`${stdout}\n${stderr}`, root)
    // Failed without a word: AutoHotkey did not run at all.
    if (problems.length === 0) throw error
    return { ok: false, problems }
  }

  const args = ['-NoProfile', '-NonInteractive', '-Command', PS_PARSE_QUERY]
  const { error, stdout } = await run(exec, 'powershell.exe', args, { ...env, OMB_CHECK_FILE: abs })
  if (error?.killed) return { skipped: TOO_SLOW }
  if (error) throw error
  const problems = parsePsErrors(stdout, rel)
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}
