import { execFile, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PathError } from '../src/core/folder/path'
import type { SyntaxReport } from '../src/platform/types'
import { resolveInside } from './nodeFolder'
import {
  ahkCheckCommand,
  CHECK_TIMEOUT_MS,
  checkSyntax,
  parseAhkErrors,
  parsePsErrors,
  PS_PARSE_QUERY,
} from './syntax'

const ROOT = 'D:\\omb'
const AHK_EXE = 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe'

type Callback = (error: unknown, stdout: string, stderr: string) => void

/** A stand-in for execFile that records its calls and answers with `reply`; it starts no process. */
function fakeExec(reply: { error?: unknown; stdout?: string; stderr?: string }) {
  const exec = vi.fn((_file: string, _args: string[], _opts: Record<string, unknown>, cb: Callback) => {
    cb(reply.error ?? null, reply.stdout ?? '', reply.stderr ?? '')
    return {}
  })
  return exec
}

describe('parseAhkErrors', () => {
  it('parses AutoHotkey errors into relative paths and lines', () => {
    const output = [
      'D:\\omb\\ahk\\commands\\custom\\chrome.ahk (12) : ==> This line does not contain a recognized action.',
      'd:\\OMB\\ahk\\main.ahk (3) : ==> Missing "}"',
      'C:\\elsewhere\\lib.ahk (7) : ==> Unexpected "{"',
      '',
    ].join('\r\n')
    expect(parseAhkErrors(output, ROOT)).toEqual([
      { path: 'ahk/commands/custom/chrome.ahk', line: 12, message: 'This line does not contain a recognized action.' },
      { path: 'ahk/main.ahk', line: 3, message: 'Missing "}"' },
      { path: 'C:\\elsewhere\\lib.ahk', line: 7, message: 'Unexpected "{"' },
    ])
  })

  it('joins a Specifically line to its message', () => {
    // As AutoHotkey 2.0.19 writes it to stderr: LF line endings, the Specifically line indented.
    const output = 'D:\\omb\\local\\ahk\\sub.ahk (3) : ==> Missing ")"\n     Specifically: if (x { MsgBox "hi" }\n'
    expect(parseAhkErrors(output, ROOT)).toEqual([
      { path: 'local/ahk/sub.ahk', line: 3, message: 'Missing ")" Specifically: if (x { MsgBox "hi" }' },
    ])
  })

  it('needs the long-path root, since AutoHotkey reports long paths', () => {
    // Even when started through an 8.3 short path; the IPC handler passes a realpath'd root.
    const line = 'C:\\Users\\someone\\Repo\\omb\\ahk\\main.ahk (3) : ==> Missing ")"\n'
    expect(parseAhkErrors(line, 'C:\\Users\\someone\\Repo\\omb')).toEqual([
      { path: 'ahk/main.ahk', line: 3, message: 'Missing ")"' },
    ])
    expect(parseAhkErrors(line, 'C:\\Users\\SOMEON~1\\Repo\\omb')[0].path).toBe(
      'C:\\Users\\someone\\Repo\\omb\\ahk\\main.ahk',
    )
  })

  it('keeps output it cannot parse as one problem', () => {
    expect(parseAhkErrors('\r\n  Error: something odd happened\r\n', ROOT)).toEqual([
      { path: null, line: null, message: 'Error: something odd happened' },
    ])
    expect(parseAhkErrors('  \r\n', ROOT)).toEqual([])
  })
})

describe('parsePsErrors', () => {
  it("parses the PowerShell parser's JSON, including []", () => {
    const rel = 'local/powershell/commands/mine.ps1'
    expect(parsePsErrors('[]\r\n', rel)).toEqual([])
    expect(parsePsErrors('[{"line":3,"message":"Missing closing \'}\'."}]', rel)).toEqual([
      { path: rel, line: 3, message: "Missing closing '}'." },
    ])
    expect(parsePsErrors('[{"line":1,"message":"a"},{"line":4,"message":"b"}]', rel)).toEqual([
      { path: rel, line: 1, message: 'a' },
      { path: rel, line: 4, message: 'b' },
    ])
  })
})

describe('PS_PARSE_QUERY', () => {
  it('sets UTF-8 output, parses the file named by OMB_CHECK_FILE and keeps arrays as arrays', () => {
    expect(PS_PARSE_QUERY.indexOf('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)')).toBe(0)
    expect(PS_PARSE_QUERY).toContain('[System.Management.Automation.Language.Parser]::ParseFile($env:OMB_CHECK_FILE')
    expect(PS_PARSE_QUERY).toContain('ConvertTo-Json -InputObject @(')
    expect(PS_PARSE_QUERY).toContain('-Compress')
  })
})

