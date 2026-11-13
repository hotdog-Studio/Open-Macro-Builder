import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

// Starts the real built desktop app (dist/ + dist-electron/) and drives its window. Slow, so it
// has its own config (vitest.electron.config.ts) and is not part of `npm test`.
//
// Safety for the owner's own macropad:
//  - The app only ever looks at, and restarts, a macropad whose script lives in the OPENED folder
//    (findMacropad in electron/macropad.ts compares <folder>\ahk\main.ahk). The opened folder here
//    is a temp copy, so a macropad running from the real repo can never match.
//  - Nothing here clicks Reload, and the repo's local/ folder is never read or copied.

const configurator = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(configurator, '..')

/** The Electron binary's path, or null when it was not downloaded (ELECTRON_SKIP_BINARY_DOWNLOAD=1). */
function electronBinary(): string | null {
  try {
    const path = createRequire(import.meta.url)('electron') as unknown
    return typeof path === 'string' && existsSync(path) ? path : null
  } catch {
    return null
  }
}

const binary = electronBinary()
// Linux with no display (a CI agent) cannot open a window.
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

/** The newest modification time under `paths`, files only. */
async function newest(paths: string[]): Promise<number> {
  let latest = 0
  for (const path of paths) {
    const info = await stat(path).catch(() => null)
    if (!info) continue
    if (!info.isDirectory()) {
      latest = Math.max(latest, info.mtimeMs)
      continue
    }
    for (const entry of await readdir(path)) latest = Math.max(latest, await newest([join(path, entry)]))
  }
  return latest
}

/** Builds dist/ and dist-electron/ unless they are there and newer than the sources. */
async function buildIfNeeded(): Promise<void> {
  const outputs = [
    join(configurator, 'dist', 'index.html'),
    join(configurator, 'dist-electron', 'main.cjs'),
    join(configurator, 'dist-electron', 'preload.cjs'),
  ]
  const sources = ['src', 'electron', 'index.html', 'package.json', 'scripts/build-electron.mjs', 'vite.config.ts'].map(
    (p) => join(configurator, p),
  )
  const built = outputs.every((file) => existsSync(file))
  // Test files change often and are not part of the bundle; compare against the bundle's inputs
  // by the oldest output, so any newer source triggers one rebuild.
  if (built) {
    const oldest = Math.min(...(await Promise.all(outputs.map(async (f) => (await stat(f)).mtimeMs))))
    if ((await newest(sources)) <= oldest) return
  }
  // The same two steps as `npm run electron`, without tsc -b (the unit tests and lint cover types).
  const vite = join(configurator, 'node_modules', 'vite', 'bin', 'vite.js')
  execFileSync(process.execPath, [vite, 'build'], { cwd: configurator, stdio: 'inherit' })
  execFileSync(process.execPath, [join(configurator, 'scripts', 'build-electron.mjs')], {
    cwd: configurator,
    stdio: 'inherit',
  })
}

/** Copies the example repository files the app needs, never local/. */
async function copyExample(to: string): Promise<void> {
  for (const name of ['config.json', 'ahk', 'powershell', 'img']) {
    await cp(join(repoRoot, name), join(to, name), {
      recursive: true,
      // Belt and braces: a local/ folder nested in any of these is skipped as well.
      filter: (source) => !source.split(/[\\/]/).includes('local'),
    })
  }
}

