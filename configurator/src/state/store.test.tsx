/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, expect, it } from 'vitest'
import { renameKey } from '../core/config/ops'
import { MemoryFolder } from '../core/folder/memory'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { readRepoText } from '../../test/repo'
import { App } from '../ui/App'
import { AppProvider, useApp } from './store'

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
