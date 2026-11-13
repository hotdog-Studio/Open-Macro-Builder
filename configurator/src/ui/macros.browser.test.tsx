import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { Macro } from '../core/config/model'
import { at, carried, carry, carryOn, click, dirty, drag, dragNoWait, drop, openTab, padKey, startApp, strip, unmount, ws } from '../../test/browser/harness'

// The example pad on the Macros tab opens on Media, the start layer: Prev on F13, Play on F14,
// Next on F15, Vol + on F22 and Vol - on F23. The other keys have no macro. Programs, on F14 in
// the Layers tab, has a macro on every key.

afterEach(unmount)

const start = () => startApp('Macros')
const settle = () => new Promise((done) => setTimeout(done, 150))

/** A row of the command list, scrolled into view so the mouse can reach it. */
function command(name: string): HTMLElement {
  const rows = document.querySelectorAll<HTMLElement>(`[data-command="${name}"]`)
  if (rows.length === 0) throw new Error(`the command list has no ${name}`)
  rows[0].scrollIntoView({ block: 'center' })
  return rows[0]
}

const layerNamed = (title: string) => {
  const layer = Object.values(ws().slots).find((l) => l.title === title)
  if (!layer) throw new Error(`no layer ${title}`)
  return layer
}
/** The macro on a key of a layer; the keys are k1 (F13) to k12 (F24). */
const macro = (key: string, layer = 'Media'): Macro | undefined => layerNamed(layer).macros[key]
const lit = (el: HTMLElement) => el.className.split(' ').includes('ring-sky-400')
const palette = () => screen.getByRole('region', { name: 'Commands' })

