import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The fake ipcMain keeps the handlers registerIpc installs, so a test can call a channel the way
// Electron would: with an event whose sender is some web contents.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>(),
  removed: [] as string[],
  openDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => {
      electron.removed.push(channel)
      electron.handlers.delete(channel)
    },
  },
  dialog: { showOpenDialog: electron.openDialog },
}))

// Starting processes and asking Windows what runs are the only parts faked: path handling, the
// remembered-folder file and the folder itself are the real modules over a temp directory.
const macropad = vi.hoisted(() => ({
  listProcesses: vi.fn(),
  relaunch: vi.fn(),
  autoHotkeyInstalled: vi.fn(),
  findAutoHotkey: vi.fn(),
}))
vi.mock('./macropad', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./macropad')>()),
  ...macropad,
}))

const syntax = vi.hoisted(() => ({ checkSyntax: vi.fn() }))
vi.mock('./syntax', () => syntax)

const watch = vi.hoisted(() => ({ watchFiles: vi.fn() }))
vi.mock('./watch', () => watch)

import { CHANNELS } from './channels'
import { registerIpc } from './ipc'

const bytes = (s: string) => new TextEncoder().encode(s)

let dir: string
let root: string
let storeFile: string
let dispose: () => void
let sent: Array<[string, string]>
let destroyed: boolean
const win = {
  webContents: {
    id: 'page',
    send: (channel: string, rel: string) => sent.push([channel, rel]),
  },
  isDestroyed: () => destroyed,
}

/** Calls a channel as the window's own page does. */
function call(channel: string, ...args: unknown[]) {
  return Promise.resolve().then(() => electron.handlers.get(channel)!({ sender: win.webContents }, ...args))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omb-ipc-'))
  root = join(dir, 'macropad_ahk')
  await mkdir(root)
  storeFile = join(dir, 'userData', 'omb-electron.json')
  sent = []
  destroyed = false
  electron.handlers.clear()
  electron.removed.length = 0
  electron.openDialog.mockReset()
  electron.openDialog.mockResolvedValue({ canceled: false, filePaths: [root] })
  for (const fn of [...Object.values(macropad), syntax.checkSyntax, watch.watchFiles]) fn.mockReset()
  macropad.listProcesses.mockResolvedValue([])
  watch.watchFiles.mockReturnValue(vi.fn())
  dispose = registerIpc(win as never, storeFile)
})

