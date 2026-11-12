/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../core/config/model'
import { SETTINGS_PATH } from '../core/settings'
import { LANGUAGES, type LangId } from '../core/languages'
import type { Platform } from '../platform/types'
import { AppProvider, useApp } from '../state/store'
import { editorView } from '../../test/codeEditor'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'
import { applyDrop, commandDescription } from './dnd'

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

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

interface Setup {
  languages?: LangId[]
  /** Changes the example config before it is written to local/config.json. */
  config?: (c: { layers: { macros: unknown[] }[] }) => void
  /** Extra files for the folder. */
  files?: Record<string, string>
}

async function start({ languages = ['ahk', 'ps'], config, files = {} }: Setup = {}) {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  const enc = new TextEncoder()
  const parsed = JSON.parse(readRepoText('config.json'))
  config?.(parsed)
  await folder.writeBytes('local/config.json', enc.encode(JSON.stringify(parsed, null, 2) + '\n'))
  await folder.writeBytes(SETTINGS_PATH, enc.encode(JSON.stringify({ languages }) + '\n'))
  for (const [path, text] of Object.entries(files)) await folder.writeBytes(path, enc.encode(text))
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
      <App />
      <Probe />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  await user.click(screen.getByRole('tab', { name: 'Macros' }))
  return { user, folder }
}

