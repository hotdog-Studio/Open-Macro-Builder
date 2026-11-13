import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { PadKey } from '../core/config/model'
import { at, banner, carry, carryOn, cell, click, dirty, drag, drop, offset, padKey, startApp, unmount, ws } from '../../test/browser/harness'

// The example pad: F13 to F21 fill rows 1 to 3 of columns 1 to 3, F22 and F23 are 1×2 in column 4,
// Fn (ScrollLock, 2×1) and F24 are on row 4. The Pad shape tab adds a free row 5 and column 5.

afterEach(unmount)

/** One column of the grid, and one row with label strips (the example has them on) and without. */
const COL = 80
const ROW = 103.75
const ROW_BARE = 80

const key = (name: string): PadKey => {
  const found = [ws().fn, ...ws().keys].find((k) => k.key === name)
  if (!found) throw new Error(`no key ${name}`)
  return found
}
const place = (name: string) => {
  const { row, col, width = 1, height = 1 } = key(name)
  return { row, col, width, height }
}
const handle = (name: string) => screen.getByRole('button', { name: `Resize ${name}` })
const heading = () => screen.getByRole('heading', { level: 3, name: /key/i }).textContent

describe('Pad shape tab: moving a key', () => {
  it('drops a key on a free square, selects it and marks the config unsaved', async () => {
    await startApp()
    expect(place('F24')).toMatchObject({ row: 4, col: 3 })
    expect(dirty()).toBe(false)

    await drag(padKey('F24'), cell(5, 1))

    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 1 }))
    expect(heading()).toBe('Macro key 12 of 12')
    expect(dirty()).toBe(true)
    expect((screen.getByRole('button', { name: 'Save config.json' }) as HTMLButtonElement).disabled).toBe(false)
    expect(banner()).toBeNull()
  })

  it('draws the key on its new square', async () => {
    await startApp()
    const before = padKey('F24').getBoundingClientRect()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 1 }))
    const after = padKey('F24').getBoundingClientRect()
    expect(after.left - before.left).toBeCloseTo(-2 * COL, 0)
    expect(after.top - before.top).toBeCloseTo(ROW, 0)
    // No transform is left behind from the drag.
    expect(padKey('F24').style.transform).toBe('')
  })

  it('refuses a square another key is on, and says why', async () => {
    await startApp()
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    expect(place('F13')).toMatchObject({ row: 1, col: 1 })
    expect(dirty()).toBe(false)

    await click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(banner()).toBeNull()
  })

  it('refuses a square where the rest of a big key would not fit', async () => {
    await startApp()
    // F22 is two rows tall: at row 2 of column 5 it fits, at row 3 of column 4 it would sit on F23.
    await drag(padKey('F22'), offset(padKey('F22'), 0, 2 * ROW))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    expect(place('F22')).toMatchObject({ row: 1, col: 4 })
  })

  it('lands a big key by its top-left corner, wherever on it the mouse holds it', async () => {
    await startApp()
    // Hold F22 near its bottom edge, which is over row 2, and move it one column right.
    const grip = at(padKey('F22'), 0.5, 0.9)
    await drag(grip, offset(grip, COL, 0))
    await waitFor(() => expect(place('F22')).toMatchObject({ row: 1, col: 5, height: 2 }))
  })

  it('moves the Fn key', async () => {
    await startApp()
    await drag(padKey('ScrollLock'), offset(padKey('ScrollLock'), 0, ROW))
    await waitFor(() => expect(ws().fn).toMatchObject({ row: 5, col: 1, width: 2 }))
    expect(heading()).toBe('Fn key')
  })

  it('snaps to the nearest square when the drop is a little off', async () => {
    await startApp()
    await drag(padKey('F24'), offset(cell(5, 2), 25, -20))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 2 }))
  })

  it('does nothing when the key is let go away from the grid', async () => {
    await startApp()
    await drag(padKey('F24'), screen.getByRole('checkbox', { name: 'Show labels above keys' }))
    // The drop has happened once the key is back in its place.
    await waitFor(() => expect(padKey('F24').style.transform).toBe(''))
    expect(place('F24')).toMatchObject({ row: 4, col: 3 })
    expect(dirty()).toBe(false)
    expect(banner()).toBeNull()
  })

  it('does nothing when the key is put back on its own square', async () => {
    await startApp()
    await carry(padKey('F24'), cell(5, 1))
    await carryOn(cell(4, 3))
    await drop()
    await waitFor(() => expect(padKey('F24').style.transform).toBe(''))
    expect(place('F24')).toMatchObject({ row: 4, col: 3 })
    expect(banner()).toBeNull()
  })

  it('a press that moves less than 5 px is a click: it selects and moves nothing', async () => {
    await startApp()
    await drag(padKey('F18'), offset(padKey('F18'), 3, 2), 3)
    await waitFor(() => expect(heading()).toBe('Macro key 6 of 12'))
    expect(place('F18')).toMatchObject({ row: 2, col: 3 })
    expect(dirty()).toBe(false)
  })

  it('Escape during a drag cancels it', async () => {
    await startApp()
    await carry(padKey('F24'), cell(5, 1))
    await userEvent.keyboard('{Escape}')
    await drop()
    await waitFor(() => expect(padKey('F24').style.transform).toBe(''))
    expect(place('F24')).toMatchObject({ row: 4, col: 3 })
    expect(dirty()).toBe(false)
  })

  it('the key follows the mouse and the square under it lights up', async () => {
    await startApp()
    const start = padKey('F24').getBoundingClientRect()
    await carry(padKey('F24'), cell(5, 1))

    await waitFor(() => expect(cell(5, 1).className).toContain('border-sky-400'))
    const moved = padKey('F24').getBoundingClientRect()
    expect(moved.left - start.left).toBeCloseTo(-2 * COL, 0)
    expect(moved.top - start.top).toBeCloseTo(ROW, 0)
    // Nothing is committed until the button is let go.
    expect(place('F24')).toMatchObject({ row: 4, col: 3 })

    await carryOn(cell(5, 2))
    await waitFor(() => expect(cell(5, 2).className).toContain('border-sky-400'))
    expect(cell(5, 1).className).not.toContain('border-sky-400')

    await drop()
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 2 }))
    expect(cell(5, 2).className).not.toContain('border-sky-400')
  })

  it('grows the grid by a row once a key is on the last one', async () => {
    await startApp()
    expect(document.querySelector('[data-cell="6:1"]')).toBeNull()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(document.querySelector('[data-cell="6:1"]')).not.toBeNull())

    // And the new row takes a key.
    await drag(padKey('F24'), cell(6, 1))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 6, col: 1 }))
  })

  it('moves keys one after another', async () => {
    await startApp()
    await drag(padKey('F24'), cell(5, 3))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 3 }))
    // The square F24 left is free now.
    await drag(padKey('F21'), cell(4, 3))
    await waitFor(() => expect(place('F21')).toMatchObject({ row: 4, col: 3 }))
    await drag(padKey('F24'), cell(3, 3))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 3, col: 3 }))
    expect(banner()).toBeNull()
  })

  it('still lands on the right square with the label strips off', async () => {
    await startApp()
    await click(screen.getByRole('checkbox', { name: 'Show labels above keys' }))
    await waitFor(() => expect(ws().options.showLabels).toBe(false))
    const before = padKey('F24').getBoundingClientRect()
    await drag(padKey('F24'), cell(5, 3))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 3 }))
    expect(padKey('F24').getBoundingClientRect().top - before.top).toBeCloseTo(ROW_BARE, 0)
  })

  it('a moved key keeps its layer and its macros', async () => {
    await startApp()
    const { slots } = ws()
    await drag(padKey('F13'), cell(5, 1))
    await waitFor(() => expect(place('F13')).toMatchObject({ row: 5, col: 1 }))
    expect(ws().slots).toEqual(slots)
    expect(ws().keys.map((k) => k.key)).toEqual(['F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24'])
  })
})