describe('ahkCheckCommand', () => {
  it('validates main.ahk, so every include loads', () => {
    expect(ahkCheckCommand(AHK_EXE, ROOT)).toEqual({
      file: AHK_EXE,
      args: ['/ErrorStdOut=UTF-8', '/Validate', 'D:\\omb\\ahk\\main.ahk'],
    })
  })
})

describe('checkSyntax', () => {
  const win = { platform: 'win32' as const, env: {} }

  it('reports what AutoHotkey found, or no errors', async () => {
    const failed = Object.assign(new Error('Command failed'), { code: 2 })
    // AutoHotkey writes the error to stderr and exits with 2; stdout stays empty.
    const exec = fakeExec({ error: failed, stderr: 'D:\\omb\\ahk\\main.ahk (3) : ==> Missing "}"\n' })
    const report = await checkSyntax('ahk', ROOT, 'local/ahk/mine.ahk', { ...win, ahkExe: AHK_EXE, exec: exec as never })
    expect(report).toEqual({ ok: false, problems: [{ path: 'ahk/main.ahk', line: 3, message: 'Missing "}"' }] })
    expect(exec).toHaveBeenCalledTimes(1)
    const [file, args, opts] = exec.mock.calls[0]
    expect(file).toBe(AHK_EXE)
    expect(args).toEqual(['/ErrorStdOut=UTF-8', '/Validate', 'D:\\omb\\ahk\\main.ahk'])
    expect(opts).toMatchObject({ windowsHide: true, timeout: CHECK_TIMEOUT_MS })

    const clean = fakeExec({})
    expect(await checkSyntax('ahk', ROOT, 'local/ahk/mine.ahk', { ...win, ahkExe: AHK_EXE, exec: clean as never })).toEqual({
      ok: true,
    })
  })

  it('reports a timeout as skipped', async () => {
    // execFile kills the child when the timeout passes, and says so with killed.
    const exec = fakeExec({ error: Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }) })
    expect(await checkSyntax('ahk', ROOT, 'local/ahk/mine.ahk', { ...win, ahkExe: AHK_EXE, exec: exec as never })).toEqual({
      skipped: 'The syntax check did not finish within 10 seconds. AutoHotkey may be showing an error window.',
    })
    expect(exec.mock.calls[0][2]).toMatchObject({ timeout: 10_000 })
  })

  it('skips AutoHotkey when it is not installed', async () => {
    const exec = fakeExec({})
    expect(await checkSyntax('ahk', ROOT, 'local/ahk/mine.ahk', { ...win, ahkExe: null, exec: exec as never })).toEqual({
      skipped: 'AutoHotkey is not installed, so the syntax was not checked.',
    })
    // Nothing installed in the places the installer uses.
    expect(await checkSyntax('ahk', ROOT, 'local/ahk/mine.ahk', { ...win, exec: exec as never })).toEqual({
      skipped: 'AutoHotkey is not installed, so the syntax was not checked.',
    })
    expect(exec).not.toHaveBeenCalled()
  })

  it('skips away from Windows', async () => {
    const exec = fakeExec({})
    for (const lang of ['ahk', 'ps'] as const) {
      const report = await checkSyntax(lang, ROOT, 'x', { platform: 'linux', ahkExe: AHK_EXE, exec: exec as never })
      expect(report).toEqual({ skipped: 'The syntax check needs Windows.' })
    }
    expect(exec).not.toHaveBeenCalled()
  })

  it('passes the file to PowerShell through OMB_CHECK_FILE', async () => {
    const root = resolve('omb')
    const rel = 'local/powershell/commands/mine.ps1'
    const exec = fakeExec({ stdout: '[{"line":2,"message":"Unexpected token"}]' })
    const report = await checkSyntax('ps', root, rel, { platform: 'win32', env: { PATH: 'p' }, exec: exec as never })
    expect(report).toEqual({ ok: false, problems: [{ path: rel, line: 2, message: 'Unexpected token' }] })
    const [file, args, opts] = exec.mock.calls[0]
    const abs = resolveInside(root, rel)
    expect(file).toBe('powershell.exe')
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', PS_PARSE_QUERY])
    expect(args.join(' ')).not.toContain(abs)
    expect(opts).toMatchObject({ windowsHide: true, timeout: CHECK_TIMEOUT_MS, env: { PATH: 'p', OMB_CHECK_FILE: abs } })

    const clean = fakeExec({ stdout: '[]' })
    expect(await checkSyntax('ps', root, rel, { platform: 'win32', env: {}, exec: clean as never })).toEqual({ ok: true })
  })

  it('refuses a path outside the folder before anything runs', async () => {
    const exec = fakeExec({})
    await expect(checkSyntax('ps', resolve('omb'), '../x.ps1', { platform: 'win32', exec: exec as never })).rejects.toBeInstanceOf(
      PathError,
    )
    expect(exec).not.toHaveBeenCalled()
  })

  describe('when the check could not run', () => {
    const REASON = 'The syntax check could not run: '
    const PS_FILE = 'local/powershell/commands/a.ps1'

    it("says the check could not run when PowerShell ends with an error, in PowerShell's own words and never the command text", async () => {
      const failed = Object.assign(new Error(`Command failed: powershell.exe -Command ${PS_PARSE_QUERY}`), { code: 1 })
      const exec = fakeExec({ error: failed, stderr: String.raw`Could not find file C:\x\gone.ps1` + '\r\n' })
      const report = await checkSyntax('ps', ROOT, PS_FILE, { ...win, exec: exec as never })
      expect(report).toEqual({ skipped: String.raw`${REASON}Could not find file C:\x\gone.ps1.` })
      expect(JSON.stringify(report)).not.toContain('ParseFile')

      // PowerShell's own layout around an uncaught error: only its first line is the reason.
      const layout = [
        String.raw`Could not find file C:\x\gone.ps1`,
        'At line:1 char:1',
        `+ ${PS_PARSE_QUERY}`,
        '+ ~~~~~~~~',
        '    + CategoryInfo          : NotSpecified: (:) [], FileNotFoundException',
        '',
      ].join('\r\n')
      const wrapped = fakeExec({ error: failed, stderr: layout })
      expect(await checkSyntax('ps', ROOT, PS_FILE, { ...win, exec: wrapped as never })).toEqual({
        skipped: String.raw`${REASON}Could not find file C:\x\gone.ps1.`,
      })

      // Without a word on the error stream there is only the fact.
      const silent = fakeExec({ error: failed, stderr: ' \r\n' })
      expect(await checkSyntax('ps', ROOT, PS_FILE, { ...win, exec: silent as never })).toEqual({
        skipped: `${REASON}powershell.exe ended with an error.`,
      })
    })

    // The line says the reason and ends in one full stop of its own: PowerShell's trailing full stops go, the ones
    // inside stay, and a reason that was only full stops (and spaces) is no reason: the line then gives the same
    // words as when there is no line at all, never "could not run: .".
    it.each([
      ['gone.ps1.', 'gone.ps1'],
      ['gone.ps1...', 'gone.ps1'],
      ['a.b.', 'a.b'],
      ['a.b', 'a.b'],
      ['...', 'powershell.exe ended with an error'],
      ['. . .', 'powershell.exe ended with an error'],
      ['gone.ps1 . .', 'gone.ps1'],
      [`a${'.'.repeat(50_000)}b`, `a${'.'.repeat(50_000)}b`],
    ])("takes the trailing full stops off PowerShell's reason (%#)", async (stderr, reason) => {
      const failed = Object.assign(new Error('Command failed'), { code: 1 })
      const exec = fakeExec({ error: failed, stderr: `${stderr}\r\n` })
      expect(await checkSyntax('ps', ROOT, PS_FILE, { ...win, exec: exec as never })).toEqual({ skipped: `${REASON}${reason}.` })
    })

    it('says so when PowerShell cannot be started', async () => {
      const exec = fakeExec({ error: Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }) })
      expect(await checkSyntax('ps', ROOT, PS_FILE, { ...win, exec: exec as never })).toEqual({
        skipped: `${REASON}powershell.exe could not be started.`,
      })
    })

    it.each(['', 'Welcome to PowerShell', 'null'])('says so when its answer is not JSON of problems (%j)', async (stdout) => {
      const exec = fakeExec({ stdout })
      expect(await checkSyntax('ps', ROOT, PS_FILE, { ...win, exec: exec as never })).toEqual({
        skipped: `${REASON}its answer could not be read.`,
      })
    })

    it('tells output too long to read from a check that ran out of time', async () => {
      // Node kills the child when the output passes maxBuffer, and then sets killed too.
      const tooLong = Object.assign(new Error('maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true })
      const expected = { skipped: 'The syntax check wrote more than the app can read, so its result is not shown.' }
      for (const lang of ['ahk', 'ps'] as const) {
        const exec = fakeExec({ error: tooLong })
        expect(await checkSyntax(lang, ROOT, 'local/x', { ...win, ahkExe: AHK_EXE, exec: exec as never })).toEqual(expected)
      }
      const slow = fakeExec({ error: Object.assign(new Error('timed out'), { killed: true }) })
      expect(await checkSyntax('ps', ROOT, 'local/x', { ...win, exec: slow as never })).toEqual({
        skipped: 'The syntax check did not finish within 10 seconds.',
      })
    })

    it('says AutoHotkey could not be started when it failed without a word', async () => {
      const exec = fakeExec({ error: Object.assign(new Error(`spawn ${AHK_EXE} ENOENT`), { code: 'ENOENT' }) })
      expect(await checkSyntax('ahk', ROOT, 'local/ahk/mine.ahk', { ...win, ahkExe: AHK_EXE, exec: exec as never })).toEqual({
        skipped: 'AutoHotkey could not be started, so the syntax was not checked.',
      })
    })
  })
})

