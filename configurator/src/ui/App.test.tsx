/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { UNSUPPORTED } from '../platform/detect'
import { AppProvider } from '../state/store'
import { App } from './App'
import { Unsupported } from './OpenScreen'

afterEach(cleanup)

it('renders the app name', () => {
  const platform = { kind: 'browser' as const, openFolder: async () => null, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
      <App />
    </AppProvider>,
  )
  expect(screen.getByRole('heading', { name: 'Open Macro Builder' })).toBeTruthy()
})

it('explains a browser that cannot open folders', () => {
  render(<Unsupported message={UNSUPPORTED} />)
  expect(screen.getByRole('alert').textContent).toBe(UNSUPPORTED)
  expect(screen.queryByRole('button', { name: 'Open folder' })).toBeNull()
})
