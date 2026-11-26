import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from 'vitest/browser'
import { size } from '../core/config/model'
import { banner, carry, cell, cleanUp, click, dirty, drag, drop, offset, padKey, repoFiles, rest, startApp, startOpenScreen, viewport, ws } from '../../test/browser/harness'

// Dragging when the layout is not the comfortable 1280×900 of the other suites: a small window
// where the pad has to be scrolled to, a zoomed-in browser, a pad much bigger than the example, and
// a window that changes size in the middle of a drag.

afterEach(async () => {
  await cleanUp()
  await viewport(1280, 900)
})

const settle = () => rest(150)
const keyOf = (name: string) => {
  const found = [ws().fn, ...ws().keys].find((k) => k.key === name)
  if (!found) throw new Error(`no key ${name}`)
  return found
}
/** The middle column, which scrolls when the pad does not fit. */
const centre = () => screen.getByRole('main')
const layerKey = (title: string) =>
  within(screen.getByRole('list', { name: 'Keys' })).getByRole('button', { name: new RegExp(`^${title}( Start layer)?$`) })
const command = (name: string) => {
  const row = document.querySelector<HTMLElement>(`[data-command="${name}"]`)
  if (!row) throw new Error(`the command list has no ${name}`)
  row.scrollIntoView({ block: 'center' })
  return row
}
const inView = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
}
/** Whether the mouse can reach the middle of an element: on screen and not cut off by a scrolling panel. */
const reachable = (el: Element) => {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit !== null && el.contains(hit)
}
/** Scrolls so the first element is at the top-left of its panel, and checks the mouse can reach them all. */
async function bring(...els: Element[]): Promise<void> {
  els[0].scrollIntoView({ block: 'start', inline: 'start' })
  await settle()
  for (const el of els) expect(reachable(el)).toBe(true)
}

describe('at 1280 wide', () => {
  it('the page itself never scrolls: only the panels do', async () => {
    await startApp()
    for (const tab of ['Get started', 'Pad shape', 'Layers', 'Macros', 'Commands'] as const) {
      await click(screen.getByRole('tab', { name: tab }))
      const root = document.documentElement
      expect(root.scrollWidth, tab).toBeLessThanOrEqual(root.clientWidth)
      expect(root.scrollHeight, tab).toBeLessThanOrEqual(root.clientHeight)
    }
  })

  it('the whole pad is on screen without scrolling on every tab', async () => {
    await startApp()
    for (const tab of ['Pad shape', 'Layers', 'Macros'] as const) {
      await click(screen.getByRole('tab', { name: tab }))
      expect(inView(screen.getByRole('list', { name: 'Keys' }).parentElement!), tab).toBe(true)
    }
  })
})

/**
 * Whether the header's controls (tabs, links, buttons) sit in one row. Each is centred in its row, so
 * in one row their top edges differ by a pixel at most (their heights differ by a pixel or two); on a
 * second row they are a whole line lower.
 */
const oneRow = () => {
  const tops = [...document.querySelectorAll<HTMLElement>('header button, header a')].map((el) => el.getBoundingClientRect().top)
  return Math.max(...tops) - Math.min(...tops) <= 2
}
/** The path of the layout file shown in the header, which is in the page whether or not there is room for it. */
const layoutPath = () => screen.getByText('local/config.json')
const shown = (el: Element) => el.getBoundingClientRect().width > 0

describe('the header', () => {
  it('leaves out the path of the layout file in a window narrower than 1440 px, and shows it from there on', async () => {
    await viewport(1439, 900)
    await startApp()
    expect(shown(layoutPath())).toBe(false)
    await viewport(1440, 900)
    await waitFor(() => expect(shown(layoutPath())).toBe(true))
  })
})

// How many of the header's controls fit one row depends on how wide the machine's font draws them.
// The header is sized for Segoe UI, the font of Windows, where the desktop app runs. A wider font,
// such as the one on the Linux build agent, wraps it at these widths, as it is built to do. So, like
// the pictures of the pad (visual.browser.test.tsx), these run on Windows only.
const withWindowsFonts = describe.skipIf(server.platform !== 'win32')

