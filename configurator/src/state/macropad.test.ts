import { describe, expect, it } from 'vitest'
import type { Platform } from '../platform/types'
import { createMacropadActions } from './macropad'

const platform = (more: Partial<Platform>): Platform => ({
  kind: 'electron',
  openFolder: async () => null,
  restoreFolder: async () => null,
  ...more,
})

describe('finding the running macropad', () => {
  it('finds none on a platform that cannot look', async () => {
    expect(await createMacropadActions(platform({})).find()).toBeNull()
  })

  it('reports the language of the running macropad', async () => {
    expect(await createMacropadActions(platform({ findMacropad: async () => 'ps' })).find()).toBe('ps')
  })

  it('finds none when the lookup fails, so the save is not spoiled', async () => {
    const actions = createMacropadActions(platform({ findMacropad: () => Promise.reject(new Error('no powershell')) }))
    expect(await actions.find()).toBeNull()
  })
})

describe('reloading the running macropad', () => {
  it('does nothing on a platform that cannot reload', async () => {
    expect(await createMacropadActions(platform({})).reload()).toBeNull()
  })

  it('says which macropad was reloaded', async () => {
    const actions = createMacropadActions(platform({ reloadMacropad: async () => 'ahk' }))
    expect(await actions.reload()).toMatch(/^Reloaded the .+ macropad\.$/)
  })

  it('says when no macropad was running', async () => {
    const actions = createMacropadActions(platform({ reloadMacropad: async () => null }))
    expect(await actions.reload()).toBe('No running macropad was found to reload.')
  })

  it('says why the reload failed', async () => {
    const actions = createMacropadActions(platform({ reloadMacropad: () => Promise.reject(new Error('spawn denied')) }))
    expect(await actions.reload()).toBe('The macropad was not reloaded: spawn denied')
  })

  it('says why when the failure is not an Error', async () => {
    const actions = createMacropadActions(platform({ reloadMacropad: () => Promise.reject('denied') }))
    expect(await actions.reload()).toBe('The macropad was not reloaded: denied')
  })

  it('ignores a second request while one reload runs, and allows another once it ended', async () => {
    let finish: (lang: 'ahk') => void = () => {}
    let calls = 0
    const actions = createMacropadActions(
      platform({
        reloadMacropad: () => {
          calls++
          return new Promise((resolve) => (finish = resolve))
        },
      }),
    )
    const first = actions.reload()
    expect(await actions.reload()).toBeNull()
    finish('ahk')
    expect(await first).toMatch(/^Reloaded/)
    const again = actions.reload()
    finish('ahk')
    expect(await again).toMatch(/^Reloaded/)
    expect(calls).toBe(2)
  })

  it('allows another reload after one failed', async () => {
    let fail = true
    const actions = createMacropadActions(
      platform({
        reloadMacropad: async () => {
          if (fail) throw new Error('first try')
          return 'ahk'
        },
      }),
    )
    expect(await actions.reload()).toBe('The macropad was not reloaded: first try')
    fail = false
    expect(await actions.reload()).toMatch(/^Reloaded/)
  })
})
