import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { banner, cell, dirty, offset, padKey, startApp, touchDrag, unmount, ws } from '../../test/browser/harness'

// The same drags with a finger on a touch screen instead of the mouse. The browser turns touches
// into the pointer events the grid listens for, as long as the page does not scroll under the finger.

afterEach(unmount)

const settle = () => new Promise((done) => setTimeout(done, 150))
const keyOf = (name: string) => {
  const found = [ws().fn, ...ws().keys].find((k) => k.key === name)
  if (!found) throw new Error(`no key ${name}`)
  return found
}
const layerKey = (title: string) =>
  within(screen.getByRole('list', { name: 'Keys' })).getByRole('button', { name: new RegExp(`^${title}( Start layer)?$`) })
const command = (name: string) => {
  const row = document.querySelector<HTMLElement>(`[data-command="${name}"]`)
  if (!row) throw new Error(`the command list has no ${name}`)
  row.scrollIntoView({ block: 'center' })
  return row
}

describe('with a finger', () => {
  it('a key is dragged to a free square', async () => {
    await startApp()
    await touchDrag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 5, col: 1 }))
    expect(dirty()).toBe(true)
  })

  it('a key dragged onto a taken square is refused with the reason', async () => {
    await startApp()
    await touchDrag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    expect(keyOf('F13')).toMatchObject({ row: 1, col: 1 })
  })

  it('a key is resized by its corner', async () => {
    await startApp()
    const corner = screen.getByRole('button', { name: 'Resize F24' })
    await touchDrag(corner, offset(corner, 0, 103.75))
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ height: 2 }))
  })

  it('layers are swapped, parked and put back', async () => {
    await startApp('Layers')
    await touchDrag(layerKey('Media'), layerKey('Programs'))
    await waitFor(() => expect(ws().slots.k2?.title).toBe('Media'))

    const shelf = screen.getByRole('group', { name: 'Parked' })
    await touchDrag(layerKey('Chrome'), shelf)
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))

    const chip = within(shelf).getByText('Chrome').closest('[aria-roledescription="draggable"]') as HTMLElement
    await touchDrag(chip, padKey('F16'))
    await waitFor(() => expect(ws().slots.k4?.title).toBe('Chrome'))
    expect(ws().parked).toEqual([])
  })

  it('a command is dragged onto a key, and two macros are swapped', async () => {
    await startApp('Macros')
    await touchDrag(command('Lock'), padKey('F16'))
    await waitFor(() => expect(ws().slots.k1.macros.k4?.action).toBe('Lock'))
    await touchDrag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(ws().slots.k1.macros.k1?.name).toBe('Play'))
  })

  it('a touch that barely moves is a tap: it moves nothing', async () => {
    await startApp()
    await touchDrag(padKey('F18'), offset(padKey('F18'), 2, 2), 2)
    await settle()
    expect(keyOf('F18')).toMatchObject({ row: 2, col: 3 })
    expect(dirty()).toBe(false)
  })

  it('the command list still scrolls under a finger that is not on a command', async () => {
    await startApp('Macros')
    const list = screen.getByRole('region', { name: 'Commands' }).closest('aside')!
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    const heading = within(list).getAllByRole('group')[0].firstElementChild!
    const before = list.scrollTop
    await touchDrag(heading, offset(heading, 0, -60))
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(before))
    expect(dirty()).toBe(false)
  })
})
