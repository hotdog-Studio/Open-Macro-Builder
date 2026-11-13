import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserCommand } from 'vitest/node'
import { functionNames, validateConfig } from '../../../scripts/validate-config-core.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Lower-cased names of the commands defined under a folder of the repository, as the macropad would find them. */
function commandNames(dir: string, ext: '.ahk' | '.ps1'): Set<string> {
  const names = new Set<string>()
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (extname(path).toLowerCase() === ext) {
        for (const name of functionNames(readFileSync(path, 'utf8'), ext)) names.add(name)
      }
    }
  }
  walk(dir)
  return names
}

/**
 * Runs the repository's own validator (scripts/validate-config.mjs, the check Jenkins runs before
 * anything else) on a config the configurator saved: its structure, that every layer's icon set
 * exists on disk, and that every action is a command in both the AutoHotkey and the PowerShell
 * version. Returns its problems, none when the macropad would load the file. Reads the shared
 * commands and icons only, never local/.
 */
export const validateSavedConfig: BrowserCommand<[text: string]> = (_ctx, text): string[] =>
  validateConfig(JSON.parse(text), {
    iconExists: (name: string) => existsSync(join(repoRoot, 'img', name, 'layer.png')),
    ahkActions: commandNames(join(repoRoot, 'ahk', 'commands'), '.ahk'),
    psActions: commandNames(join(repoRoot, 'powershell', 'commands'), '.ps1'),
  })

export interface PointerPath {
  /** Where the pointer goes, in order, in CSS pixels of the test page. */
  points: { x: number; y: number }[]
  /** Press the left button at the first point. */
  press: boolean
  /** Let the button go after the last point. */
  release: boolean
  /** How many mouse-move events each leg is split into. */
  steps: number
  /** The test page's innerWidth and innerHeight, to map its pixels to the browser window's. */
  viewport: { width: number; height: number }
}

export type TouchPath = Pick<PointerPath, 'points' | 'steps' | 'viewport'>

/**
 * Moves the real mouse along a path. Runs in the Node side of Vitest, where Playwright lives. The
 * test page is an iframe, so its coordinates are shifted (and scaled, with the Vitest UI open) to
 * the window's.
 */
/**
 * Lets the page draw two frames. A hand rests a moment before it lets go; without the rest, a slow
 * machine gets the release before the page has worked out what is under the pointer, and the drop
 * lands where the pointer was one step earlier.
 */
const rest = (frame: { evaluate: (fn: () => Promise<void>) => Promise<void> }) =>
  frame.evaluate(
    () =>
      new Promise<void>((done) => {
        const timer = setTimeout(done, 500)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(timer)
            done()
          }),
        )
      }),
  )

export const pointerPath: BrowserCommand<[path: PointerPath]> = async (ctx, path) => {
  const frame = await ctx.frame()
  const box = await (await frame.frameElement()).boundingBox()
  if (!box) throw new Error('pointerPath: the test iframe is not visible.')
  const sx = box.width / path.viewport.width
  const sy = box.height / path.viewport.height
  const mouse = ctx.page.mouse
  const [first, ...others] = path.points
  if (first) {
    await mouse.move(box.x + first.x * sx, box.y + first.y * sy)
    if (path.press) await mouse.down()
  }
  for (const p of others) await mouse.move(box.x + p.x * sx, box.y + p.y * sy, { steps: path.steps })
  if (path.release) {
    if (others.length > 0) await rest(frame)
    await mouse.up()
  }
}

/**
 * Drags one finger along a path on a touch screen: down at the first point, through the rest, and
 * up. Playwright's own touch API only taps, so this speaks to Chromium directly.
 */
export const touchPath: BrowserCommand<[path: TouchPath]> = async (ctx, path) => {
  const frame = await ctx.frame()
  const box = await (await frame.frameElement()).boundingBox()
  if (!box) throw new Error('touchPath: the test iframe is not visible.')
  const sx = box.width / path.viewport.width
  const sy = box.height / path.viewport.height
  const cdp = await ctx.page.context().newCDPSession(ctx.page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: Math.round(box.x + p.x * sx), y: Math.round(box.y + p.y * sy) }] : [],
    })
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const [first, ...others] = path.points
    await send('touchStart', first)
    let from = first
    for (const to of others) {
      for (let i = 1; i <= path.steps; i++) {
        const t = i / path.steps
        await send('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
      }
      from = to
    }
    await rest(frame)
    await send('touchEnd')
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await cdp.detach()
  }
}
