import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PathError } from '../src/core/folder/path'
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
    const output =
      'D:\\omb\\local\\ahk\\mine.ahk (5) : ==> Call to nonexistent function.\n     Specifically: Foo()\n' +
      'D:\\omb\\local\\ahk\\mine.ahk (9) : ==> Missing ")"\n'
    expect(parseAhkErrors(output, ROOT)).toEqual([
      { path: 'local/ahk/mine.ahk', line: 5, message: 'Call to nonexistent function. Specifically: Foo()' },
      { path: 'local/ahk/mine.ahk', line: 9, message: 'Missing ")"' },
    ])
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
    const exec = fakeExec({ error: failed, stdout: 'D:\\omb\\ahk\\main.ahk (3) : ==> Missing "}"\n' })
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
})
