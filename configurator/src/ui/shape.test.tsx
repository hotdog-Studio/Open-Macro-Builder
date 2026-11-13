/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Workspace } from '../core/config/model'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider, useApp } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

afterEach(cleanup)

/** Hands the test whatever useApp() gives the components. */
let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useEffect(() => {
    seen = app
  })
  return null
}

function ws(): Workspace {
  if (seen.state.screen !== 'edit') throw new Error('expected the editor')
  return seen.state.ws
}

/** The example repository with a personal config and settings already in local/, opened on the Pad shape tab. */
async function openPad() {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  const enc = new TextEncoder()
  await folder.writeBytes('local/config.json', enc.encode(readRepoText('config.json')))
  await folder.writeBytes(SETTINGS_PATH, enc.encode('{ "languages": ["ahk"] }\n'))
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
      <App />
      <Probe />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  const keys = await screen.findByRole('list', { name: 'Keys' })
  return { user, keys }
}

const keyButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name} \\d×\\d$`) })

describe('Pad shape tab', () => {
  it('draws each key with its name and size, and the Fn key', async () => {
    const { keys } = await openPad()
    expect(within(keys).getByRole('button', { name: 'F22 1×2' })).toBeTruthy()
    expect(within(keys).getByRole('button', { name: 'Fn ScrollLock 2×1' })).toBeTruthy()
  })

  it('selecting a key and typing renames it', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F14'))
    const field = screen.getByRole('textbox', { name: 'Keyboard key it sends' }) as HTMLInputElement
    expect(field.value).toBe('F14')
    await user.clear(field)
    await user.type(field, 'q')
    expect(ws().keys[1].key).toBe('q')
    expect(keyButton('q')).toBeTruthy()
  })

  it('capture sets the key name from the next key press', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F14'))
    await user.click(screen.getByRole('button', { name: 'Capture by pressing it' }))
    fireEvent.keyDown(window, { code: 'F13' })
    expect(ws().keys[1].key).toBe('F13')
    expect((screen.getByRole('textbox', { name: 'Keyboard key it sends' }) as HTMLInputElement).value).toBe('F13')
    // Capture ended: the next press changes nothing.
    fireEvent.keyDown(window, { code: 'KeyQ' })
    expect(ws().keys[1].key).toBe('F13')
  })

  it('capture says so when the key has no AutoHotkey name', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F14'))
    await user.click(screen.getByRole('button', { name: 'Capture by pressing it' }))
    fireEvent.keyDown(window, { code: 'IntlBackslash' })
    expect(screen.getByText('That key has no AutoHotkey name here; type it instead.')).toBeTruthy()
    expect(ws().keys[1].key).toBe('F14')
  })

  it('says that capture needs the macropad to be stopped', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F14'))
    expect(screen.getByText(/only while the macropad is not running/)).toBeTruthy()
  })

  it('adds a key in a free square and selects it', async () => {
    const { user } = await openPad()
    await user.click(screen.getByRole('button', { name: '+ Add key' }))
    expect(ws().keys).toHaveLength(13)
    const added = ws().keys[12]
    // F13 to F24 are taken, so the new key starts with the first free name.
    expect(added.key).toBe('F1')
    expect(new Set(ws().keys.map((k) => k.key)).size).toBe(13)
    expect((screen.getByRole('textbox', { name: 'Keyboard key it sends' }) as HTMLInputElement).value).toBe(added.key)
  })

  it('remove asks first and lists what it clears', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F14'))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Programs')
    expect(dialog.textContent).toContain('Play')
    expect(ws().keys).toHaveLength(12)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ws().keys).toHaveLength(12)

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove key' }))
    expect(ws().keys).toHaveLength(11)
    expect(ws().keys.some((k) => k.key === 'F14')).toBe(false)
    expect(ws().parked.map((l) => l.title)).toContain('Programs')
  })

  it('leaves a new key unnamed once F1 to F24 are all used', async () => {
    const { user } = await openPad()
    // F13 to F24 are taken; twelve more keys take F1 to F12.
    for (let i = 0; i < 13; i++) await user.click(screen.getByRole('button', { name: '+ Add key' }))
    expect(ws().keys).toHaveLength(25)
    expect(ws().keys[24].key).toBe('')
    expect((screen.getByRole('textbox', { name: 'Keyboard key it sends' }) as HTMLInputElement).value).toBe('')
  })

  it('says nothing is assigned when the key to remove has no layer or macros', async () => {
    const { user } = await openPad()
    await user.click(screen.getByRole('button', { name: '+ Add key' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(within(screen.getByRole('dialog')).getByText('Nothing is assigned to this key.')).toBeTruthy()
  })

  it('Escape closes the remove question without removing the key', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F14'))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ws().keys).toHaveLength(12)
  })

  it('refuses to remove the last macro key and says why', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F13'))
    act(() => seen.dispatch({ type: 'edit', ws: { ...ws(), keys: [ws().keys[0]] } }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(within(await screen.findByRole('alert')).getByText('A pad needs at least one macro key.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ws().keys).toHaveLength(1)
  })

  it('keeps the key and says why when the pad shrank while the remove question was open', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F13'))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    // For example a reload from disk replaced the pad while the question was showing.
    act(() => seen.dispatch({ type: 'edit', ws: { ...ws(), keys: [ws().keys[0]] } }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove key' }))
    expect(within(await screen.findByRole('alert')).getByText('A pad needs at least one macro key.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ws().keys).toHaveLength(1)
  })

  it('the banner goes away when it is dismissed', async () => {
    const { user } = await openPad()
    await user.click(keyButton('F13'))
    act(() => seen.dispatch({ type: 'edit', ws: { ...ws(), keys: [ws().keys[0]] } }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const banner = await screen.findByRole('alert')
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not offer to remove the Fn key', async () => {
    const { user } = await openPad()
    await user.click(screen.getByRole('button', { name: 'Fn ScrollLock 2×1' }))
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the options change the workspace', async () => {
    const { user } = await openPad()
    expect(ws().options.showLabels).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: 'Show labels above keys' }))
    expect(ws().options.showLabels).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: 'Outline keys that have a macro' }))
    expect(ws().options.showMacroMarkers).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: 'Use per-macro icons' }))
    expect(ws().options.useMacroIcons).toBe(true)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Clicking an icon' }), 'runs the macro')
    expect(ws().options.iconAction).toBe('Macro')
  })

  it('shows the Fn key option with its label', async () => {
    const { user } = await openPad()
    const label = screen.getByRole('textbox', { name: 'Fn label' }) as HTMLInputElement
    expect(label.value).toBe(' ')
    await user.clear(label)
    await user.type(label, 'Fn')
    expect(ws().options.showFn).toBe('Fn')

    await user.click(screen.getByRole('checkbox', { name: 'Show the Fn key' }))
    expect(ws().options.showFn).toBe(false)
    expect(label.disabled).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: 'Show the Fn key' }))
    expect(ws().options.showFn).toBe(true)
  })
})
