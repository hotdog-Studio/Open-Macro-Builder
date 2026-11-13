import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { banner, click, dirty, drag, padKey, startApp, strip, unmount, ws } from '../../test/browser/harness'

// Everything the mouse can drag, done from the keyboard with real key presses: Alt + an arrow key
// moves or swaps the focused key, Shift + Alt + an arrow key resizes it, and Enter on a command or
// a parked layer puts it on the selected key.

afterEach(unmount)

const settle = () => new Promise((done) => setTimeout(done, 150))
const alt = (arrow: 'Up' | 'Down' | 'Left' | 'Right') => userEvent.keyboard(`{Alt>}{Arrow${arrow}}{/Alt}`)
const shiftAlt = (arrow: 'Up' | 'Down' | 'Left' | 'Right') =>
  userEvent.keyboard(`{Shift>}{Alt>}{Arrow${arrow}}{/Alt}{/Shift}`)
const focused = () => document.activeElement

const keyOf = (name: string) => {
  const found = [ws().fn, ...ws().keys].find((k) => k.key === name)
  if (!found) throw new Error(`no key ${name}`)
  return found
}
const keys = () => screen.getByRole('list', { name: 'Keys' })
const layerKey = (title: string) =>
  within(keys()).getByRole('button', { name: new RegExp(`^${title}( Start layer)?$`) })
const on = (key: string) => ws().slots[key]?.title
const shelf = () => screen.getByRole('group', { name: 'Parked' })
const chip = (title: string) => within(shelf()).getByText(title).closest('[aria-roledescription="draggable"]') as HTMLElement
const command = (name: string) => {
  const row = document.querySelector<HTMLElement>(`[data-command="${name}"]`)
  if (!row) throw new Error(`the command list has no ${name}`)
  return row
}
const media = () => Object.values(ws().slots).find((l) => l.title === 'Media')!.macros

describe('Pad shape tab, from the keyboard', () => {
  it('Alt + arrow moves the focused key one square, and it stays focused and selected', async () => {
    await startApp()
    padKey('F24').focus()
    await alt('Down')
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 5, col: 3 }))
    await waitFor(() => expect(focused()).toBe(padKey('F24')))
    expect(screen.getByRole('heading', { level: 3, name: 'Macro key 12 of 12' })).toBeTruthy()

    // Still focused, so the next presses carry on.
    await alt('Left')
    await alt('Left')
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ row: 5, col: 1 }))
    expect(dirty()).toBe(true)
    expect(banner()).toBeNull()
  })

  it('says why when the square is taken or off the pad, and moves nothing', async () => {
    await startApp()
    padKey('F13').focus()
    await alt('Right')
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    await alt('Up')
    await waitFor(() => expect(banner()).toBe('Keys start at row 1 and column 1.'))
    expect(keyOf('F13')).toMatchObject({ row: 1, col: 1 })
    expect(dirty()).toBe(false)
  })

  it('moves the Fn key', async () => {
    await startApp()
    padKey('ScrollLock').focus()
    await alt('Down')
    await waitFor(() => expect(ws().fn).toMatchObject({ row: 5, col: 1, width: 2 }))
  })

  it('Shift + Alt + arrow resizes: right and down grow, left and up shrink, never below one square', async () => {
    await startApp()
    padKey('F24').focus()
    await shiftAlt('Down')
    await waitFor(() => expect(keyOf('F24')).toMatchObject({ height: 2 }))
    expect(screen.getByRole('button', { name: 'F24 1×2' })).toBeTruthy()
    await shiftAlt('Up')
    await waitFor(() => expect(keyOf('F24')).not.toHaveProperty('height'))
    await shiftAlt('Up')
    await shiftAlt('Left')
    await settle()
    expect(keyOf('F24')).toMatchObject({ row: 4, col: 3 })
    expect(keyOf('F24')).not.toHaveProperty('width')
    expect(banner()).toBeNull()
  })

  it('refuses to grow over another key', async () => {
    await startApp()
    padKey('F13').focus()
    await shiftAlt('Right')
    await waitFor(() => expect(banner()).toBe('That space is taken.'))
    expect(keyOf('F13')).not.toHaveProperty('width')
  })

  it('arrow keys without Alt move nothing, and Enter selects the focused key', async () => {
    await startApp()
    padKey('F18').focus()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Macro key 6 of 12' })).toBeTruthy())
    expect(keyOf('F18')).toMatchObject({ row: 2, col: 3 })
    expect(dirty()).toBe(false)
  })

  it('every key can be reached with Tab', async () => {
    await startApp()
    padKey('ScrollLock').focus()
    await userEvent.keyboard('{Tab}')
    // After the Fn key comes its resize corner, then the first macro key.
    expect(focused()).toBe(screen.getByRole('button', { name: 'Resize ScrollLock' }))
    await userEvent.keyboard('{Tab}')
    expect(focused()).toBe(padKey('F13'))
  })
})

