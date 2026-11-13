import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => unknown

// One fake of everything main.ts takes from Electron. Listeners are kept by event name so a test
// can fire the event Electron would.
const electron = vi.hoisted(() => {
  const state = {
    appOn: new Map<string, Listener[]>(),
    windows: [] as Array<{
      options: { title: string; width: number; height: number; webPreferences: { preload: string; contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean } }
      listeners: Map<string, Listener>
      contents: Map<string, Listener>
      handler: { current: (() => unknown) | null }
      loaded: string[]
    }>,
    ready: Promise.resolve(),
    packaged: false,
    setMenu: vi.fn(),
    messageBox: vi.fn(),
    available: true,
    quit: vi.fn(),
  }
  return state
})

const ipc = vi.hoisted(() => ({ registerIpc: vi.fn(), dispose: vi.fn() }))
vi.mock('./ipc', () => ({ registerIpc: ipc.registerIpc }))

vi.mock('electron', () => {
  class FakeWindow {
    private readonly record
    webContents
    constructor(options: Record<string, unknown>) {
      this.record = {
        options,
        listeners: new Map<string, Listener>(),
        contents: new Map<string, Listener>(),
        handler: { current: null as (() => unknown) | null },
        loaded: [] as string[],
      }
      electron.windows.push(this.record as never)
      const record = this.record
      this.webContents = {
        on: (event: string, fn: Listener) => record.contents.set(event, fn),
        setWindowOpenHandler: (fn: () => unknown) => (record.handler.current = fn),
      }
    }
    on(event: string, fn: Listener) {
      this.record.listeners.set(event, fn)
    }
    loadFile(file: string) {
      this.record.loaded.push(file)
      return Promise.resolve()
    }
  }
  return {
    get app() {
      if (!electron.available) return undefined
      return {
        on: (event: string, fn: Listener) => electron.appOn.set(event, [...(electron.appOn.get(event) ?? []), fn]),
        whenReady: () => electron.ready,
        get isPackaged() {
          return electron.packaged
        },
        getPath: (name: string) => join('userdata-root', name),
        getAppPath: () => join('app-root', 'configurator'),
        quit: electron.quit,
      }
    },
    BrowserWindow: FakeWindow,
    dialog: { showMessageBoxSync: electron.messageBox },
    Menu: { setApplicationMenu: electron.setMenu },
  }
})

/** Imports main.ts afresh, waits for the window to be made, and returns it. */
async function start() {
  vi.resetModules()
  await import('./main')
  await electron.ready
  // The whenReady callback runs in a microtask after the promise resolves.
  await Promise.resolve()
  return electron.windows.at(-1)!
}

beforeEach(() => {
  electron.appOn.clear()
  electron.windows.length = 0
  electron.packaged = false
  electron.available = true
  electron.ready = Promise.resolve()
  electron.quit.mockReset()
  ipc.registerIpc.mockReset()
  ipc.registerIpc.mockReturnValue(ipc.dispose)
  ipc.dispose.mockReset()
  electron.setMenu.mockReset()
  electron.messageBox.mockReset()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the window', () => {
  it('is created once the app is ready, and not before', async () => {
    let ready!: () => void
    electron.ready = new Promise<void>((r) => (ready = r))
    vi.resetModules()
    await import('./main')
    await Promise.resolve()
    expect(electron.windows).toHaveLength(0)
    ready()
    await electron.ready
    await Promise.resolve()
    expect(electron.windows).toHaveLength(1)
  })

  it('isolates the page: sandboxed, context isolation on, no Node integration', async () => {
    const { options } = await start()
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true })
  })

  it('loads the bundled preload.cjs', async () => {
    const { options } = await start()
    expect(basename(options.webPreferences.preload)).toBe('preload.cjs')
  })

  it('has a title and a size', async () => {
    const { options } = await start()
    expect(options).toMatchObject({ title: 'Open Macro Builder', width: 1280, height: 860 })
  })

  it('loads the built page from the app folder', async () => {
    const win = await start()
    expect(win.loaded).toEqual([join('app-root', 'configurator', 'dist', 'index.html')])
  })

  it('answers the bridge with the remembered-folder file in the user data folder', async () => {
    await start()
    expect(ipc.registerIpc).toHaveBeenCalledTimes(1)
    expect(ipc.registerIpc.mock.calls[0][1]).toBe(join('userdata-root', 'userData', 'omb-electron.json'))
  })

  it('removes the bridge handlers when the window closes', async () => {
    const win = await start()
    expect(ipc.dispose).not.toHaveBeenCalled()
    win.listeners.get('closed')!()
    expect(ipc.dispose).toHaveBeenCalledOnce()
  })
})

