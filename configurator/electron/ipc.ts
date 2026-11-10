import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { realpathSync } from 'node:fs'
import { CHANNELS } from './channels'
import { autoHotkeyInstalled, findMacropad, listProcesses, relaunch, type FoundMacropad } from './macropad'
import { NodeFolder } from './nodeFolder'
import { forgetLastFolder, restoreLastFolder, saveLastFolder } from './store'
import { watchFiles } from './watch'

function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a path')
  return value
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('Expected a list of paths')
  return value.map(text)
}

function bytes(value: unknown): Uint8Array {
  if (!ArrayBuffer.isView(value)) throw new TypeError('Expected file contents')
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

/**
 * Answers the preload bridge for one window. The main process holds the opened
 * folder; the page only ever sends paths relative to it, and NodeFolder refuses
 * any that would leave it. Returns a function that removes the handlers.
 */
export function registerIpc(win: BrowserWindow, storeFile: string): () => void {
  let folder: NodeFolder | null = null
  let stopWatch: (() => void) | null = null

  const unwatch = () => {
    stopWatch?.()
    stopWatch = null
  }

  const hold = (root: string): string => {
    unwatch()
    folder = new NodeFolder(root)
    return folder.name
  }

  const opened = (): NodeFolder => {
    if (!folder) throw new Error('No folder is open.')
    return folder
  }

  const handle = (channel: string, answer: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      // Only this window's page may use the bridge.
      if (event.sender !== win.webContents) throw new Error('Refused: unknown sender')
      return answer(...args)
    })
  }

  handle(CHANNELS.openFolder, async () => {
    const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    const root = picked.filePaths[0]
    if (picked.canceled || !root) return null
    try {
      saveLastFolder(storeFile, root)
    } catch {
      // Not being able to remember the folder must not stop it opening.
    }
    return hold(root)
  })

  handle(CHANNELS.restoreFolder, () => {
    const restored = restoreLastFolder(storeFile)
    if (restored === null) return null
    if (typeof restored === 'string') return hold(restored)
    try {
      forgetLastFolder(storeFile)
    } catch {
      // The message still reaches the page.
    }
    return restored
  })

  handle(CHANNELS.readBytes, (rel) => opened().readBytes(text(rel)))
  handle(CHANNELS.writeBytes, (rel, data) => opened().writeBytes(text(rel), bytes(data)))
  handle(CHANNELS.list, (rel) => opened().list(text(rel)))
  handle(CHANNELS.remove, (rel) => opened().remove(text(rel)))

  handle(CHANNELS.watch, (rels) => {
    const paths = texts(rels)
    unwatch()
    if (paths.length === 0) return
    stopWatch = watchFiles(opened().root, paths, (rel) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.changed, rel)
    })
  })

  /** The macropad running from the opened folder, looked up fresh each time. */
  const runningMacropad = async (): Promise<{ found: FoundMacropad; root: string } | null> => {
    if (!folder) return null
    // realpath, so 8.3 short names in the folder path match the long names in command lines.
    const root = realpathSync.native(folder.root)
    const found = findMacropad(await listProcesses(), root)
    return found ? { found, root } : null
  }

  handle(CHANNELS.findMacropad, async () => (await runningMacropad())?.found.lang ?? null)
  handle(CHANNELS.reloadMacropad, async () => {
    const running = await runningMacropad()
    if (!running) return null
    relaunch(running.found, running.root)
    return running.found.lang
  })
  handle(CHANNELS.installedLanguages, () => {
    if (process.platform !== 'win32') return []
    return autoHotkeyInstalled(process.env) ? ['ahk', 'ps'] : ['ps']
  })

  return () => {
    unwatch()
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel)
  }
}
