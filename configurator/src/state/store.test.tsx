/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Component, useLayoutEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
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
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
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
    session: { folder, configFile, saved: ws, ws, catalog: [], commandFiles: [], iconSets: [] },
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

  it('leaves the editor when told to show the open screen', () => {
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

  it('useApp refuses to run outside the provider', () => {
    render(
      <Catch>
        <Use hook={useApp} />
      </Catch>,
    )
    expect(screen.getByText('useApp must be used inside AppProvider')).toBeTruthy()
  })

  it('useEditor refuses to run before a folder is open', () => {
    const platform: Platform = { kind: 'browser', openFolder: async () => null, restoreFolder: async () => null }
    render(
      <AppProvider platform={platform}>
        <Catch>
          <Use hook={useEditor} />
        </Catch>
      </AppProvider>,
    )
    expect(screen.getByText('useEditor needs an open folder')).toBeTruthy()
  })
})