describe('Macros tab: dragging a command onto a key', () => {
  it('puts the command on an empty key, with a label and the description from its file', async () => {
    await start()
    expect(macro('k4')).toBeUndefined()
    const described = command('Lock').getAttribute('title')

    await drag(command('Lock'), padKey('F16'))

    await waitFor(() => expect(macro('k4')).toMatchObject({ action: 'Lock', name: 'Lock' }))
    expect(described).toBeTruthy()
    expect(macro('k4')?.description).toBe(described)
    expect(strip('F16')).toBe('Lock')
    expect(dirty()).toBe(true)
  })

  it('spaces out the words of the command for the label', async () => {
    await start()
    await drag(command('TurnMonitorsOff'), padKey('F17'))
    await waitFor(() => expect(macro('k5')).toMatchObject({ action: 'TurnMonitorsOff', name: 'Turn Monitors Off' }))
    expect(strip('F17')).toBe('Turn Monitors Off')
  })

  it('replaces the macro on a key that has one', async () => {
    await start()
    expect(macro('k1')?.action).toBe('PreviousTrack')
    await drag(command('Lock'), padKey('F13'))
    await waitFor(() => expect(macro('k1')?.action).toBe('Lock'))
    expect(strip('F13')).toBe('Lock')
    // Only that key changed.
    expect(macro('k2')?.action).toBe('PlayPause')
  })

  it('goes on the layer the grid shows, not on the start layer', async () => {
    await start()
    await click(screen.getByRole('button', { name: 'Programs' }))
    await waitFor(() => expect(strip('F13')).toBe('Explorer'))

    await drag(command('Lock'), padKey('F13'))

    await waitFor(() => expect(macro('k1', 'Programs')?.action).toBe('Lock'))
    expect(macro('k1', 'Media')?.action).toBe('PreviousTrack')
  })

  it('goes on the layer that Edit macros opened', async () => {
    await startApp('Layers')
    await click(within(screen.getByRole('list', { name: 'Keys' })).getByRole('button', { name: 'Chrome' }))
    await click(screen.getByRole('button', { name: 'Edit macros →' }))
    await waitFor(() => expect(strip('F13')).toBe('YouTube'))

    await drag(command('Lock'), padKey('F13'))
    await waitFor(() => expect(macro('k1', 'Chrome')?.action).toBe('Lock'))
    expect(macro('k1', 'Media')?.action).toBe('PreviousTrack')
  })

  it('a copy of the row follows the mouse out of the list, and the key under it lights up', async () => {
    await start()
    const panel = palette().closest('aside')!.getBoundingClientRect()
    const row = command('Lock')
    await carry(row, padKey('F16'))

    await waitFor(() => expect(lit(padKey('F16'))).toBe(true))
    expect(row.className).toContain('opacity-40')
    expect(carried()?.textContent).toBe('Lock')
    expect(carried()!.getBoundingClientRect().left).toBeGreaterThan(panel.right)
    expect(macro('k4')).toBeUndefined()

    await carryOn(padKey('F17'))
    await waitFor(() => expect(lit(padKey('F17'))).toBe(true))
    expect(lit(padKey('F16'))).toBe(false)

    await drop()
    await waitFor(() => expect(macro('k5')?.action).toBe('Lock'))
    expect(macro('k4')).toBeUndefined()
    expect(row.className).not.toContain('opacity-40')
    expect(carried()).toBeNull()
  })

  it('a command from the bottom of the list can be dragged once scrolled to', async () => {
    await start()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-command]')]
    const last = rows[rows.length - 1].getAttribute('data-command')!
    const panel = palette().closest('aside')!
    // The list is longer than the panel, so the last row starts out of sight.
    expect(rows[rows.length - 1].getBoundingClientRect().top).toBeGreaterThan(panel.getBoundingClientRect().bottom)

    await drag(command(last), padKey('F18'))
    await waitFor(() => expect(macro('k6')?.action).toBe(last))
  })

  it('a command found by searching can be dragged', async () => {
    await start()
    await userEvent.fill(screen.getByRole('searchbox', { name: 'Search commands' }), 'hibern')
    await waitFor(() => expect(document.querySelectorAll('[data-command]')).toHaveLength(1))

    await drag(command('Hibernate'), padKey('F19'))
    await waitFor(() => expect(macro('k7')?.action).toBe('Hibernate'))
  })

  it('the same command can go on several keys', async () => {
    await start()
    await drag(command('Lock'), padKey('F16'))
    await waitFor(() => expect(macro('k4')?.action).toBe('Lock'))
    await drag(command('Lock'), padKey('F17'))
    await waitFor(() => expect(macro('k5')?.action).toBe('Lock'))
    expect(macro('k4')?.action).toBe('Lock')
  })

  // The row is wider than a key: its box reaches over F24, beside Fn, but the mouse decides.
  it('a command dropped on the Fn key goes nowhere', async () => {
    await start()
    const before = layerNamed('Media').macros
    await drag(command('Lock'), padKey('ScrollLock'))
    await settle()
    expect(layerNamed('Media').macros).toEqual(before)
    // Even at the edge of Fn nearest F24.
    await drag(command('Lock'), at(padKey('ScrollLock'), 0.95, 0.5))
    await settle()
    expect(layerNamed('Media').macros).toEqual(before)
    expect(dirty()).toBe(false)
  })

  it('a command dropped on the label strip above a key goes on that key', async () => {
    await start()
    const f16 = padKey('F16').getBoundingClientRect()
    await drag(command('Lock'), { x: f16.left + f16.width / 2, y: f16.top - 12 })
    await waitFor(() => expect(macro('k4')?.action).toBe('Lock'))
    // The strip belongs to the key under it, not the one over it.
    expect(macro('k1')?.action).toBe('PreviousTrack')
  })

  it('a command dropped in the gap between two keys goes on the nearer one', async () => {
    await start()
    const f17 = padKey('F17').getBoundingClientRect()
    await drag(command('Lock'), { x: f17.left - 1, y: f17.top + f17.height / 2 })
    await waitFor(() => expect(macro('k5')?.action).toBe('Lock'))
    expect(macro('k4')).toBeUndefined()

    const f18 = padKey('F18').getBoundingClientRect()
    await drag(command('Hibernate'), { x: f18.left + f18.width / 2, y: f18.bottom + 1 })
    await waitFor(() => expect(macro('k6')?.action).toBe('Hibernate'))
  })

  it('the box that carries the row does not cover the page', async () => {
    await start()
    await carry(command('Lock'), padKey('F16'))
    await waitFor(() => expect(carried()).not.toBeNull())
    const spot = at(padKey('F16'))
    expect(padKey('F16').contains(document.elementFromPoint(spot.x, spot.y))).toBe(true)
    await drop()
  })

  it('a command let go off the grid goes nowhere', async () => {
    await start()
    const before = layerNamed('Media').macros
    await drag(command('Lock'), screen.getByRole('tab', { name: 'Layers' }))
    await settle()
    await drag(command('Lock'), command('Hibernate'))
    await settle()
    expect(layerNamed('Media').macros).toEqual(before)
    expect(dirty()).toBe(false)
    expect(screen.getByRole('tab', { name: 'Macros' }).getAttribute('aria-selected')).toBe('true')
  })

  it('Escape during a drag cancels it', async () => {
    await start()
    await carry(command('Lock'), padKey('F16'))
    await waitFor(() => expect(lit(padKey('F16'))).toBe(true))
    await userEvent.keyboard('{Escape}')
    await drop()
    await settle()
    expect(macro('k4')).toBeUndefined()
    expect(dirty()).toBe(false)
  })

  it('the new macro shows in the details when its key is selected', async () => {
    await start()
    await drag(command('Lock'), padKey('F16'))
    await waitFor(() => expect(macro('k4')?.action).toBe('Lock'))
    await click(padKey('F16'))
    expect((screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement).value).toBe('Lock')
    expect((screen.getByRole('textbox', { name: 'Label (shown on the overlay)' }) as HTMLInputElement).value).toBe('Lock')
    expect(screen.getByRole('heading', { level: 3, name: 'Media · F16' })).toBeTruthy()
  })
})

