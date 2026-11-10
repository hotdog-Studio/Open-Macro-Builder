import { describe, expect, it } from 'vitest'
import { UNSUPPORTED, detectPlatform } from './detect'

describe('detectPlatform', () => {
  it('reports an unsupported browser with the exact message', () => {
    expect(detectPlatform({} as Window)).toEqual({ unsupported: UNSUPPORTED })
    expect(UNSUPPORTED).toBe('Open Macro Builder needs Chrome or Edge to open a folder on your PC.')
  })

  it('gives the browser platform when showDirectoryPicker exists', () => {
    const w = { showDirectoryPicker: async () => ({}) } as unknown as Window
    expect(detectPlatform(w)).toMatchObject({ kind: 'browser' })
  })

  it('opens the picker in readwrite mode', async () => {
    const calls: unknown[] = []
    const w = {
      showDirectoryPicker: async (opts: unknown) => {
        calls.push(opts)
        throw new DOMException('cancelled', 'AbortError')
      },
    } as unknown as Window
    const platform = detectPlatform(w)
    if ('unsupported' in platform) throw new Error('expected a platform')
    expect(await platform.openFolder()).toBeNull()
    expect(calls).toEqual([{ mode: 'readwrite' }])
  })
})