describe('keeping the page inside the app', () => {
  it('cancels navigation and redirects', async () => {
    const win = await start()
    for (const event of ['will-navigate', 'will-redirect']) {
      const preventDefault = vi.fn()
      win.contents.get(event)!({ preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
    }
  })

  it('denies every new window', async () => {
    const win = await start()
    expect(win.handler.current!()).toEqual({ action: 'deny' })
  })

  it('blocks webviews in any web contents', async () => {
    await start()
    const [onCreated] = electron.appOn.get('web-contents-created')!
    const attach = new Map<string, Listener>()
    onCreated({}, { on: (event: string, fn: Listener) => attach.set(event, fn) })
    const preventDefault = vi.fn()
    attach.get('will-attach-webview')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})

describe('unsaved changes', () => {
  const unload = async (choice: number) => {
    const win = await start()
    electron.messageBox.mockReturnValue(choice)
    const preventDefault = vi.fn()
    win.contents.get('will-prevent-unload')!({ preventDefault })
    return { win, preventDefault }
  }

  it('lets the page go when the user picks Leave', async () => {
    const { preventDefault } = await unload(0)
    // preventDefault on will-prevent-unload means: ignore the page's objection and unload.
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('keeps the page open when the user picks Stay', async () => {
    const { preventDefault } = await unload(1)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('asks with Stay as the default and as the answer to closing the box', async () => {
    await unload(1)
    const [, options] = electron.messageBox.mock.calls[0]
    expect(options).toMatchObject({ buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1 })
    expect(options.buttons[options.defaultId]).toBe('Stay')
  })
})

describe('page problems', () => {
  it('prints page errors, and only errors, where the app was started from', async () => {
    const win = await start()
    const log = win.contents.get('console-message')!
    log({ level: 'info', message: 'fine', sourceId: 'a.js', lineNumber: 1 })
    log({ level: 'warning', message: 'hmm', sourceId: 'a.js', lineNumber: 2 })
    expect(console.error).not.toHaveBeenCalled()
    log({ level: 'error', message: 'boom', sourceId: 'a.js', lineNumber: 3 })
    expect(console.error).toHaveBeenCalledWith('[page] boom (a.js:3)')
  })

  it('prints preload, load and crash failures', async () => {
    const win = await start()
    win.contents.get('preload-error')!({}, 'preload.cjs', new Error('bad preload'))
    win.contents.get('did-fail-load')!({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x')
    win.contents.get('render-process-gone')!({}, { reason: 'crashed' })
    expect(console.error).toHaveBeenCalledWith('[preload] preload.cjs: bad preload')
    expect(console.error).toHaveBeenCalledWith('[load] file:///x: ERR_FILE_NOT_FOUND (-6)')
    expect(console.error).toHaveBeenCalledWith('[page] gone: crashed')
  })
})

describe('the application', () => {
  it('quits when the last window closes', async () => {
    await start()
    const [quit] = electron.appOn.get('window-all-closed')!
    expect(electron.quit).not.toHaveBeenCalled()
    quit()
    expect(electron.quit).toHaveBeenCalledOnce()
  })

  it('removes the menu in the installed app, which also removes the reload and DevTools shortcuts', async () => {
    electron.packaged = true
    await start()
    expect(electron.setMenu).toHaveBeenCalledWith(null)
  })

  it('keeps the default menu when run from source, for DevTools while developing', async () => {
    await start()
    expect(electron.setMenu).not.toHaveBeenCalled()
  })

  it('explains and exits when electron.exe runs it as plain Node', async () => {
    electron.available = false
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.resetModules()
    await import('./main')
    expect(exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ELECTRON_RUN_AS_NODE'))
    expect(electron.windows).toHaveLength(0)
  })
})
