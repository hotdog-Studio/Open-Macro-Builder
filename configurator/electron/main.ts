import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'

/** The configurator folder: package.json, dist/ and dist-electron/ live here. */
const appRoot = app.getAppPath()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Open Macro Builder',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // The page never leaves the app and never opens other windows.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Page problems show up where the app was started from.
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(`[page] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  win.webContents.on('preload-error', (_event, path, error) => console.error(`[preload] ${path}: ${error.message}`))
  win.webContents.on('did-fail-load', (_event, code, description, url) =>
    console.error(`[load] ${url}: ${description} (${code})`),
  )
  win.webContents.on('render-process-gone', (_event, details) => console.error(`[page] gone: ${details.reason}`))

  const dispose = registerIpc(win, join(app.getPath('userData'), 'omb-electron.json'))
  win.on('closed', dispose)

  void win.loadFile(join(appRoot, 'dist', 'index.html'))
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.on('window-all-closed', () => app.quit())

void app.whenReady().then(createWindow)
