import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LangId } from '../src/core/languages'

// Finds the running macropad and starts it again. No electron imports here, so the
// module can be unit-tested in plain Node.

export interface ProcInfo {
  name: string
  pid: number
  exe: string | null
  commandLine: string | null
}

export interface FoundMacropad {
  lang: LangId
  exe: string
}

/** Win32_Process rows as ConvertTo-Json writes them: an object for one result, an array for more. */
export function parseProcessList(json: string): ProcInfo[] {
  if (json.trim() === '') return []
  const parsed: unknown = JSON.parse(json)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.map((row: Record<string, unknown>) => ({
    name: String(row.Name ?? ''),
    pid: Number(row.ProcessId ?? 0),
    exe: typeof row.ExecutablePath === 'string' ? row.ExecutablePath : null,
    commandLine: typeof row.CommandLine === 'string' ? row.CommandLine : null,
  }))
}

/** Quotes dropped, slashes made backslashes, lower case, no trailing backslash. */
function comparable(path: string): string {
  return path.replaceAll('"', '').replaceAll('/', '\\').trim().toLowerCase().replace(/\\+$/, '')
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/**
 * Which macropad runs from `root`? Like Instance.ps1, only the macropad's own script counts:
 * an editor with main.ahk open, or a copy somewhere else, is not it. Pass a root that went
 * through realpath, so 8.3 short names match the long names in the command lines.
 */
export function findMacropad(procs: ProcInfo[], root: string): FoundMacropad | null {
  const base = comparable(root)
  const ahkScript = escapeRegExp(`${base}\\ahk\\main.ahk`)
  const psScript = escapeRegExp(`${base}\\powershell\\main.ps1`)
  const ahkLine = new RegExp(String.raw`(^|\s)${ahkScript}$`)
  const psLine = new RegExp(String.raw`(^|\s)-file\s+${psScript}(\s|$)`)

  for (const p of procs) {
    if (!p.commandLine) continue
    const line = comparable(p.commandLine)
    const name = p.name.toLowerCase()
    if (name.startsWith('autohotkey') && p.exe && ahkLine.test(line)) return { lang: 'ahk', exe: p.exe }
  }
  for (const p of procs) {
    if (!p.commandLine) continue
    if (p.name.toLowerCase() === 'powershell.exe' && psLine.test(comparable(p.commandLine))) {
      return { lang: 'ps', exe: p.exe ?? 'powershell.exe' }
    }
  }
  return null
}

/** What starts the macropad again; both runtimes replace the copy that is running. */
export function relaunchCommand(found: FoundMacropad, root: string): { file: string; args: string[] } {
  const base = root.replace(/[\\/]+$/, '')
  if (found.lang === 'ahk') return { file: found.exe, args: [`${base}\\ahk\\main.ahk`] }
  return { file: 'wscript.exe', args: [`${base}\\powershell\\launch.vbs`] }
}

type Spawn = typeof nodeSpawn

/** Starts it detached and never waits for it. */
export function relaunch(found: FoundMacropad, root: string, spawn: Spawn = nodeSpawn): void {
  const { file, args } = relaunchCommand(found, root)
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

/**
 * Windows PowerShell 5.1 writes redirected output in the OEM code page, which Node would read
 * as UTF-8 and turn any non-ASCII character of a path (a user name such as José) into U+FFFD.
 * Setting the console output encoding first, without a byte-order mark, makes both sides UTF-8.
 */
export const PROCESS_QUERY =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  `Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoHotkey%' OR Name = 'powershell.exe'" | ` +
  'Select-Object Name,ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'

/** The AutoHotkey and PowerShell processes that run now; [] away from Windows. */
export function listProcesses(): Promise<ProcInfo[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PROCESS_QUERY],
      { windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        try {
          resolve(parseProcessList(stdout))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      },
    )
  })
}

/** AutoHotkey v2 in the places its installer uses. */
export function autoHotkeyInstalled(env: NodeJS.ProcessEnv): boolean {
  const candidates: string[] = []
  if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, 'AutoHotkey', 'v2', 'AutoHotkey64.exe'))
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'AutoHotkey', 'v2', 'AutoHotkey64.exe'))
  return candidates.some((file) => existsSync(file))
}
