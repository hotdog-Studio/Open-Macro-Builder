/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Component, useLayoutEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renameKey } from '../core/config/ops'
import { parseConfig } from '../core/config/parse'
import { MemoryFolder } from '../core/folder/memory'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { readRepoText } from '../../test/repo'
import { App } from '../ui/App'
import { AppProvider, initialState, reducer, useApp, useEditor, type Action, type StoredState } from './store'

afterEach(cleanup)

/** Hands the test whatever useApp() gives the components. */
let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useLayoutEffect(() => {
    seen = app
  })
  return null
}

it('works out dirty from ws and saved after every edit', async () => {
  const folder = new MemoryFolder('repo', {
    'config.json': readRepoText('config.json'),
    'local/config.json': readRepoText('config.json'),
    'ahk/main.ahk': '',
    [SETTINGS_PATH]: '{ "languages": ["ahk"] }\n',
  })
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, createFolder: async () => null, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform} updateSource={null}>
      <App />
      <Probe />
    </AppProvider>,
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })

  const editing = () => {
    if (seen.state.screen !== 'edit') throw new Error('expected the editor')
    return seen.state
  }
  const saved = editing().saved
  expect(editing().dirty).toBe(false)

  act(() => seen.dispatch({ type: 'edit', ws: renameKey(editing().ws, 'k1', 'F1') }))
  expect(editing().dirty).toBe(true)

  // A different object with the saved content is not a change.
  act(() => seen.dispatch({ type: 'edit', ws: structuredClone(saved) }))
  expect(editing().ws).not.toBe(saved)
  expect(editing().dirty).toBe(false)
})

/** An editor state built by the reducer alone, with the example config. */
function editing(): StoredState {
  const ws = parseConfig(readRepoText('config.json'), 'config.json')
  const folder = new MemoryFolder('repo')
  const configFile = { path: 'config.json', text: '', eol: '\n' as const, bom: false, version: 'v1' }
  return reducer(initialState, {
    type: 'loaded',
    session: { folder, configFile, saved: ws, ws, catalog: [], commandFiles: [], iconSets: [], libraryFiles: [] },
    settings: { languages: ['ahk'] },
  })
}

describe('the reducer', () => {
  const edit = (): Action => ({ type: 'tab', tab: 'macros' })

  it('ignores edits while no folder is open', () => {
    expect(reducer(initialState, edit())).toBe(initialState)
    expect(reducer(initialState, { type: 'banner', banner: { text: 'x', kind: 'error' } })).toBe(initialState)
  })

  it('applies an edit to the editor', () => {
    expect(reducer(editing(), edit())).toMatchObject({ screen: 'edit', tab: 'macros' })
  })

  it('keeps the same state when the edit is the workspace it already holds', () => {
    const state = editing()
    if (state.screen !== 'edit') throw new Error('expected the editor')
    expect(reducer(state, { type: 'edit', ws: state.ws })).toBe(state)
  })

  it('keeps the same state when the disk still matches and no outside change was shown', () => {
    const state = editing()
    expect(reducer(state, { type: 'disk', changed: false, version: 'v1' })).toBe(state)
  })

  it('clears an outside change once the disk matches again', () => {
    const changed = reducer(editing(), { type: 'disk', changed: true, version: 'v2' })
    expect(changed).toMatchObject({ outsideChange: { version: 'v2', dismissed: false } })
    expect(reducer(changed, { type: 'disk', changed: false, version: 'v1' })).toMatchObject({ outsideChange: null })
  })

  it('keeps a dismissed outside change dismissed until the disk changes again', () => {
    const shown = reducer(editing(), { type: 'disk', changed: true, version: 'v2' })
    const dismissed = reducer(shown, { type: 'dismiss-disk' })
    expect(dismissed).toMatchObject({ outsideChange: { version: 'v2', dismissed: true } })
    expect(reducer(dismissed, { type: 'disk', changed: true, version: 'v2' })).toBe(dismissed)
    expect(reducer(dismissed, { type: 'disk', changed: true, version: 'v3' })).toMatchObject({
      outsideChange: { version: 'v3', dismissed: false },
    })
  })

  it('has nothing to dismiss when no outside change was shown', () => {
    const state = editing()
    expect(reducer(state, { type: 'dismiss-disk' })).toBe(state)
  })

  it('adds a notice to an error showing on a new line, and the error stays an error', () => {
    const failed = reducer(editing(), { type: 'banner', banner: { text: 'config.json was not saved.', kind: 'error' } })
    const joined = reducer(failed, { type: 'notice', text: 'A notice.' })
    expect(joined.screen === 'edit' && joined.banner).toEqual({ text: 'config.json was not saved.\nA notice.', kind: 'error' })
  })

  it('ignores a notice while no folder is open', () => {
    expect(reducer(initialState, { type: 'notice', text: 'A notice.' })).toBe(initialState)
  })

  it('leaves the editor when told to show the start screen', () => {
    expect(reducer(editing(), { type: 'show-open', message: 'Gone', reopen: 'repo' })).toEqual({
      screen: 'open',
      message: 'Gone',
      reopen: 'repo',
    })
  })
})

describe('useApp and useEditor', () => {
  /** Shows the message of whatever its child threw while rendering. */
  class Catch extends Component<{ children: ReactNode }, { message: string | null }> {
    state = { message: null as string | null }
    static getDerivedStateFromError(e: Error) {
      return { message: e.message }
    }
    render() {
      return this.state.message ?? this.props.children
    }
  }
  const Use = ({ hook }: { hook: () => unknown }) => {
    hook()
    return <p>fine</p>
  }

  /**
   * Renders `ui`, in which a hook throws `message` and Catch shows it. React reports an error that a
   * boundary caught on console.error: here that report is expected, so it is checked, not printed.
   */
  function renderCaught(ui: ReactNode, message: string): void {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(ui)
      expect(reported.mock.calls.flat().some((arg) => arg instanceof Error && arg.message === message)).toBe(true)
    } finally {
      reported.mockRestore()
    }
    expect(screen.getByText(message)).toBeTruthy()
  }

  it('useApp refuses to run outside the provider', () => {
    renderCaught(
      <Catch>
        <Use hook={useApp} />
      </Catch>,
      'useApp must be used inside AppProvider',
    )
  })

  it('useEditor refuses to run before a folder is open', () => {
    const platform: Platform = { kind: 'browser', openFolder: async () => null, createFolder: async () => null, restoreFolder: async () => null }
    renderCaught(
      <AppProvider platform={platform} updateSource={null}>
        <Catch>
          <Use hook={useEditor} />
        </Catch>
      </AppProvider>,
      'useEditor needs an open folder',
    )
  })
})