describe('Pad shape tab: resizing a key', () => {
  it('dragging the corner down makes the key taller', async () => {
    await startApp()
    await drag(handle('F24'), offset(handle('F24'), 0, ROW))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 4, col: 3, width: 1, height: 2 }))
    expect(screen.getByRole('button', { name: 'F24 1×2' })).toBeTruthy()
    expect(dirty()).toBe(true)
  })

  it('dragging the corner right and down grows both ways', async () => {
    await startApp()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(place('F24')).toMatchObject({ row: 5, col: 1 }))
    await drag(handle('F24'), offset(handle('F24'), 2 * COL, ROW))
    await waitFor(() => expect(place('F24')).toMatchObject({ width: 3, height: 2 }))
    const r = padKey('F24').getBoundingClientRect()
    expect(r.width).toBeCloseTo(3 * COL - 5, 0)
  })

  it('dragging the corner back in shrinks the key', async () => {
    await startApp()
    await drag(handle('F22'), offset(handle('F22'), 0, -ROW))
    await waitFor(() => expect(place('F22')).toMatchObject({ width: 1, height: 1 }))
    // A size of one is left out of the config.
    expect(key('F22')).not.toHaveProperty('height')

    await drag(handle('ScrollLock'), offset(handle('ScrollLock'), -COL, 0))
    await waitFor(() => expect(ws().fn).not.toHaveProperty('width'))
  })

  it('never makes a key smaller than one square', async () => {
    await startApp()
    await drag(handle('F22'), offset(handle('F22'), -3 * COL, -3 * ROW))
    await waitFor(() => expect(place('F22')).toMatchObject({ width: 1, height: 1 }))
    expect(banner()).toBeNull()
  })

  it('refuses to grow over another key, and says why', async () => {
    await startApp()
    await drag(handle('F13'), offset(handle('F13'), COL, 0))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    expect(place('F13')).toMatchObject({ width: 1, height: 1 })
    expect(dirty()).toBe(false)
  })

  it('a drag of less than half a square changes nothing', async () => {
    await startApp()
    await drag(handle('F24'), offset(handle('F24'), 30, 40))
    await waitFor(() => expect(handle('F24').style.transform).toBe(''))
    expect(place('F24')).toMatchObject({ width: 1, height: 1 })
    expect(dirty()).toBe(false)
    expect(banner()).toBeNull()
  })

  it('the corner follows the mouse during the drag and the key resizes on release', async () => {
    await startApp()
    const start = handle('F24').getBoundingClientRect()
    await carry(handle('F24'), offset(handle('F24'), 0, ROW))
    await waitFor(() => expect(handle('F24').getBoundingClientRect().top - start.top).toBeCloseTo(ROW, 0))
    expect(place('F24')).toMatchObject({ height: 1 })
    await drop()
    await waitFor(() => expect(place('F24')).toMatchObject({ height: 2 }))
  })

  it('uses the shorter row when the label strips are off', async () => {
    await startApp()
    await click(screen.getByRole('checkbox', { name: 'Show labels above keys' }))
    await waitFor(() => expect(ws().options.showLabels).toBe(false))
    await drag(handle('F24'), offset(handle('F24'), 0, ROW_BARE))
    await waitFor(() => expect(place('F24')).toMatchObject({ height: 2 }))
  })

  it('dragging the corner does not move the key', async () => {
    await startApp()
    await drag(handle('F24'), offset(handle('F24'), 0, ROW))
    await waitFor(() => expect(place('F24')).toMatchObject({ height: 2 }))
    expect(place('F24')).toMatchObject({ row: 4, col: 3 })
  })
})