// These start the real, hidden powershell.exe (no window, no key sent) on files in a folder of their
// own. The first start of PowerShell can be slow on a fresh machine (a 2-core VM), and the check kills
// it after CHECK_TIMEOUT_MS, so beforeAll starts one first; each test also gets a long timeout.
describe.skipIf(process.platform !== 'win32')('checkSyntax with the real PowerShell', () => {
  const REAL_TIMEOUT_MS = 60_000
  const commands = 'powershell/commands'
  /** The app's other reasons for no result: a slow start must not pass for the one a test is about. */
  const OTHER_REASONS = /did not finish|wrote more than|could not be started|answer could not be read|ended with an error/
  let root = ''

  beforeAll(async () => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'omb-syntax-')))
    mkdirSync(join(root, commands), { recursive: true })
    // Warm-up: its result is ignored, only that PowerShell has started once.
    await new Promise<void>((done) => {
      const args = ['-NoProfile', '-NonInteractive', '-Command', 'exit']
      execFile('powershell.exe', args, { windowsHide: true, timeout: 50_000 }, () => done())
    })
  }, REAL_TIMEOUT_MS)
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** The line of a check that could not run; fails the test for any other answer or any other reason. */
  function skippedReason(report: SyntaxReport): string {
    expect(report).toEqual({ skipped: expect.any(String) })
    const { skipped } = report as { skipped: string }
    expect(skipped.startsWith('The syntax check could not run: ')).toBe(true)
    expect(skipped.endsWith('.')).toBe(true)
    expect(skipped).not.toMatch(OTHER_REASONS)
    expect(skipped).not.toContain('ParseFile')
    expect(skipped).not.toContain('OMB_CHECK_FILE')
    return skipped
  }

  it(
    'does not call a file that is not there clean, with the real PowerShell',
    async () => {
      // A name with a letter outside ASCII also proves the error stream is read as UTF-8.
      const skipped = skippedReason(await checkSyntax('ps', root, `${commands}/gône.ps1`))
      expect(skipped).toContain(join(root, commands, 'gône.ps1'))
      // PowerShell writes two full stops after the path; the line has one.
      expect(skipped.endsWith('..')).toBe(false)
    },
    REAL_TIMEOUT_MS,
  )

  it(
    'finds the error in a real file, and none in a sound one',
    async () => {
      writeFileSync(join(root, commands, 'broken.ps1'), 'function A {')
      writeFileSync(join(root, commands, 'sound.ps1'), 'function A { }')
      const broken = await checkSyntax('ps', root, `${commands}/broken.ps1`)
      expect(broken).toMatchObject({ ok: false, problems: [{ path: `${commands}/broken.ps1`, line: 1 }] })
      expect((broken as { problems: unknown[] }).problems).toHaveLength(1)
      expect(await checkSyntax('ps', root, `${commands}/sound.ps1`)).toEqual({ ok: true })
    },
    REAL_TIMEOUT_MS,
  )

  it(
    'does not call a file that another program holds open clean',
    async () => {
      const file = join(root, commands, 'locked.ps1')
      writeFileSync(file, 'function A { }')
      const holder = await holdOpen(file)
      try {
        const skipped = skippedReason(await checkSyntax('ps', root, `${commands}/locked.ps1`))
        expect(skipped).toContain(file)
      } finally {
        await holder.release()
      }
    },
    REAL_TIMEOUT_MS,
  )
})