/** A key of the grid by its name; its name may carry a `not in …` note. */
const key = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}( |$)`) })
/** The pad in the middle panel; the overlay preview in the right panel shows the same names. */
const grid = () => within(screen.getByRole('main'))
const palette = () => screen.getByRole('region', { name: 'Commands' })
const layerButton = (title: string) => screen.getByRole('button', { name: title })

describe('Macros tab', () => {
  it('layer buttons choose the layer shown on the grid', async () => {
    const { user } = await start()
    // The pad starts on the first layer, Media.
    expect(grid().getByText('Prev')).toBeTruthy()
    expect(layerButton('Media').getAttribute('aria-pressed')).toBe('true')
    expect(layerButton('Chrome').getAttribute('aria-pressed')).toBe('false')
    expect(grid().queryByText('YouTube')).toBeNull()

    await user.click(layerButton('Chrome'))
    expect(grid().getByText('YouTube')).toBeTruthy()
    expect(grid().queryByText('Prev')).toBeNull()
    expect(layerButton('Chrome').getAttribute('aria-pressed')).toBe('true')
    expect(seen.state.screen === 'edit' && seen.state.selectedLayer).toBe(ws().slots.k3.id)
  })

  it('opens on the layer that Edit macros chose', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await user.click(screen.getByRole('button', { name: /^Programs/ }))
    await user.click(screen.getByRole('button', { name: 'Edit macros →' }))
    expect(layerButton('Programs').getAttribute('aria-pressed')).toBe('true')
    expect(grid().getByText('Explorer')).toBeTruthy()
  })

  it('shows each key name, and the macro name in the label strip', async () => {
    await start()
    expect(key('F13')).toBeTruthy()
    expect(grid().getByText('Play')).toBeTruthy()
    expect(grid().getByText('Vol +')).toBeTruthy()
  })

  it('search filters commands by name or description', async () => {
    const { user } = await start()
    expect(within(palette()).getByText('OpenYoutube')).toBeTruthy()
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'incognito')
    expect(within(palette()).getByText('ChromeOpenIncognitoWindow')).toBeTruthy()
    expect(within(palette()).queryByText('OpenYoutube')).toBeNull()
    expect(within(palette()).queryByText('ChromeNewTab')).toBeNull()
    // A description match counts too.
    await user.clear(screen.getByRole('searchbox', { name: 'Search commands' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'opens youtube')
    expect(within(palette()).getByText('OpenYoutube')).toBeTruthy()
    expect(within(palette()).queryByText('ChromeNewTab')).toBeNull()
  })

  it('groups commands by file, yours first', async () => {
    await start({
      files: {
        'local/ahk/zz_mine.ahk': 'ZzMine(Macro)\n{\n}\n',
        'local/powershell/commands/zz_mine.ps1': 'function ZzMine { param($Macro) }\n',
      },
    })
    const groups = within(palette()).getAllByRole('group')
    expect(groups.length).toBeGreaterThan(1)
    expect(within(groups[0]).getByText('yours')).toBeTruthy()
    expect(within(groups.at(-1)!).queryByText('yours')).toBeNull()
  })

  it('editing the label, description and icon updates the macro', async () => {
    const { user } = await start()
    await user.click(layerButton('Chrome'))
    await user.click(key('F13'))
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('OpenYoutube')
    expect((screen.getByLabelText('Command') as HTMLInputElement).readOnly).toBe(true)

    const label = screen.getByLabelText('Label (shown on the overlay)')
    await user.clear(label)
    await user.type(label, 'Tube')
    expect(ws().slots.k3.macros.k1.name).toBe('Tube')
    expect(grid().getByText('Tube')).toBeTruthy()

    const description = screen.getByLabelText('Description (tooltip)')
    await user.clear(description)
    expect(ws().slots.k3.macros.k1).not.toHaveProperty('description')
    await user.type(description, 'Video site')
    expect(ws().slots.k3.macros.k1.description).toBe('Video site')

    expect(ws().slots.k3.macros.k1).not.toHaveProperty('icon')
    expect(screen.getByRole('button', { name: 'Layer icon' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'chrome' }))
    expect(ws().slots.k3.macros.k1.icon).toBe('chrome')
    expect(screen.getByRole('button', { name: 'chrome' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Layer icon' }).getAttribute('aria-pressed')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Layer icon' }))
    expect(ws().slots.k3.macros.k1).not.toHaveProperty('icon')
  })

  it('Clear key empties the key', async () => {
    const { user } = await start()
    await user.click(key('F13'))
    expect(ws().slots.k1.macros.k1.action).toBe('PreviousTrack')
    await user.click(screen.getByRole('button', { name: 'Clear key' }))
    expect(ws().slots.k1.macros).not.toHaveProperty('k1')
    expect(grid().queryByText('Prev')).toBeNull()
    expect(screen.getByText(/Nothing on this key/)).toBeTruthy()
  })

  it('shows which languages define the command', async () => {
    const { user } = await start({
      files: { 'ahk/commands/custom/zz_only.ahk': 'ZzAhkOnly(Macro)\n{\n}\n' },
      config: (c) => {
        c.layers[0].macros[3] = { action: 'ZzAhkOnly', name: 'Only AHK' }
      },
    })
    await user.click(key('F13'))
    expect(screen.getByText('AutoHotkey ✓')).toBeTruthy()
    expect(screen.getByText('PowerShell ✓')).toBeTruthy()
    await user.click(key('F16'))
    expect(screen.getByText('AutoHotkey ✓')).toBeTruthy()
    expect(screen.getByText('PowerShell ✗')).toBeTruthy()
  })

  it('a command missing from a language you do not run is shown amber, not red', async () => {
    const { user } = await start({
      languages: ['ahk'],
      files: { 'ahk/commands/custom/zz_only.ahk': 'ZzAhkOnly(Macro)\n{\n}\n' },
      config: (c) => {
        c.layers[0].macros[3] = { action: 'ZzAhkOnly', name: 'Only AHK' }
      },
    })
    await user.click(key('F16'))
    expect(screen.getByText('AutoHotkey ✓').className).toContain('text-emerald-400')
    // Information only: you do not run PowerShell.
    expect(screen.getByText('PowerShell ✗').className).toContain('text-amber-400')
    // Once you run PowerShell, the missing command is a problem.
    await user.click(screen.getByRole('checkbox', { name: 'PowerShell' }))
    await waitFor(() => expect(screen.getByText('PowerShell ✗').className).toContain('text-red-400'))
  })

  it('a command missing in a language you run is marked', async () => {
    const { user } = await start({
      languages: ['ahk'],
      files: { 'powershell/commands/custom/zz_only.ps1': 'function ZzPsOnly { param($Macro) }\n' },
      config: (c) => {
        c.layers[0].macros[3] = { action: 'ZzPsOnly', name: 'Only PS' }
      },
    })
    const marked = key('F16')
    expect(within(marked).getByText('not in AHK')).toBeTruthy()
    expect(marked.innerHTML).toContain('border-red')
    expect(within(key('F13')).queryByText(/not in/)).toBeNull()
    // The palette says the same.
    const entry = within(palette()).getByText('ZzPsOnly').closest('[data-command]') as HTMLElement
    expect(within(entry).getByText('no AHK')).toBeTruthy()
    expect(within(entry).queryByText('no PS')).toBeNull()
    // A command both languages define carries no badge.
    const fine = within(palette()).getByText('PlayPause').closest('[data-command]') as HTMLElement
    expect(within(fine).queryByText(/^no /)).toBeNull()
    // A language you do not run is not held against the key.
    await user.click(screen.getByRole('checkbox', { name: 'PowerShell' }))
    expect(within(key('F16')).getByText('not in AHK')).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: 'AutoHotkey' }))
    await waitFor(() => expect(within(key('F16')).queryByText(/not in/)).toBeNull())
  })

  it('a command a language defines in another file pair is not missing', async () => {
    // AutoHotkey defines it in one file, PowerShell in a file with another name: two catalog entries, one command.
    await start({
      languages: ['ahk', 'ps'],
      files: {
        'ahk/commands/custom/zz_a.ahk': 'ZzSplit(Macro)\n{\n}\n',
        'powershell/commands/custom/zz_b.ps1': 'function ZzSplit { param($Macro) }\n',
      },
      config: (c) => {
        c.layers[0].macros[3] = { action: 'zzsplit', name: 'Split' }
      },
    })
    expect(within(key('F16')).queryByText(/not in/)).toBeNull()
    const entries = within(palette()).getAllByText('ZzSplit')
    expect(entries).toHaveLength(2)
    for (const e of entries) expect(within(e.closest('[data-command]') as HTMLElement).queryByText(/^no /)).toBeNull()
    // Each row can be dragged on its own: the two rows of one command have different drag ids.
    const ids = entries.map((e) => (e.closest('[data-command]') as HTMLElement).getAttribute('data-drag-id'))
    expect(ids.every((id) => id?.endsWith('/ZzSplit'))).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('placing a command fills name and description', async () => {
    await start()
    const state = seen.state
    if (state.screen !== 'edit') throw new Error('expected the editor')
    const layerId = state.ws.slots.k1.id
    expect(state.ws.slots.k1.macros).not.toHaveProperty('k5')
    // The drop PadDnd runs for a command dragged onto key k5.
    const done = applyDrop(
      state.ws,
      { type: 'setMacroFromCommand', command: 'OpenYoutube', key: 'k5' },
      layerId,
      (c) => commandDescription(state.catalog, c),
    )
    if (!done.ok) throw new Error(done.reason)
    seen.dispatch({ type: 'edit', ws: done.ws })
    await waitFor(() => expect(ws().slots.k1.macros.k5).toBeTruthy())
    const macro = ws().slots.k1.macros.k5
    expect(macro.action).toBe('OpenYoutube')
    expect(macro.name).toBe('Youtube')
    expect(macro.description).toBe('Opens YouTube in Google Chrome.')
    expect(grid().getByText('Youtube')).toBeTruthy()
  })
})

describe('Open in Commands', () => {
  const lineOf = (lang: 'ahk' | 'ps', path: string) =>
    LANGUAGES[lang].findFunctions(readRepoText(path)).find((f) => f.name === 'PreviousTrack')!.line
  const cursorLine = () => {
    const { state } = editorView()
    return state.doc.lineAt(state.selection.main.head).number
  }

  it("shows the command's file and line", async () => {
    const { user } = await start()
    await user.click(key('F13'))
    const path = 'ahk/commands/media.ahk'
    await user.click(screen.getByRole('button', { name: 'Open in Commands' }))

    expect(screen.getByRole('tab', { name: 'Commands' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'AutoHotkey' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByRole('toolbar')).getByText(path)).toBeTruthy()
    expect(cursorLine()).toBe(lineOf('ahk', path))
  })

  it('opens the PowerShell file when that is the language you run', async () => {
    const { user } = await start({ languages: ['ps'] })
    await user.click(key('F13'))
    await user.click(screen.getByRole('button', { name: 'Open in Commands' }))
    const path = 'powershell/commands/media.ps1'
    expect(within(screen.getByRole('toolbar')).getByText(path)).toBeTruthy()
    expect(cursorLine()).toBe(lineOf('ps', path))
  })

  it('is not offered for a command that no file defines', async () => {
    const { user } = await start({
      config: (c) => {
        ;(c.layers[0].macros[0] as { action: string }).action = 'NoSuchCommand'
      },
    })
    await user.click(key('F13'))
    expect(screen.queryByRole('button', { name: 'Open in Commands' })).toBeNull()
  })
})
