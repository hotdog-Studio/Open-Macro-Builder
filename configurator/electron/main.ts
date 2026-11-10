import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'

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

  // The app path is the configurator folder: package.json, dist/ and dist-electron/ live there.
  void win.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
}

function start(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(createWindow)
}

// With ELECTRON_RUN_AS_NODE set, electron.exe runs this file as plain Node and
// require('electron') gives no app.
if (typeof app === 'undefined') {
  console.error('Open Macro Builder must run inside Electron; unset ELECTRON_RUN_AS_NODE or use npm run electron.')
  process.exit(1)
} else {
  start()
}