/**
 * A hidden PowerShell that holds `file` open with no sharing until released. Resolves once it says it
 * holds the file; when it cannot be started, ends early or is too slow, it is ended and this rejects.
 */
async function holdOpen(file: string): Promise<{ release: () => Promise<void> }> {
  const holder = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$h = [System.IO.File]::Open($env:OMB_HOLD_FILE, 'Open', 'Read', 'None'); [Console]::Out.WriteLine('held'); Start-Sleep -Seconds 120",
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, OMB_HOLD_FILE: file } },
  )
  // Settles when the process has ended, or could not be started at all (then no exit comes).
  const ended = new Promise<void>((done) => {
    holder.once('exit', () => done())
    holder.once('error', () => done())
  })
  const release = async () => {
    holder.kill()
    await ended
  }
  try {
    await new Promise<void>((held, failed) => {
      const timer = setTimeout(() => failed(new Error('the holder did not hold the file in time')), 30_000)
      const settle = (done: () => void) => {
        clearTimeout(timer)
        done()
      }
      holder.once('error', (e) => settle(() => failed(e)))
      holder.once('exit', () => settle(() => failed(new Error('the holder ended before it held the file'))))
      holder.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('held')) settle(held)
      })
    })
  } catch (e) {
    await release()
    throw e
  }
  return { release }
}
