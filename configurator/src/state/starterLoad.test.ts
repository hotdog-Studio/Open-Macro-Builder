import { describe, expect, it, vi } from 'vitest'
import { MemoryFolder } from '../core/folder/memory'
import { createActions } from './actions'
import { initialState, reducer, type StoredState } from './store'

// The starter is a chunk of its own, fetched on demand: a tab left open across an update of the
// page asks for a chunk the server no longer has. Mocked here so that load can fail.
vi.mock('./starter', () => ({
  loadStarter: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
}))

describe('a starter that cannot be loaded', () => {
  it('says nothing was copied, and copies nothing', async () => {
    let state: StoredState = initialState
    const made = createActions(
      { kind: 'browser', openFolder: async () => null, createFolder: async () => null, restoreFolder: async () => null },
      (a) => {
        state = reducer(state, a)
        made.sync(state.screen === 'edit' ? { ...state, dirty: false } : state)
      },
    )
    const folder = new MemoryFolder('fresh')
    await made.actions.load(folder)
    expect(state.screen).toBe('setup')
    await made.actions.chooseSetup()
    expect(state).toEqual({
      screen: 'open',
      message:
        'Nothing was copied: the starter files could not be loaded (Failed to fetch dynamically imported module). Reload and try again.',
      reopen: null,
    })
    expect(await folder.list('')).toEqual([])
  })
})