withWindowsFonts('the header, drawn with the fonts of Windows', () => {
  it('is one row in the browser at 1280 wide, without the path of the layout file', async () => {
    await startApp()
    expect(screen.getByRole('link', { name: /Download/ })).toBeTruthy()
    expect(oneRow()).toBe(true)
    expect(shown(layoutPath())).toBe(false)
  })

  it('is one row in the desktop app at its default window width, with the folder name it gives a new folder', async () => {
    // 1264 px: the default 1280 px window less its frame.
    await viewport(1264, 900)
    await startApp('Pad shape', undefined, { kind: 'electron', folderName: 'Open Macro Builder' })
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull()
    expect(oneRow()).toBe(true)
    expect(shown(layoutPath())).toBe(false)
  })

  it('is one row with the path of the layout file shown when the window is wide', async () => {
    await viewport(1700, 900)
    await startApp('Pad shape', undefined, { folderName: 'Open Macro Builder' })
    expect(oneRow()).toBe(true)
    expect(shown(layoutPath())).toBe(true)
  })
})

describe('in a small window', () => {
  it('the guide scrolls inside its own panel, not the page', async () => {
    await viewport(760, 420)
    await startApp('Get started')
    const guide = screen.getByRole('article', { name: 'Get started' }).parentElement!
    expect(guide.tagName).toBe('MAIN')
    expect(guide.scrollHeight).toBeGreaterThan(guide.clientHeight)
    const root = document.documentElement
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight)
    // The end of the guide can be scrolled to.
    guide.scrollTop = guide.scrollHeight
    await settle()
    expect(inView(screen.getByRole('link', { name: 'contributing guide' }))).toBe(true)
  })

  it('on the start screen the guide scrolls and the buttons stay reachable', async () => {
    await viewport(760, 420)
    startOpenScreen()
    await click(await screen.findByRole('button', { name: 'Get started' }))
    const main = screen.getByRole('main')
    const root = document.documentElement
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight)
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight)
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
    // The title and the buttons are not cut off above the window, and the mouse reaches them.
    expect(screen.getByRole('heading', { level: 1, name: 'Open Macro Builder' }).getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    for (const name of ['Open folder', 'Create new folder…', 'Hide the guide']) {
      const button = screen.getByRole('button', { name })
      expect(inView(button), name).toBe(true)
      expect(reachable(button), name).toBe(true)
    }
    // The end of the guide can be scrolled to.
    main.scrollTop = main.scrollHeight
    await settle()
    expect(inView(screen.getByRole('link', { name: 'contributing guide' }))).toBe(true)
  })

  it('the page itself still never scrolls, and the header wraps to fit', async () => {
    await viewport(760, 420)
    await startApp()
    const root = document.documentElement
    for (const tab of ['Get started', 'Pad shape', 'Layers', 'Macros', 'Commands'] as const) {
      await click(screen.getByRole('tab', { name: tab }))
      expect(root.scrollWidth, tab).toBeLessThanOrEqual(root.clientWidth)
      expect(root.scrollHeight, tab).toBeLessThanOrEqual(root.clientHeight)
    }
    // Everything in the header can be reached.
    for (const name of ['Open folder', 'Save config.json']) {
      const r = screen.getByRole('button', { name }).getBoundingClientRect()
      expect(r.left, name).toBeGreaterThanOrEqual(0)
      expect(r.right, name).toBeLessThanOrEqual(window.innerWidth)
    }
  })

  it('every column of the pad can be scrolled to', async () => {
    await viewport(853, 600)
    await startApp()
    // The pad is wider than the middle column here.
    expect(centre().scrollWidth).toBeGreaterThan(centre().clientWidth)
    centre().scrollLeft = 0
    await settle()
    expect(cell(1, 1).getBoundingClientRect().left).toBeGreaterThan(centre().getBoundingClientRect().left)
    expect(reachable(padKey('F13'))).toBe(true)
    centre().scrollLeft = centre().scrollWidth
    await settle()
    expect(cell(1, 5).getBoundingClientRect().right).toBeLessThan(centre().getBoundingClientRect().right)
    expect(reachable(cell(1, 5))).toBe(true)
  })

  it('a key scrolled to can be dragged to a square scrolled to', async () => {
    await viewport(760, 420)
    await startApp()
    // The bottom of the pad is out of sight until the middle column is scrolled.
    expect(inView(cell(5, 1))).toBe(false)
    await bring(padKey('ScrollLock'), padKey('F24'), cell(5, 1))

    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 5, col: 1 }))
  })

  it('a drag lands on the right square when the pad is scrolled both ways', async () => {
    await viewport(860, 420)
    await startApp()
    await bring(padKey('F18'), cell(3, 5))
    expect(centre().scrollTop).toBeGreaterThan(0)
    expect(centre().scrollLeft).toBeGreaterThan(0)
    await drag(padKey('F18'), cell(3, 5))
    await waitFor(() => expect(keyOf('F18')).toMatchObject({ row: 3, col: 5 }))
    expect(banner()).toBeNull()
  })

  it('resizing by the corner still counts whole squares', async () => {
    await viewport(760, 420)
    await startApp()
    await bring(padKey('F24'), cell(5, 3))
    const corner = screen.getByRole('button', { name: 'Resize F24' })
    await drag(corner, offset(corner, 0, 103.75))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ height: 2 }))
  })

  it('layers swap and park', async () => {
    await viewport(760, 420)
    await startApp('Layers')
    await bring(layerKey('Media'), layerKey('Programs'))
    await drag(layerKey('Media'), layerKey('Programs'))
    await waitFor(() => expect(ws().slots.k2?.title).toBe('Media'))
    await bring(layerKey('Chrome'))
    await drag(layerKey('Chrome'), screen.getByRole('group', { name: 'Parked' }))
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))
  })

  it('a command from the scrolled list lands on a key of the scrolled pad', async () => {
    await viewport(760, 420)
    await startApp('Macros')
    await bring(padKey('F24'))
    await drag(command('Hibernate'), padKey('F24'))
    await waitFor(() => expect(ws().slots.k1.macros.k12?.action).toBe('Hibernate'))
  })
})