afterEach(async () => {
  dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('registerIpc', () => {
  it('answers every channel the preload invokes, and not the one it only receives', () => {
    const { changed, ...invoked } = CHANNELS
    expect([...electron.handlers.keys()].sort()).toEqual(Object.values(invoked).sort())
    expect(electron.handlers.has(changed)).toBe(false)
  })

  it('removes every handler when disposed, so a second window can register its own', () => {
    dispose()
    expect(electron.handlers.size).toBe(0)
    expect(electron.removed.sort()).toEqual(Object.values(CHANNELS).sort())
    dispose = registerIpc(win as never, storeFile)
    expect(electron.handlers.size).toBe(Object.keys(CHANNELS).length - 1)
  })

  it('refuses a request from any other web contents', async () => {
    for (const handler of electron.handlers.values()) {
      await expect(Promise.resolve().then(() => handler({ sender: { id: 'other' } }))).rejects.toThrow(
        'Refused: unknown sender',
      )
    }
    // Nothing happened on the way: the dialog never opened.
    expect(electron.openDialog).not.toHaveBeenCalled()
  })
})

describe('opening a folder', () => {
  it('asks for a directory, returns its name and remembers it', async () => {
    expect(await call(CHANNELS.openFolder)).toBe('macropad_ahk')
    expect(electron.openDialog).toHaveBeenCalledWith(win, { properties: ['openDirectory'] })
    expect(JSON.parse(await readFile(storeFile, 'utf8'))).toEqual({ lastFolder: root })
  })

  it('returns null and keeps the previous folder when the user cancels', async () => {
    await call(CHANNELS.openFolder)
    electron.openDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await call(CHANNELS.openFolder)).toBeNull()
    await writeFile(join(root, 'a.txt'), 'a')
    // Still the first folder.
    expect(await call(CHANNELS.list, '')).toEqual([{ name: 'a.txt', kind: 'file' }])
  })

  it('returns null when the dialog gives no path even though it was not cancelled', async () => {
    electron.openDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    expect(await call(CHANNELS.openFolder)).toBeNull()
  })

  it('does not remember a folder the user cancelled', async () => {
    electron.openDialog.mockResolvedValue({ canceled: true, filePaths: [root] })
    expect(await call(CHANNELS.openFolder)).toBeNull()
    expect(existsSync(storeFile)).toBe(false)
  })

  it('still opens the folder when it cannot be remembered', async () => {
    // A file where userData should be makes the store write fail.
    await writeFile(join(dir, 'userData'), 'in the way')
    expect(await call(CHANNELS.openFolder)).toBe('macropad_ahk')
    await writeFile(join(root, 'a.txt'), 'a')
    expect(await call(CHANNELS.list, '')).toHaveLength(1)
  })

  it('stops watching the old folder when another is opened', async () => {
    await call(CHANNELS.openFolder)
    const stop = vi.fn()
    watch.watchFiles.mockReturnValue(stop)
    await call(CHANNELS.watch, ['config.json'])
    await call(CHANNELS.openFolder)
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

describe('restoring the remembered folder', () => {
  it('returns null when nothing is remembered', async () => {
    expect(await call(CHANNELS.restoreFolder)).toBeNull()
  })

  it('reopens the remembered folder and holds it', async () => {
    await call(CHANNELS.openFolder)
    // A new window, as after restarting the app.
    dispose()
    dispose = registerIpc(win as never, storeFile)
    await writeFile(join(root, 'a.txt'), 'a')
    expect(await call(CHANNELS.restoreFolder)).toBe('macropad_ahk')
    expect(await call(CHANNELS.list, '')).toEqual([{ name: 'a.txt', kind: 'file' }])
  })

  it('tells the page a deleted folder is lost, and forgets it so the message shows once', async () => {
    await call(CHANNELS.openFolder)
    await rm(root, { recursive: true })
    expect(await call(CHANNELS.restoreFolder)).toEqual({
      lost: 'The folder macropad_ahk is no longer available. Open it again.',
    })
    expect(existsSync(storeFile)).toBe(false)
    expect(await call(CHANNELS.restoreFolder)).toBeNull()
  })

  it('holds no folder after a lost one', async () => {
    await call(CHANNELS.openFolder)
    await rm(root, { recursive: true })
    // A new window, as after restarting the app.
    dispose()
    dispose = registerIpc(win as never, storeFile)
    await call(CHANNELS.restoreFolder)
    await expect(call(CHANNELS.list, '')).rejects.toThrow('No folder is open.')
  })
})

describe('file access', () => {
  it('refuses file calls until a folder is open', async () => {
    for (const [channel, args] of [
      [CHANNELS.readBytes, ['a.txt']],
      [CHANNELS.writeBytes, ['a.txt', bytes('x')]],
      [CHANNELS.list, ['']],
      [CHANNELS.remove, ['a.txt']],
      [CHANNELS.watch, [['a.txt']]],
    ] as const) {
      await expect(call(channel, ...args)).rejects.toThrow('No folder is open.')
    }
  })

  describe('with a folder open', () => {
    beforeEach(async () => {
      await call(CHANNELS.openFolder)
    })

    it('writes, reads, lists and removes files inside the folder', async () => {
      await call(CHANNELS.writeBytes, 'sub/a.txt', bytes('hello'))
      expect(await readFile(join(root, 'sub', 'a.txt'), 'utf8')).toBe('hello')
      const read = (await call(CHANNELS.readBytes, 'sub/a.txt')) as Uint8Array
      expect(new TextDecoder().decode(read)).toBe('hello')
      expect(await call(CHANNELS.list, 'sub')).toEqual([{ name: 'a.txt', kind: 'file' }])
      await call(CHANNELS.remove, 'sub/a.txt')
      expect(await call(CHANNELS.readBytes, 'sub/a.txt')).toBeNull()
    })

    it('writes only the bytes of a view onto a larger buffer', async () => {
      // A structured clone can hand over a view into a bigger ArrayBuffer.
      const big = new Uint8Array(bytes('xxhixx').buffer)
      await call(CHANNELS.writeBytes, 'a.txt', big.subarray(2, 4))
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('hi')
    })

    it('refuses paths that leave the folder', async () => {
      for (const bad of ['../x.txt', '..\\x.txt', 'a/../../x.txt', '/etc/x', 'C:\\x.txt', 'C:x']) {
        await expect(call(CHANNELS.readBytes, bad)).rejects.toThrow()
        await expect(call(CHANNELS.writeBytes, bad, bytes('x'))).rejects.toThrow()
        await expect(call(CHANNELS.remove, bad)).rejects.toThrow()
      }
      await expect(call(CHANNELS.list, '../')).rejects.toThrow()
      expect(existsSync(join(dir, 'x.txt'))).toBe(false)
    })

    it('refuses arguments of the wrong type', async () => {
      await expect(call(CHANNELS.readBytes, 5)).rejects.toThrow('Expected a path')
      await expect(call(CHANNELS.readBytes, undefined)).rejects.toThrow('Expected a path')
      await expect(call(CHANNELS.writeBytes, 'a.txt', 'text')).rejects.toThrow('Expected file contents')
      await expect(call(CHANNELS.writeBytes, 'a.txt', [1, 2])).rejects.toThrow('Expected file contents')
      await expect(call(CHANNELS.writeBytes, 'a.txt', null)).rejects.toThrow('Expected file contents')
      await expect(call(CHANNELS.list, {})).rejects.toThrow('Expected a path')
      await expect(call(CHANNELS.remove, null)).rejects.toThrow('Expected a path')
      await expect(call(CHANNELS.watch, 'a.txt')).rejects.toThrow('Expected a list of paths')
      await expect(call(CHANNELS.watch, ['a.txt', 3])).rejects.toThrow('Expected a path')
      expect(existsSync(join(root, 'a.txt'))).toBe(false)
    })

    it('returns null for a missing file and an empty list for a missing folder', async () => {
      expect(await call(CHANNELS.readBytes, 'nope.txt')).toBeNull()
      expect(await call(CHANNELS.list, 'nope')).toEqual([])
    })
  })
})

describe('watching files', () => {
  beforeEach(async () => {
    await call(CHANNELS.openFolder)
  })

  it('watches the listed files inside the opened folder and forwards changes to the page', async () => {
    await call(CHANNELS.watch, ['config.json', 'ahk/main.ahk'])
    expect(watch.watchFiles).toHaveBeenCalledTimes(1)
    const [watchedRoot, rels, onChange] = watch.watchFiles.mock.calls[0]
    expect(watchedRoot).toBe(root)
    expect(rels).toEqual(['config.json', 'ahk/main.ahk'])
    onChange('config.json')
    expect(sent).toEqual([[CHANNELS.changed, 'config.json']])
  })

  it('does not send to a window that was closed meanwhile', async () => {
    await call(CHANNELS.watch, ['config.json'])
    destroyed = true
    watch.watchFiles.mock.calls[0][2]('config.json')
    expect(sent).toEqual([])
  })

  it('replaces the previous watch, and an empty list only stops it', async () => {
    const first = vi.fn()
    watch.watchFiles.mockReturnValue(first)
    await call(CHANNELS.watch, ['a'])
    await call(CHANNELS.watch, [])
    expect(first).toHaveBeenCalledTimes(1)
    expect(watch.watchFiles).toHaveBeenCalledTimes(1)
  })

  it('stops watching when disposed', async () => {
    const stop = vi.fn()
    watch.watchFiles.mockReturnValue(stop)
    await call(CHANNELS.watch, ['a'])
    dispose()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops the old watch before trying a new one, and does not stop it twice', async () => {
    const stop = vi.fn()
    watch.watchFiles.mockReturnValueOnce(stop)
    await call(CHANNELS.watch, ['a'])
    watch.watchFiles.mockImplementationOnce(() => {
      throw new Error('outside')
    })
    await expect(call(CHANNELS.watch, ['../b'])).rejects.toThrow('outside')
    expect(stop).toHaveBeenCalledTimes(1)
    dispose()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

describe('the running macropad', () => {
  const ahk = (path: string) => ({
    name: 'AutoHotkey64.exe',
    pid: 7,
    exe: 'C:\\AHK\\AutoHotkey64.exe',
    commandLine: `"C:\\AHK\\AutoHotkey64.exe" "${path}\\ahk\\main.ahk"`,
  })

  it('reports nothing before a folder is open, without looking at processes', async () => {
    expect(await call(CHANNELS.findMacropad)).toBeNull()
    expect(await call(CHANNELS.reloadMacropad)).toBeNull()
    expect(macropad.listProcesses).not.toHaveBeenCalled()
  })

  // findMacropad compares Windows-style paths, so these two need a Windows path to match.
  it.skipIf(process.platform !== 'win32')('finds the macropad that runs from the opened folder only', async () => {
    await call(CHANNELS.openFolder)
    macropad.listProcesses.mockResolvedValue([ahk(join(dir, 'elsewhere'))])
    expect(await call(CHANNELS.findMacropad)).toBeNull()
    macropad.listProcesses.mockResolvedValue([ahk(realpathSync.native(root))])
    expect(await call(CHANNELS.findMacropad)).toBe('ahk')
  })

  it.skipIf(process.platform !== 'win32')(
    'reloads it by starting the same program again from the real path of the folder',
    async () => {
      await call(CHANNELS.openFolder)
      const found = ahk(realpathSync.native(root))
      macropad.listProcesses.mockResolvedValue([found])
      expect(await call(CHANNELS.reloadMacropad)).toBe('ahk')
      expect(macropad.relaunch).toHaveBeenCalledTimes(1)
      expect(macropad.relaunch).toHaveBeenCalledWith({ lang: 'ahk', exe: found.exe }, realpathSync.native(root))
    },
  )

  it('does not start anything when no macropad runs from the folder', async () => {
    await call(CHANNELS.openFolder)
    expect(await call(CHANNELS.reloadMacropad)).toBeNull()
    expect(macropad.relaunch).not.toHaveBeenCalled()
  })

  it('passes on a failed process listing', async () => {
    await call(CHANNELS.openFolder)
    macropad.listProcesses.mockRejectedValue(new Error('powershell failed'))
    await expect(call(CHANNELS.findMacropad)).rejects.toThrow('powershell failed')
  })
})

describe('checking syntax', () => {
  beforeEach(async () => {
    await call(CHANNELS.openFolder)
    syntax.checkSyntax.mockResolvedValue({ ok: true })
  })

  it('needs an open folder', async () => {
    dispose()
    dispose = registerIpc(win as never, storeFile)
    await expect(call(CHANNELS.checkSyntax, 'ahk', 'ahk/main.ahk')).rejects.toThrow('No folder is open.')
  })

  it('refuses an unknown language, a bad path and a path outside the folder before anything runs', async () => {
    await expect(call(CHANNELS.checkSyntax, 'python', 'a.py')).rejects.toThrow('Expected a language')
    await expect(call(CHANNELS.checkSyntax, 'ahk', 7)).rejects.toThrow('Expected a path')
    await expect(call(CHANNELS.checkSyntax, 'ahk', '../main.ahk')).rejects.toThrow()
    await expect(call(CHANNELS.checkSyntax, 'ps', 'C:\\Windows\\x.ps1')).rejects.toThrow()
    expect(syntax.checkSyntax).not.toHaveBeenCalled()
  })

  it('checks PowerShell with no AutoHotkey lookup', async () => {
    expect(await call(CHANNELS.checkSyntax, 'ps', 'powershell/main.ps1')).toEqual({ ok: true })
    expect(syntax.checkSyntax).toHaveBeenCalledWith('ps', realpathSync.native(root), 'powershell/main.ps1', {
      ahkExe: undefined,
    })
    expect(macropad.listProcesses).not.toHaveBeenCalled()
    expect(macropad.findAutoHotkey).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'win32')('checks AutoHotkey with the program the running macropad uses', async () => {
    macropad.listProcesses.mockResolvedValue([
      {
        name: 'AutoHotkey64.exe',
        pid: 1,
        exe: 'D:\\ahk\\AutoHotkey64.exe',
        commandLine: `"D:\\ahk\\AutoHotkey64.exe" "${realpathSync.native(root)}\\ahk\\main.ahk"`,
      },
    ])
    await call(CHANNELS.checkSyntax, 'ahk', 'ahk/main.ahk')
    expect(syntax.checkSyntax.mock.calls[0][3]).toEqual({ ahkExe: 'D:\\ahk\\AutoHotkey64.exe' })
  })

  it('falls back to the installed AutoHotkey when nothing runs or the process listing fails', async () => {
    macropad.findAutoHotkey.mockReturnValue('C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe')
    await call(CHANNELS.checkSyntax, 'ahk', 'ahk/main.ahk')
    macropad.listProcesses.mockRejectedValue(new Error('no powershell'))
    await call(CHANNELS.checkSyntax, 'ahk', 'ahk/main.ahk')
    expect(syntax.checkSyntax).toHaveBeenCalledTimes(2)
    for (const args of syntax.checkSyntax.mock.calls) {
      expect(args[3]).toEqual({ ahkExe: 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe' })
    }
  })

  it('passes the report, and a checker failure, back to the page', async () => {
    const report = { ok: false, problems: [{ line: 3, message: 'bad' }] }
    syntax.checkSyntax.mockResolvedValue(report)
    expect(await call(CHANNELS.checkSyntax, 'ps', 'powershell/main.ps1')).toBe(report)
    syntax.checkSyntax.mockRejectedValue(new Error('could not run'))
    await expect(call(CHANNELS.checkSyntax, 'ps', 'powershell/main.ps1')).rejects.toThrow('could not run')
  })
})

describe('installed languages', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value })
  afterEach(() => Object.defineProperty(process, 'platform', platform))

  it('offers nothing away from Windows, without looking for AutoHotkey', async () => {
    setPlatform('linux')
    expect(await call(CHANNELS.installedLanguages)).toEqual([])
    expect(macropad.autoHotkeyInstalled).not.toHaveBeenCalled()
  })

  it('offers both on Windows with AutoHotkey installed, otherwise PowerShell only', async () => {
    setPlatform('win32')
    macropad.autoHotkeyInstalled.mockReturnValue(true)
    expect(await call(CHANNELS.installedLanguages)).toEqual(['ahk', 'ps'])
    macropad.autoHotkeyInstalled.mockReturnValue(false)
    expect(await call(CHANNELS.installedLanguages)).toEqual(['ps'])
  })
})
