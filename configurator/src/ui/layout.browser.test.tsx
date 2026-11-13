import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { size } from '../core/config/model'
import { banner, carry, cell, click, dirty, drag, drop, offset, padKey, startApp, unmount, ws } from '../../test/browser/harness'

// Dragging when the layout is not the comfortable 1280×900 of the other suites: a small window
// where the pad has to be scrolled to, a zoomed-in browser, a pad much bigger than the example, and
// a window that changes size in the middle of a drag.

afterEach(async () => {
  unmount()
  await page.viewport(1280, 900)
})

const settle = () => new Promise((done) => setTimeout(done, 150))
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
    for (const tab of ['Pad shape', 'Layers', 'Macros', 'Commands'] as const) {
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

describe('in a small window', () => {
  it('the page itself still never scrolls, and the header wraps to fit', async () => {
    await page.viewport(760, 420)
    await startApp()
    const root = document.documentElement
    for (const tab of ['Pad shape', 'Layers', 'Macros', 'Commands'] as const) {
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
    await page.viewport(853, 600)
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
    await page.viewport(760, 420)
    await startApp()
    // The bottom of the pad is out of sight until the middle column is scrolled.
    expect(inView(cell(5, 1))).toBe(false)
    await bring(padKey('ScrollLock'), padKey('F24'), cell(5, 1))

    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 5, col: 1 }))
  })

  it('a drag lands on the right square when the pad is scrolled both ways', async () => {
    await page.viewport(860, 420)
    await startApp()
    await bring(padKey('F18'), cell(3, 5))
    expect(centre().scrollTop).toBeGreaterThan(0)
    expect(centre().scrollLeft).toBeGreaterThan(0)
    await drag(padKey('F18'), cell(3, 5))
    await waitFor(() => expect(keyOf('F18')).toMatchObject({ row: 3, col: 5 }))
    expect(banner()).toBeNull()
  })

  it('resizing by the corner still counts whole squares', async () => {
    await page.viewport(760, 420)
    await startApp()
    await bring(padKey('F24'), cell(5, 3))
    const corner = screen.getByRole('button', { name: 'Resize F24' })
    await drag(corner, offset(corner, 0, 103.75))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ height: 2 }))
  })

  it('layers swap and park', async () => {
    await page.viewport(760, 420)
    await startApp('Layers')
    await bring(layerKey('Media'), layerKey('Programs'))
    await drag(layerKey('Media'), layerKey('Programs'))
    await waitFor(() => expect(ws().slots.k2?.title).toBe('Media'))
    await bring(layerKey('Chrome'))
    await drag(layerKey('Chrome'), screen.getByRole('group', { name: 'Parked' }))
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))
  })

  it('a command from the scrolled list lands on a key of the scrolled pad', async () => {
    await page.viewport(760, 420)
    await startApp('Macros')
    await bring(padKey('F24'))
    await drag(command('Hibernate'), padKey('F24'))
    await waitFor(() => expect(ws().slots.k1.macros.k12?.action).toBe('Hibernate'))
  })
})

// Zooming a browser in shrinks the window as the page measures it: 150 % of 1280×900 lays out as 853×600.
describe('a pad scrolled under the side panels', () => {
  it('a layer dragged to the shelf is parked, not dropped on a key hidden behind the panel', async () => {
    await page.viewport(760, 420)
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
    await page.viewport(760, 420)
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
    await page.viewport(760, 420)
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
    await page.viewport(853, 600)
    await startApp()
    await bring(padKey('F24'), cell(4, 5))
    await drag(padKey('F24'), cell(4, 5))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 4, col: 5 }))

    const corner = screen.getByRole('button', { name: 'Resize F13' })
    await bring(padKey('F13'), padKey('F14'))
    await drag(corner, offset(corner, 80, 0))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))

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

describe('when the window changes size during a drag', () => {
  it('the drag is called off, nothing moves, and the next drag works', async () => {
    await startApp()
    await carry(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(cell(5, 1).className).toContain('border-sky-400'))

    await page.viewport(1000, 700)
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