describe('messages', () => {
  it('a message floats over the editor and moves nothing', async () => {
    await startApp()
    const keys = screen.getByRole('list', { name: 'Keys' })
    const before = keys.getBoundingClientRect()
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    const after = keys.getBoundingClientRect()
    expect(after.top).toBe(before.top)
    expect(after.left).toBe(before.left)
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
    const root = document.documentElement
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight)
    // It lies over the editor: nothing is pushed down to make room.
    expect(screen.getByRole('alert').getBoundingClientRect().top).toBeGreaterThanOrEqual(
      screen.getByRole('banner').getBoundingClientRect().bottom,
    )
  })

  it('a message fits a small window', async () => {
    await viewport(760, 420)
    await startApp()
    await bring(padKey('F13'), padKey('F14'))
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    expect(inView(screen.getByRole('alert'))).toBe(true)
  })
})

// Zooming a browser in shrinks the window as the page measures it: 150 % of 1280×900 lays out as 853×600.
describe('a pad scrolled under the side panels', () => {
  it('a layer dragged to the shelf is parked, not dropped on a key hidden behind the panel', async () => {
    await viewport(760, 420)
    await startApp('Layers')
    // Scrolled right: the first columns of the pad now lie behind the left panel, under the shelf.
    await bring(layerKey('Chrome'))
    const before = { ...ws().slots }
    await drag(layerKey('Chrome'), screen.getByRole('group', { name: 'Parked' }))
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))
    delete before.k3
    expect(ws().slots).toEqual(before)
  })

  it('a key let go over a side panel does not land on a square hidden behind it', async () => {
    await viewport(760, 420)
    await startApp()
    await bring(padKey('F15'))
    const panel = screen.getByRole('checkbox', { name: 'Show labels above keys' }).closest('aside')!
    await drag(padKey('F15'), panel)
    await settle()
    expect(keyOf('F15')).toMatchObject({ row: 1, col: 3 })
    expect(banner()).toBeNull()
    expect(dirty()).toBe(false)
  })

  it('a command dropped on the list side of the window does not land on a key hidden behind it', async () => {
    await viewport(760, 420)
    await startApp('Macros')
    await bring(padKey('F15'))
    const before = ws().slots.k1.macros
    await drag(command('Lock'), command('Hibernate'))
    await settle()
    expect(ws().slots.k1.macros).toEqual(before)
  })
})

describe('zoomed in to 150 %', () => {
  it('keys move, resize and swap as at 100 %', async () => {
    await viewport(853, 600)
    await startApp()
    await bring(padKey('F24'), cell(4, 5))
    await drag(padKey('F24'), cell(4, 5))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 4, col: 5 }))

    const corner = screen.getByRole('button', { name: 'Resize F13' })
    await bring(padKey('F13'), padKey('F14'))
    await drag(corner, offset(corner, 80, 0))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    // At this size the message floats over the keys the next drag reaches for: a user closes it first.
    await click(screen.getByRole('button', { name: 'Dismiss' }))

    await click(screen.getByRole('tab', { name: 'Macros' }))
    await bring(padKey('F13'), padKey('F14'))
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(ws().slots.k1.macros.k1?.name).toBe('Play'))
  })
})

