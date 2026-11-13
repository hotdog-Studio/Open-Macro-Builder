import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { at, carried, carry, carryOn, click, dirty, drag, dragNoWait, drop, offset, padKey, startApp, unmount, ws } from '../../test/browser/harness'

// The example pad on the Layers tab: Media (the start layer) on F13, Programs on F14, Chrome on
// F15, VS Code on F17, and so on. F16, F21 and F24 have no layer, and nothing is parked.

afterEach(unmount)

const keys = () => screen.getByRole('list', { name: 'Keys' })
/** A key by the title of the layer on it. A key with no layer is padKey('F16'). */
const layerKey = (title: string) =>
  within(keys()).getByRole('button', { name: new RegExp(`^${title}( Start layer)?$`) })
const shelf = () => screen.getByRole('group', { name: 'Parked' })
/** A parked layer's chip on the shelf. */
const chip = (title: string) => within(shelf()).getByText(title).closest('[aria-roledescription="draggable"]') as HTMLElement
const parked = () => ws().parked.map((l) => l.title)
const on = (key: string) => ws().slots[key]?.title
/** The label strip above a key. */
const strip = (key: HTMLElement) => key.closest('li')?.querySelector('.font-mono')?.textContent ?? null
const lit = (el: HTMLElement) => el.className.split(' ').includes('ring-sky-400')
/** Every layer's title, on a key or parked: a drag must never lose or copy one. */
const allTitles = () => [...Object.values(ws().slots).map((l) => l.title), ...parked()].sort()

const start = () => startApp('Layers')
/** A drop that changes nothing leaves no trace to wait for, so give the app time to get it wrong. */
const settle = () => new Promise((done) => setTimeout(done, 150))

