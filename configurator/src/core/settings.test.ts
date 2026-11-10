import { describe, expect, it } from 'vitest'
import { MemoryFolder } from './folder/memory'
import { loadSettings, saveSettings, SETTINGS_PATH } from './settings'

describe('settings', () => {
  it('round-trips and writes 2-space JSON with a final newline', async () => {
    const folder = new MemoryFolder('r')
    await saveSettings(folder, { languages: ['ahk', 'ps'] })
    expect(folder.text(SETTINGS_PATH)).toBe('{\n  "languages": [\n    "ahk",\n    "ps"\n  ]\n}\n')
    expect(await loadSettings(folder)).toEqual({ languages: ['ahk', 'ps'] })
  })

  it('is null when the file is missing', async () => {
    expect(await loadSettings(new MemoryFolder('r'))).toBeNull()
  })

  it('is null for invalid JSON', async () => {
    expect(await loadSettings(new MemoryFolder('r', { [SETTINGS_PATH]: '{nope' }))).toBeNull()
  })

  it('keeps only known languages', async () => {
    const folder = new MemoryFolder('r', { [SETTINGS_PATH]: '{ "languages": ["ahk", "x"] }' })
    expect(await loadSettings(folder)).toEqual({ languages: ['ahk'] })
  })

  it('is null when no known language is left or the shape is wrong', async () => {
    for (const text of ['{ "languages": ["x"] }', '{ "languages": [] }', '{}', '[]', 'null', '{ "languages": "ahk" }']) {
      expect(await loadSettings(new MemoryFolder('r', { [SETTINGS_PATH]: text }))).toBeNull()
    }
  })

  it('drops repeated languages', async () => {
    const folder = new MemoryFolder('r', { [SETTINGS_PATH]: '{ "languages": ["ps", "ps", "ahk"] }' })
    expect(await loadSettings(folder)).toEqual({ languages: ['ps', 'ahk'] })
  })
})