describe('a pad much bigger than the example', () => {
  it('keys added past the window can be dragged between far squares', async () => {
    await startApp()
    const add = screen.getByRole('button', { name: '+ Add key' })
    for (let i = 0; i < 10; i++) await click(add)
    await waitFor(() => expect(ws().keys).toHaveLength(22))
    // Each new key took a free square, so no two keys overlap.
    const places = new Set(ws().keys.map((k) => `${k.row}:${k.col}`))
    expect(places.size).toBe(22)

    const last = ws().keys[21]
    const rows = Math.max(...ws().keys.map((k) => size(k).row + size(k).h - 1))
    // The pad is wider than the window now. The grid keeps a free row under the last key:
    // move the newest key down to it.
    expect(centre().scrollWidth).toBeGreaterThan(centre().clientWidth)
    const target = cell(rows + 1, size(last).col)
    await bring(padKey(last.key), target)
    await drag(padKey(last.key), target)
    await waitFor(() => expect(ws().keys[21]).toMatchObject({ row: rows + 1, col: size(last).col }))
    expect(dirty()).toBe(true)
  })
})

/** The right-hand panel, found by the overlay preview it holds. */
const previewPanel = () => screen.getByRole('region', { name: 'Overlay preview' }).closest('aside')!
/** The box the preview scrolls in when it is wider than the panel. */
const previewBox = () => screen.getByRole('region', { name: 'Overlay preview' }).querySelector<HTMLElement>('.overflow-auto')!

/** The width of an element's own borders and padding, left and right, in px. */
const frameWidth = (el: HTMLElement) => {
  const s = getComputedStyle(el)
  return [s.paddingLeft, s.paddingRight, s.borderLeftWidth, s.borderRightWidth].reduce((sum, v) => sum + Number.parseFloat(v), 0)
}
/** How wide the panel can be and still be sized by the preview alone: the preview, its frame, the panel's frame and its scrollbar. */
const widestForPreview = () => {
  const panel = previewPanel()
  const scrollbar = panel.offsetWidth - panel.clientWidth - Number.parseFloat(getComputedStyle(panel).borderLeftWidth)
  const section = screen.getByRole('region', { name: 'Overlay preview' })
  // The preview's own size, which scrollWidth is not: a scroll box that is wider than its content reports its own width.
  const preview = (previewBox().firstElementChild as HTMLElement).offsetWidth
  return preview + frameWidth(section) + frameWidth(panel) + scrollbar
}

describe('the right panel', () => {
  it('shows the whole overlay preview on Pad shape, Layers and Macros', async () => {
    await startApp()
    for (const tab of ['Pad shape', 'Layers', 'Macros'] as const) {
      await click(screen.getByRole('tab', { name: tab }))
      expect(previewBox().scrollWidth, tab).toBeLessThanOrEqual(previewBox().clientWidth)
      expect(previewPanel().getBoundingClientRect().width, tab).toBeGreaterThanOrEqual(288)
    }
  })

  it('is as wide as the overlay preview needs, not as wide as the longest line of its details', async () => {
    await startApp()
    // A selected key shows a note that is one long line (about 600 px) if nothing makes it wrap.
    await click(padKey('F22'))
    expect(previewPanel().getBoundingClientRect().width).toBeLessThanOrEqual(widestForPreview() + 1)
  })

  it('still shows it whole when the panel itself scrolls', async () => {
    await viewport(1280, 420)
    await startApp()
    await click(padKey('F22'))
    expect(previewPanel().scrollHeight).toBeGreaterThan(previewPanel().clientHeight)
    expect(previewBox().scrollWidth).toBeLessThanOrEqual(previewBox().clientWidth)
  })

  it("keeps the Commands tab's right panel at its fixed width", async () => {
    await startApp('Commands')
    const aside = screen.getAllByRole('complementary').at(-1)!
    expect(aside.getBoundingClientRect().width).toBe(288)
  })

  it('stops at half the window for a very wide pad, and the preview scrolls inside', async () => {
    const example = JSON.parse(new TextDecoder().decode((await repoFiles())['config.json']))
    // One key far to the right makes the pad twelve columns wide.
    example.keys.find((k: { key: string }) => k.key === 'F24').col = 12
    await startApp('Pad shape', JSON.stringify(example))
    expect(previewPanel().getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth / 2)
    expect(previewBox().scrollWidth).toBeGreaterThan(previewBox().clientWidth)
    const root = document.documentElement
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  })
})

describe('when the window changes size during a drag', () => {
  it('the drag is called off, nothing moves, and the next drag works', async () => {
    await startApp()
    await carry(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(cell(5, 1).className).toContain('border-sky-400'))

    await viewport(1000, 700)
    await waitFor(() => expect(padKey('F24').style.transform).toBe(''))
    await drop()
    await settle()
    expect(keyOf('F24')).toMatchObject({ row: 4, col: 3 })
    expect(dirty()).toBe(false)
    expect(cell(5, 1).className).not.toContain('border-sky-400')

    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 5, col: 1 }))
  })
})
