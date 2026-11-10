import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  autoHotkeyInstalled,
  findMacropad,
  parseProcessList,
  PROCESS_QUERY,
  relaunch,
  relaunchCommand,
  type ProcInfo,
} from './macropad'

const AHK_EXE = 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe'

function ahk(root: string): ProcInfo {
  return {
    name: 'AutoHotkey64.exe',
    pid: 10,
    exe: AHK_EXE,
    commandLine: `"${AHK_EXE}" /ErrorStdOut "${root}\\ahk\\main.ahk"`,
  }
}

function ps(commandLine: string): ProcInfo {
  return { name: 'powershell.exe', pid: 20, exe: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', commandLine }
}

describe('parseProcessList', () => {
  it('accepts a single object as well as an array', () => {
    const one = '{"Name":"a.exe","ProcessId":1,"ExecutablePath":"C:\\\\a.exe","CommandLine":"a"}'
    expect(parseProcessList(one)).toEqual([{ name: 'a.exe', pid: 1, exe: 'C:\\a.exe', commandLine: 'a' }])
    const many = `[${one},{"Name":"b.exe","ProcessId":2,"ExecutablePath":null,"CommandLine":null}]`
    expect(parseProcessList(many)).toEqual([
      { name: 'a.exe', pid: 1, exe: 'C:\\a.exe', commandLine: 'a' },
      { name: 'b.exe', pid: 2, exe: null, commandLine: null },
    ])
  })

  it('gives an empty list for empty output', () => {
    expect(parseProcessList('')).toEqual([])
    expect(parseProcessList('  \r\n')).toEqual([])
  })
})

describe('process list query', () => {
  it('sets UTF-8 output (no BOM) before it reads the processes', () => {
    const utf8 = PROCESS_QUERY.indexOf('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)')
    expect(utf8).toBe(0)
    expect(PROCESS_QUERY.indexOf('Get-CimInstance')).toBeGreaterThan(utf8)
    expect(PROCESS_QUERY).toContain("Name LIKE 'AutoHotkey%' OR Name = 'powershell.exe'")
  })
})

describe('parseProcessList with non-ASCII paths', () => {
  it('parseProcessList keeps non-ASCII paths', () => {
    const commandLine = '"C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe" "C:\\Users\\José\\omb\\ahk\\main.ahk"'
    const json = JSON.stringify({ Name: 'AutoHotkey64.exe', ProcessId: 5, ExecutablePath: AHK_EXE, CommandLine: commandLine })
    const procs = parseProcessList(json)
    expect(procs[0].commandLine).toBe(commandLine)
    expect(findMacropad(procs, 'C:\\Users\\José\\omb')).toEqual({ lang: 'ahk', exe: AHK_EXE })
  })
})

describe('findMacropad', () => {
  it('finds the AutoHotkey macropad that runs from the folder', () => {
    expect(findMacropad([ahk('D:\\omb')], 'D:\\omb')).toEqual({ lang: 'ahk', exe: AHK_EXE })
  })

  it('compares case-insensitively, ignores quotes and accepts forward slashes and a trailing slash', () => {
    expect(findMacropad([ahk('d:\\OMB')], 'D:\\omb\\')).toEqual({ lang: 'ahk', exe: AHK_EXE })
    expect(findMacropad([ahk('D:/omb')], 'D:\\Omb')).toEqual({ lang: 'ahk', exe: AHK_EXE })
  })

  it('finds the PowerShell macropad', () => {
    const p = ps('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "d:\\OMB\\powershell\\main.ps1"')
    expect(findMacropad([p], 'D:\\omb')).toEqual({ lang: 'ps', exe: p.exe })
  })

  it('does not take a copy in another folder for it', () => {
    const other = [
      ahk('D:\\other'),
      ps('powershell.exe -NoProfile -File "D:\\other\\powershell\\main.ps1"'),
      ahk('D:\\other\\D:\\omb'),
    ]
    expect(findMacropad(other, 'D:\\omb')).toBeNull()
  })

  it('does not take an editor, another script or another program for it', () => {
    const procs: ProcInfo[] = [
      { name: 'AutoHotkey64.exe', pid: 1, exe: AHK_EXE, commandLine: `"${AHK_EXE}" "D:\\omb\\ahk\\other.ahk"` },
      { name: 'Code.exe', pid: 2, exe: 'C:\\Code.exe', commandLine: '"Code.exe" "D:\\omb\\ahk\\main.ahk"' },
      ps('powershell.exe -NoProfile -Command "Get-Content D:\\omb\\powershell\\main.ps1"'),
      ps('powershell.exe -File "D:\\omb\\powershell\\main.ps1.bak"'),
      { name: 'AutoHotkey64.exe', pid: 3, exe: null, commandLine: null },
    ]
    expect(findMacropad(procs, 'D:\\omb')).toBeNull()
  })

  it('finds the macropad among other processes', () => {
    const procs = [ps('powershell.exe'), ahk('D:\\omb')]
    expect(findMacropad(procs, 'D:\\omb')?.lang).toBe('ahk')
  })
})

describe('relaunchCommand', () => {
  it('runs main.ahk with the AutoHotkey that is running, and launch.vbs for PowerShell', () => {
    expect(relaunchCommand({ lang: 'ahk', exe: AHK_EXE }, 'D:\\omb')).toEqual({
      file: AHK_EXE,
      args: ['D:\\omb\\ahk\\main.ahk'],
    })
    expect(relaunchCommand({ lang: 'ps', exe: 'powershell.exe' }, 'D:\\omb')).toEqual({
      file: 'wscript.exe',
      args: ['D:\\omb\\powershell\\launch.vbs'],
    })
  })
})

describe('relaunch', () => {
  it('starts it detached, hidden and unwaited', () => {
    const child = { unref: vi.fn() }
    const spawn = vi.fn(() => child)
    relaunch({ lang: 'ahk', exe: AHK_EXE }, 'D:\\omb', spawn as never)
    expect(spawn).toHaveBeenCalledWith(AHK_EXE, ['D:\\omb\\ahk\\main.ahk'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    expect(child.unref).toHaveBeenCalledTimes(1)
  })
})

describe('autoHotkeyInstalled', () => {
  const made: string[] = []
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function tree(...parts: string[]): string {
    const base = mkdtempSync(join(tmpdir(), 'omb-ahk-'))
    made.push(base)
    mkdirSync(join(base, ...parts.slice(0, -1)), { recursive: true })
    writeFileSync(join(base, ...parts), '')
    return base
  }

  it('finds AutoHotkey v2 under Program Files or the local Programs folder', () => {
    const pf = tree('AutoHotkey', 'v2', 'AutoHotkey64.exe')
    expect(autoHotkeyInstalled({ ProgramFiles: pf })).toBe(true)
    const local = tree('Programs', 'AutoHotkey', 'v2', 'AutoHotkey64.exe')
    expect(autoHotkeyInstalled({ LOCALAPPDATA: local })).toBe(true)
  })

  it('is false when it is not there', () => {
    const empty = mkdtempSync(join(tmpdir(), 'omb-ahk-'))
    made.push(empty)
    expect(autoHotkeyInstalled({ ProgramFiles: empty, LOCALAPPDATA: empty })).toBe(false)
    expect(autoHotkeyInstalled({})).toBe(false)
  })
})