const roots: string[] = []
let apps: ElectronApplication[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** Starts the built app on `userData`, with the native folder dialog answering `folder`. */
async function launch(userData: string, folder: string): Promise<{ app: ElectronApplication; page: Page }> {
  // VS Code's terminal sets ELECTRON_RUN_AS_NODE, which would make electron.exe behave as Node.
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    executablePath: binary!,
    args: [configurator, `--user-data-dir=${userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: configurator,
    env,
    timeout: 60_000,
  })
  apps.push(app)
  // The native dialog cannot be clicked; answer it with the temp folder.
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [picked] })) as never
  }, folder)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function closeApps(): Promise<void> {
  const open = apps
  apps = []
  await Promise.all(
    open.map(async (app) => {
      const child = app.process()
      // A page with unsaved edits makes main.ts ask Leave or Stay in a modal box that would hang
      // the close; answer Leave.
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = (() => 0) as never
        })
        .catch(() => {})
      const closed = await Promise.race([
        app.close().then(() => true, () => true),
        new Promise<boolean>((done) => setTimeout(() => done(false), 15_000)),
      ])
      if (!closed) child.kill()
    }),
  )
}

/**
 * Open folder, then the first-run prompts: a copy in local/, and which version runs. The desktop app
 * asks the second only when it finds no AutoHotkey to choose by itself (see installedLanguages), so
 * answer it when it shows up, whichever way the machine is set.
 */
async function firstRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open folder' }).click()
  await page.getByRole('button', { name: 'Edit a copy in local/ (recommended)' }).click()
  const language = page.getByRole('button', { name: 'AutoHotkey' })
  const tab = page.getByRole('tab', { name: 'Pad shape' })
  await language.or(tab).first().waitFor()
  if (await language.isVisible()) await language.click()
  await tab.waitFor()
}

/**
 * Waits until the page has drawn `count` more frames, which is when dnd-kit acts on a press or a
 * move. A window that is not drawing (covered or minimised) is given half a second instead.
 */
function frames(page: Page, count = 2): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        const next = (left: number): void => {
          if (left === 0) done()
          else requestAnimationFrame(() => next(left - 1))
        }
        next(n)
        setTimeout(done, 500)
      }),
    count,
  )
}

/** Waits until the element has stopped moving: the same box twice in a row. */
async function settled(element: Locator): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await element.boundingBox())
        const same = now === last
        last = now
        return same
      },
      { timeout: 5000 },
    )
    .toBe(true)
}

/** Drags a key with real mouse moves, in steps: dnd-kit's PointerSensor ignores the first 5 px. */
async function dragKey(page: Page, keyName: RegExp, cell: string): Promise<void> {
  const key = page.getByRole('list', { name: 'Keys' }).getByRole('button', { name: keyName })
  await key.waitFor()
  // The first layout can still move the grid; measure after it settled.
  await settled(key)
  const from = (await key.boundingBox())!
  const to = (await page.locator(`[data-cell="${cell}"]`).boundingBox())!
  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Let the sensor see the press before the moves; a drag that starts mid-frame can be missed.
  await frames(page)
  // Drops land on the cell nearest the dragged key's top-left corner, so aim that corner.
  const endX = startX + (to.x + to.width / 2 - (from.x + from.width / 2))
  const endY = startY + (to.y + to.height / 2 - (from.y + from.height / 2))
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + ((endX - startX) * i) / steps, startY + ((endY - startY) * i) / steps)
    await frames(page, 1)
  }
  // Collision detection runs on a frame after the last move.
  await frames(page)
  await page.mouse.up()
  // Dropped when the key sits on the square it was aimed at.
  await expect
    .poll(
      async () => {
        const at = (await key.boundingBox())!
        // Keys sit a few pixels inside their square.
        return Math.abs(at.x - to.x) < to.width / 2 && Math.abs(at.y - to.y) < to.height / 2
      },
      { timeout: 5000 },
    )
    .toBe(true)
  // dnd-kit swallows any click for 50 ms after a drop (it would otherwise count as a click on the
  // key). A person never clicks that fast; the next click here must not either, so let the page
  // draw well past that first.
  await frames(page, 16)
}

interface Config {
  keys: Array<{ key: string; row: number; col: number }>
}
const readConfig = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Config

describe.skipIf(!binary || !hasDisplay)('the desktop app', () => {
  beforeAll(buildIfNeeded)

  afterEach(closeApps)

  afterAll(async () => {
    await closeApps()
    // The app may hold files for a moment after it exits on Windows.
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
  })

  it('opens a folder, keeps a dragged key in the personal copy and leaves the shared config alone', async () => {
    const folder = await tempDir('omb-e2e-folder-')
    const userData = await tempDir('omb-e2e-user-')
    await copyExample(folder)
    const sharedBefore = await readFile(join(folder, 'config.json'))

    const { page } = await launch(userData, folder)
    await firstRun(page)
    await page.getByRole('tab', { name: 'Pad shape' }).click()

    // F24 starts at row 4, column 3; square 5:1 is free.
    const save = page.getByRole('button', { name: 'Save config.json' })
    expect(await save.isDisabled()).toBe(true)
    await dragKey(page, /^F24 1×1/, '5:1')
    // Save is enabled once the drop is an unsaved edit.
    await expect.poll(() => save.isEnabled(), { timeout: 5000 }).toBe(true)
    await save.click()

    const personal = join(folder, 'local', 'config.json')
    await expect
      .poll(async () => (await readConfig(personal)).keys[11], { timeout: 15_000 })
      .toMatchObject({ key: 'F24', row: 5, col: 1 })
    expect(await readFile(join(folder, 'config.json'))).toEqual(sharedBefore)
  })

  it('reopens the remembered folder by itself when the app starts again', async () => {
    const folder = await tempDir('omb-e2e-folder-')
    const userData = await tempDir('omb-e2e-user-')
    await copyExample(folder)

    const first = await launch(userData, folder)
    await firstRun(first.page)
    await closeApps()

    // Nothing is clicked. The dialog would answer with an empty decoy folder, which has no F24 key,
    // so seeing the example pad proves the remembered folder was restored.
    const second = await launch(userData, await tempDir('omb-e2e-decoy-'))
    await second.page.getByRole('tab', { name: 'Pad shape' }).waitFor()
    const f24 = second.page.getByRole('list', { name: 'Keys' }).getByRole('button', { name: /^F24 1×1/ })
    await f24.waitFor()
    expect(await f24.isVisible()).toBe(true)
  })

  it('asks before the window closes on unsaved edits, and stays open when told to', async () => {
    const folder = await tempDir('omb-e2e-folder-')
    const userData = await tempDir('omb-e2e-user-')
    await copyExample(folder)

    const { app, page } = await launch(userData, folder)
    await firstRun(page)
    await page.getByRole('tab', { name: 'Pad shape' }).click()
    const save = page.getByRole('button', { name: 'Save config.json' })
    await dragKey(page, /^F24 1×1/, '5:1')
    await expect.poll(() => save.isEnabled(), { timeout: 5000 }).toBe(true)

    // The question is a modal box that cannot be clicked: count how often it is asked, and answer Stay.
    await app.evaluate(({ dialog }) => {
      const main = globalThis as unknown as { asked: number }
      main.asked = 0
      dialog.showMessageBoxSync = (() => {
        main.asked++
        return 1
      }) as never
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())

    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { asked: number }).asked), { timeout: 5000 }).toBe(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    // The edit is still there to save.
    expect(await save.isEnabled()).toBe(true)
  })

  it('keeps the page sandboxed: no Node in the page, only the omb bridge', async () => {
    const folder = await tempDir('omb-e2e-folder-')
    const userData = await tempDir('omb-e2e-user-')
    await copyExample(folder)

    const { page } = await launch(userData, folder)
    const seen = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      return {
        require: typeof w.require,
        process: typeof w.process,
        buffer: typeof w.Buffer,
        ipcRenderer: typeof w.ipcRenderer,
        omb: typeof w.omb,
        bridge: Object.keys(w.omb as object).sort(),
      }
    })
    expect(seen).toMatchObject({ require: 'undefined', process: 'undefined', buffer: 'undefined', ipcRenderer: 'undefined', omb: 'object' })
    expect(seen.bridge).toEqual(
      [
        'checkSyntax',
        'findMacropad',
        'installedLanguages',
        'list',
        'onChanged',
        'openFolder',
        'readBytes',
        'reloadMacropad',
        'remove',
        'restoreFolder',
        'watch',
        'writeBytes',
      ].sort(),
    )
  })
})