describe('Layers tab: dragging a layer between keys', () => {
  it('swaps two layers', async () => {
    await start()
    await drag(layerKey('Programs'), layerKey('Chrome'))
    await waitFor(() => expect(on('k2')).toBe('Chrome'))
    expect(on('k3')).toBe('Programs')
    expect(dirty()).toBe(true)
    // The label strips and faces follow.
    expect(strip(layerKey('Chrome'))).toBe('Chrome')
    expect(layerKey('Chrome').getBoundingClientRect().left).toBeLessThan(layerKey('Programs').getBoundingClientRect().left)
  })

  it('moves a layer to a key that has none', async () => {
    await start()
    await drag(layerKey('Chrome'), padKey('F16'))
    await waitFor(() => expect(on('k4')).toBe('Chrome'))
    expect(on('k3')).toBeUndefined()
    // The key it left is empty now and shows its own name.
    expect(padKey('F15')).toBeTruthy()
  })

  it('the start star goes with the start layer, to a taken key or an empty one', async () => {
    await start()
    expect(ws().options.defaultKey).toBe('k1')
    await drag(layerKey('Media'), layerKey('Programs'))
    await waitFor(() => expect(ws().options.defaultKey).toBe('k2'))
    expect(within(layerKey('Media')).getByRole('img', { name: 'Start layer' })).toBeTruthy()

    await drag(layerKey('Media'), padKey('F16'))
    await waitFor(() => expect(ws().options.defaultKey).toBe('k4'))
    expect(on('k4')).toBe('Media')
  })

  it('the star stays with the start layer when another layer is dropped on it', async () => {
    await start()
    await drag(layerKey('Chrome'), layerKey('Media'))
    await waitFor(() => expect(on('k1')).toBe('Chrome'))
    expect(on('k3')).toBe('Media')
    expect(ws().options.defaultKey).toBe('k3')
  })

  it('the key under the mouse lights up, and nothing changes until the button is let go', async () => {
    await start()
    await carry(layerKey('Programs'), layerKey('Chrome'))
    await waitFor(() => expect(lit(layerKey('Chrome'))).toBe(true))
    expect(lit(layerKey('Media'))).toBe(false)
    expect(on('k2')).toBe('Programs')

    await carryOn(padKey('F16'))
    await waitFor(() => expect(lit(padKey('F16'))).toBe(true))
    expect(lit(layerKey('Chrome'))).toBe(false)

    await drop()
    await waitFor(() => expect(on('k4')).toBe('Programs'))
    expect(on('k3')).toBe('Chrome')
  })

  it('a layer dropped on the Fn key stays where it was', async () => {
    await start()
    await drag(layerKey('Media'), padKey('ScrollLock'))
    await waitFor(() => expect(layerKey('Media').style.transform).toBe(''))
    await settle()
    expect(on('k1')).toBe('Media')
    expect(dirty()).toBe(false)
  })

  it('a layer dropped off the grid, or back on its own key, stays where it was', async () => {
    await start()
    await drag(layerKey('Media'), screen.getByRole('tab', { name: 'Commands' }))
    await waitFor(() => expect(layerKey('Media').style.transform).toBe(''))

    // Its place is read before the drag: a key being dragged is wherever the mouse has it.
    const home = at(layerKey('Media'))
    await carry(home, layerKey('Programs'))
    await carryOn(home)
    await drop()
    await waitFor(() => expect(layerKey('Media').style.transform).toBe(''))
    await settle()
    expect(on('k1')).toBe('Media')
    expect(on('k2')).toBe('Programs')
    expect(dirty()).toBe(false)
    // Letting go over the Commands tab did not click it.
    expect(screen.getByRole('tab', { name: 'Layers' }).getAttribute('aria-selected')).toBe('true')
  })

  it('a key with no layer cannot be dragged', async () => {
    await start()
    await drag(padKey('F16'), layerKey('Media'))
    await settle()
    expect(on('k1')).toBe('Media')
    expect(on('k4')).toBeUndefined()
    expect(dirty()).toBe(false)
  })

  it('Escape during a drag cancels it', async () => {
    await start()
    await carry(layerKey('Programs'), layerKey('Chrome'))
    await userEvent.keyboard('{Escape}')
    await drop()
    await waitFor(() => expect(layerKey('Programs').style.transform).toBe(''))
    await settle()
    expect(on('k2')).toBe('Programs')
    expect(dirty()).toBe(false)
  })

  it('a click still selects a key, before and after a drag', async () => {
    await start()
    await click(layerKey('Chrome'))
    expect(screen.getByRole('heading', { level: 3, name: 'Fn + F15' })).toBeTruthy()

    await drag(layerKey('Chrome'), padKey('F16'))
    await waitFor(() => expect(on('k4')).toBe('Chrome'))
    await click(layerKey('Chrome'))
    expect(screen.getByRole('heading', { level: 3, name: 'Fn + F16' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Chrome')
  })

  it('a layer can be picked up again the instant it is dropped, from where the mouse is', async () => {
    await start()
    const [media, programs, f16] = [at(layerKey('Media')), at(layerKey('Programs')), at(padKey('F16'))]
    await dragNoWait(media, programs)
    await dragNoWait(programs, f16)
    await waitFor(() => expect(on('k4')).toBe('Media'))
    expect(on('k1')).toBe('Programs')
    expect(on('k2')).toBeUndefined()
  })

  it('a layer dropped on the label strip above a key goes on that key', async () => {
    await start()
    const f16 = padKey('F16').getBoundingClientRect()
    await drag(layerKey('Chrome'), { x: f16.left + f16.width / 2, y: f16.top - 12 })
    await waitFor(() => expect(on('k4')).toBe('Chrome'))
  })

  it('a press that moves less than 5 px selects the key and moves nothing', async () => {
    await start()
    await drag(layerKey('Chrome'), offset(layerKey('Chrome'), 2, 3), 3)
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Fn + F15' })).toBeTruthy())
    expect(dirty()).toBe(false)
  })
})

describe('Layers tab: the Parked shelf', () => {
  it('parks a layer dropped on the shelf', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    expect(on('k3')).toBeUndefined()
    expect(chip('Chrome')).toBeTruthy()
    expect(padKey('F15')).toBeTruthy()
    expect(dirty()).toBe(true)
  })

  it('the shelf lights up while a layer is over it', async () => {
    await start()
    await carry(layerKey('Chrome'), shelf())
    await waitFor(() => expect(shelf().className).toContain('border-sky-400'))
    await drop()
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    expect(shelf().className).not.toContain('border-sky-400')
  })

  it('parking the start layer leaves the pad with no start layer', async () => {
    await start()
    await drag(layerKey('Media'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Media']))
    expect(ws().options.defaultKey).toBeNull()
    expect(screen.queryByRole('img', { name: 'Start layer' })).toBeNull()
  })

  it('puts a parked layer on an empty key', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))

    await drag(chip('Chrome'), padKey('F24'))
    await waitFor(() => expect(on('k12')).toBe('Chrome'))
    expect(parked()).toEqual([])
    expect(strip(layerKey('Chrome'))).toBe('Chrome')
  })

  it('a parked layer dropped on a taken key takes it, and the layer that was there is parked', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))

    await drag(chip('Chrome'), layerKey('Programs'))
    await waitFor(() => expect(on('k2')).toBe('Chrome'))
    expect(parked()).toEqual(['Programs'])
    expect(chip('Programs')).toBeTruthy()
  })

  it('a parked layer that takes the start key leaves the pad with no start layer', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    await drag(chip('Chrome'), layerKey('Media'))
    await waitFor(() => expect(on('k1')).toBe('Chrome'))
    expect(parked()).toEqual(['Media'])
    expect(ws().options.defaultKey).toBeNull()
  })

  it('a copy of the chip follows the mouse out of the side panel, and the key under it lights up', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))

    const panel = shelf().closest('aside')!.getBoundingClientRect()
    await carry(chip('Chrome'), padKey('F16'))
    await waitFor(() => expect(lit(padKey('F16'))).toBe(true))
    // The chip on the shelf dims; its copy is over the grid, outside the panel that would clip it.
    expect(chip('Chrome').className).toContain('opacity-40')
    expect(carried()?.textContent).toBe('Chrome')
    const copy = carried()!.getBoundingClientRect()
    expect(copy.left).toBeGreaterThan(panel.right)
    expect(Math.abs(copy.top - at(padKey('F16')).y)).toBeLessThan(60)

    await drop()
    await waitFor(() => expect(on('k4')).toBe('Chrome'))
    expect(carried()).toBeNull()
  })

  // The chip is wider than a key: its box reaches over F24, beside Fn, but the mouse decides.
  it('a parked layer dropped on the Fn key stays parked', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    await drag(chip('Chrome'), padKey('ScrollLock'))
    await settle()
    expect(parked()).toEqual(['Chrome'])
    // Even at the edge of Fn nearest F24.
    await drag(chip('Chrome'), at(padKey('ScrollLock'), 0.95, 0.5))
    await settle()
    expect(parked()).toEqual(['Chrome'])
    expect(on('k12')).toBeUndefined()
  })

  it('a parked layer dropped on the label strip above a key, or in the gap beside it, goes on that key', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))

    const f16 = padKey('F16').getBoundingClientRect()
    await drag(chip('Chrome'), { x: f16.left + f16.width / 2, y: f16.top - 12 })
    await waitFor(() => expect(on('k4')).toBe('Chrome'))

    // One pixel right of F21, in the gap before F23.
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    const f21 = padKey('F21').getBoundingClientRect()
    await drag(chip('Chrome'), { x: f21.right + 1, y: f21.top + f21.height / 2 })
    await waitFor(() => expect(on('k9')).toBe('Chrome'))
  })

  it('the box that carries the chip does not cover the page', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    await carry(chip('Chrome'), padKey('F16'))
    await waitFor(() => expect(carried()).not.toBeNull())
    const spot = at(padKey('F16'))
    expect(padKey('F16').contains(document.elementFromPoint(spot.x, spot.y))).toBe(true)
    await drop()
  })

  it('a parked layer let go off the grid stays parked', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    await drag(chip('Chrome'), screen.getByRole('tab', { name: 'Macros' }))
    await settle()
    expect(parked()).toEqual(['Chrome'])
    expect(screen.getByRole('tab', { name: 'Layers' }).getAttribute('aria-selected')).toBe('true')
  })

  it('a new layer starts on the shelf and can be dragged to a key', async () => {
    await start()
    await click(screen.getByRole('button', { name: '+ New layer' }))
    await waitFor(() => expect(parked()).toEqual(['New layer']))
    await drag(chip('New layer'), padKey('F21'))
    await waitFor(() => expect(on('k9')).toBe('New layer'))
    expect(parked()).toEqual([])
  })

  it('several parked layers keep their order, and each goes where it is dropped', async () => {
    await start()
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    await drag(layerKey('Media'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome', 'Media']))
    await drag(layerKey('Programs'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome', 'Media', 'Programs']))
    expect(within(shelf()).getAllByText(/^(Chrome|Media|Programs)$/).map((el) => el.textContent)).toEqual(['Chrome', 'Media', 'Programs'])

    await drag(chip('Media'), padKey('F15'))
    await waitFor(() => expect(on('k3')).toBe('Media'))
    expect(parked()).toEqual(['Chrome', 'Programs'])
  })

  it('no layer is lost or copied through a run of drags', async () => {
    await start()
    const before = allTitles()
    const macros = ws().slots.k3.macros

    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(parked()).toEqual(['Chrome']))
    await drag(layerKey('Media'), layerKey('Programs'))
    await waitFor(() => expect(on('k2')).toBe('Media'))
    await drag(chip('Chrome'), layerKey('Media'))
    await waitFor(() => expect(on('k2')).toBe('Chrome'))
    await drag(layerKey('Chrome'), padKey('F15'))
    await waitFor(() => expect(on('k3')).toBe('Chrome'))
    await drag(chip('Media'), padKey('F14'))
    await waitFor(() => expect(on('k2')).toBe('Media'))

    expect(allTitles()).toEqual(before)
    expect(parked()).toEqual([])
    // A layer's macros travel with it.
    expect(ws().slots.k3.macros).toEqual(macros)
  })
})
