import { describe, expect, it } from 'vitest'
import { ahkKeyName } from './keyNames'

describe('ahkKeyName', () => {
  it('maps the codes the pad is likely to send', () => {
    expect(ahkKeyName('F13')).toBe('F13')
    expect(ahkKeyName('F24')).toBe('F24')
    expect(ahkKeyName('KeyQ')).toBe('q')
    expect(ahkKeyName('Digit7')).toBe('7')
    expect(ahkKeyName('Numpad3')).toBe('Numpad3')
    expect(ahkKeyName('NumpadSubtract')).toBe('NumpadSub')
    expect(ahkKeyName('NumpadDecimal')).toBe('NumpadDot')
    expect(ahkKeyName('PageDown')).toBe('PgDn')
    expect(ahkKeyName('ArrowLeft')).toBe('Left')
    expect(ahkKeyName('ScrollLock')).toBe('ScrollLock')
    expect(ahkKeyName('MetaLeft')).toBe('LWin')
    expect(ahkKeyName('MediaTrackNext')).toBe('Media_Next')
    expect(ahkKeyName('AudioVolumeMute')).toBe('Volume_Mute')
  })

  it('returns null for a key it has no name for', () => {
    expect(ahkKeyName('IntlBackslash')).toBeNull()
    expect(ahkKeyName('F25')).toBeNull()
    expect(ahkKeyName('F0')).toBeNull()
    expect(ahkKeyName('')).toBeNull()
  })
})