describe('Macros tab: dragging a macro between keys', () => {
  it('swaps two macros', async () => {
    await start()
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(macro('k1')?.name).toBe('Play'))
    expect(macro('k2')?.name).toBe('Prev')
    expect(strip('F13')).toBe('Play')
    expect(strip('F14')).toBe('Prev')
    expect(dirty()).toBe(true)
  })

  it('moves a macro to an empty key, whole', async () => {
    await start()
    const prev = macro('k1')
    await drag(padKey('F13'), padKey('F16'))
    await waitFor(() => expect(macro('k4')).toEqual(prev))
    expect(macro('k1')).toBeUndefined()
    expect(strip('F13')).toBeNull()
    expect(strip('F16')).toBe('Prev')
  })

  it('swaps a small key with a tall one', async () => {
    await start()
    await drag(padKey('F15'), padKey('F22'))
    await waitFor(() => expect(macro('k10')?.name).toBe('Next'))
    expect(macro('k3')?.name).toBe('Vol +')
  })

  it('changes only the layer the grid shows', async () => {
    await start()
    const media = layerNamed('Media').macros
    await click(screen.getByRole('button', { name: 'Programs' }))
    await waitFor(() => expect(strip('F13')).toBe('Explorer'))

    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(macro('k1', 'Programs')?.name).toBe('PowerShell'))
    expect(macro('k2', 'Programs')?.name).toBe('Explorer')
    expect(layerNamed('Media').macros).toEqual(media)
  })

  it('a macro can be picked up again the instant it is dropped, from where the mouse is', async () => {
    await start()
    const [f13, f16, f24] = [at(padKey('F13')), at(padKey('F16')), at(padKey('F24'))]
    await dragNoWait(f13, f16)
    await dragNoWait(f16, f24)
    await waitFor(() => expect(macro('k12')?.name).toBe('Prev'))
    expect(macro('k1')).toBeUndefined()
    expect(macro('k4')).toBeUndefined()
  })

  it('a key with no macro cannot be dragged', async () => {
    await start()
    await drag(padKey('F16'), padKey('F13'))
    await settle()
    expect(macro('k1')?.name).toBe('Prev')
    expect(macro('k4')).toBeUndefined()
    expect(dirty()).toBe(false)
  })

  it('a macro dropped on the Fn key, off the grid or back on its own key stays where it was', async () => {
    await start()
    const before = layerNamed('Media').macros
    await drag(padKey('F13'), padKey('ScrollLock'))
    await settle()
    await drag(padKey('F13'), command('Lock'))
    await settle()
    // Its place is read before the drag: a key being dragged is wherever the mouse has it.
    const home = at(padKey('F13'))
    await carry(home, padKey('F14'))
    await carryOn(home)
    await drop()
    await settle()
    expect(layerNamed('Media').macros).toEqual(before)
    expect(dirty()).toBe(false)
  })

  it('the key under the mouse lights up, and nothing changes until the button is let go', async () => {
    await start()
    await carry(padKey('F13'), padKey('F16'))
    await waitFor(() => expect(lit(padKey('F16'))).toBe(true))
    expect(macro('k1')?.name).toBe('Prev')
    await drop()
    await waitFor(() => expect(macro('k4')?.name).toBe('Prev'))
    expect(lit(padKey('F16'))).toBe(false)
  })

  it('a press that moves less than 5 px selects the key and moves nothing', async () => {
    await start()
    const spot = padKey('F14').getBoundingClientRect()
    await drag(padKey('F14'), { x: spot.left + spot.width / 2 + 3, y: spot.top + spot.height / 2 + 2 }, 3)
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Media · F14' })).toBeTruthy())
    expect(dirty()).toBe(false)
  })

  it('a moved macro can be moved again, and a command dropped where it was', async () => {
    await start()
    await drag(padKey('F13'), padKey('F16'))
    await waitFor(() => expect(macro('k4')?.name).toBe('Prev'))
    await drag(padKey('F16'), padKey('F24'))
    await waitFor(() => expect(macro('k12')?.name).toBe('Prev'))
    await drag(command('Lock'), padKey('F13'))
    await waitFor(() => expect(macro('k1')?.action).toBe('Lock'))
    expect(macro('k4')).toBeUndefined()
  })

  it('the layers keep their macros through the Layers tab and back', async () => {
    await start()
    await drag(padKey('F13'), padKey('F16'))
    await waitFor(() => expect(macro('k4')?.name).toBe('Prev'))
    await openTab('Layers')
    await openTab('Macros')
    expect(strip('F16')).toBe('Prev')
    expect(strip('F13')).toBeNull()
  })
})