describe('Layers tab, from the keyboard', () => {
  it('Alt + arrow swaps the layer with the key beside it, and focus goes with the layer', async () => {
    await startApp('Layers')
    layerKey('Media').focus()
    await alt('Right')
    await waitFor(() => expect(on('k2')).toBe('Media'))
    expect(on('k1')).toBe('Programs')
    await waitFor(() => expect(focused()).toBe(layerKey('Media')))
    expect(screen.getByRole('heading', { level: 3, name: 'Fn + F14' })).toBeTruthy()

    await alt('Right')
    await waitFor(() => expect(on('k3')).toBe('Media'))
    expect(on('k2')).toBe('Chrome')
    // The start star went with it.
    expect(ws().options.defaultKey).toBe('k3')
  })

  it('moves a layer onto a neighbouring key that has none', async () => {
    await startApp('Layers')
    layerKey('Media').focus()
    await alt('Down')
    await waitFor(() => expect(on('k4')).toBe('Media'))
    expect(on('k1')).toBeUndefined()
  })

  it('finds a tall neighbour, and the neighbour of a tall key', async () => {
    await startApp('Layers')
    // F15 has F22 (two rows tall) on its right.
    layerKey('Chrome').focus()
    await alt('Right')
    await waitFor(() => expect(on('k10')).toBe('Chrome'))
    expect(on('k3')).toBe('Windows')
    // From F22, down is F23.
    await alt('Down')
    await waitFor(() => expect(on('k11')).toBe('Chrome'))
    expect(on('k10')).toBe('Window Management')
  })

  it('does nothing at the edge of the pad, towards the Fn key, or on a key with no layer', async () => {
    await startApp('Layers')
    const before = ws().slots
    layerKey('Media').focus()
    await alt('Left')
    await alt('Up')
    // F19 has the Fn key under it.
    layerKey('VS Studio').focus()
    await alt('Down')
    padKey('F16').focus()
    await alt('Right')
    await settle()
    expect(ws().slots).toEqual(before)
    expect(dirty()).toBe(false)
    expect(banner()).toBeNull()
  })

  it('Enter on a parked layer puts it on the selected key', async () => {
    await startApp('Layers')
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))

    await click(padKey('F16'))
    chip('Chrome').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(on('k4')).toBe('Chrome'))
    expect(ws().parked).toEqual([])
  })

  it('Space on a parked layer swaps it with the layer on the selected key', async () => {
    await startApp('Layers')
    await drag(layerKey('Chrome'), shelf())
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))
    await click(layerKey('Programs'))
    chip('Chrome').focus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(on('k2')).toBe('Chrome'))
    expect(ws().parked.map((l) => l.title)).toEqual(['Programs'])
  })

  it('Enter on a parked layer with no key selected says to select one', async () => {
    await startApp('Layers')
    await click(screen.getByRole('button', { name: '+ New layer' }))
    await waitFor(() => expect(ws().parked).toHaveLength(1))
    chip('New layer').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(banner()).toBe('Select a key first, then press Enter on the parked layer to put it there.'))
    expect(ws().parked).toHaveLength(1)
  })
})

describe('Macros tab, from the keyboard', () => {
  it('Alt + arrow swaps the macro with the key beside it, and focus goes with the macro', async () => {
    await startApp('Macros')
    padKey('F13').focus()
    await alt('Right')
    await waitFor(() => expect(media().k2?.name).toBe('Prev'))
    expect(media().k1?.name).toBe('Play')
    await waitFor(() => expect(focused()).toBe(padKey('F14')))

    await alt('Down')
    await waitFor(() => expect(media().k5?.name).toBe('Prev'))
    expect(media().k2).toBeUndefined()
    expect(strip('F17')).toBe('Prev')
  })

  it('a key with no macro does not move', async () => {
    await startApp('Macros')
    const before = media()
    padKey('F16').focus()
    await alt('Up')
    await settle()
    expect(media()).toEqual(before)
    expect(dirty()).toBe(false)
  })

  it('Enter on a command puts it on the selected key, with its description', async () => {
    await startApp('Macros')
    await click(padKey('F16'))
    command('Lock').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(media().k4).toMatchObject({ action: 'Lock', name: 'Lock' }))
    expect(media().k4?.description).toBe(command('Lock').getAttribute('title'))
    expect(strip('F16')).toBe('Lock')
    // The details on the right show it straight away.
    expect((screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement).value).toBe('Lock')
  })

  it('Space on a command replaces the macro on the selected key', async () => {
    await startApp('Macros')
    await click(padKey('F13'))
    command('Hibernate').focus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(media().k1?.action).toBe('Hibernate'))
  })

  it('Enter on a command with no key selected, or with Fn selected, says to select a key', async () => {
    await startApp('Macros')
    const before = media()
    command('Lock').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(banner()).toBe('Select a key first, then press Enter on a command to put it there.'))
    await click(screen.getByRole('button', { name: 'Dismiss' }))

    await click(padKey('ScrollLock'))
    command('Lock').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(banner()).toBe('Select a key first, then press Enter on a command to put it there.'))
    expect(media()).toEqual(before)
    expect(dirty()).toBe(false)
  })

  it('typing in the search box does not place commands', async () => {
    await startApp('Macros')
    await click(padKey('F16'))
    const before = media()
    await userEvent.fill(screen.getByRole('searchbox', { name: 'Search commands' }), 'lock screen ')
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(media()).toEqual(before)
  })
})
