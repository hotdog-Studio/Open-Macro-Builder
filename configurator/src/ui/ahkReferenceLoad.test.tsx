/** @vitest-environment jsdom */
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairButton, startCommands } from '../../test/commandsTab'

// The AutoHotkey reference is a chunk of its own, fetched when the Commands tab shows: a tab left open
// across an update of the page asks for a chunk the server no longer has. Mocked here so that it fails.
const load = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../state/ahkReference', () => ({
  loadAhkReference: () => {
    load.calls++
    return Promise.reject(new Error('Failed to fetch dynamically imported module'))
  },
}))

afterEach(cleanup)

describe('an AutoHotkey reference that cannot be fetched', () => {
  it("leaves the tab working, with the folder's own functions and without AutoHotkey's", async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    await waitFor(() => expect(load.calls).toBeGreaterThan(0))
    const other = screen.getByRole('region', { name: 'Other commands available' })
    expect(within(other).getByRole('button', { name: /^ActivateOrOpen\b/ })).toBeTruthy()
    expect(within(other).queryByRole('heading', { name: "AutoHotkey's own functions" })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
