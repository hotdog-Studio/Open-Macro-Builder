import { describe, expect, it } from 'vitest'
import { electronEnv } from './run-electron.mjs'

describe('electronEnv', () => {
  it('electronEnv drops ELECTRON_RUN_AS_NODE and keeps everything else', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\bin', APPDATA: 'C:\\data' }
    expect(electronEnv(env)).toEqual({ PATH: 'C:\\bin', APPDATA: 'C:\\data' })
    // The caller's environment is left as it was.
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(electronEnv({ PATH: 'x' })).toEqual({ PATH: 'x' })
  })
})
