import { describe, expect, it } from 'vitest'
import { KNOWN_RELEASES, everShipped, releasesOf, type KnownReleases } from './history'

const known: KnownReleases = {
  last: '1.0.5',
  files: {
    'ahk/Main.ahk': {
      aaa: ['1.0.2', '1.0.3'],
      bbb: ['1.0.4', '1.0.5'],
    },
    'img/blank.png': { ccc: ['1.0.2', '1.0.3', '1.0.4', '1.0.5'] },
  },
}

describe('releasesOf', () => {
  it('gives the releases that shipped a fingerprint, oldest first', () => {
    expect(releasesOf(known, 'ahk/Main.ahk', 'aaa')).toEqual(['1.0.2', '1.0.3'])
    expect(releasesOf(known, 'ahk/Main.ahk', 'bbb')).toEqual(['1.0.4', '1.0.5'])
  })

  it('gives none for a fingerprint no release shipped at that path', () => {
    expect(releasesOf(known, 'ahk/Main.ahk', 'zzz')).toEqual([])
    expect(releasesOf(known, 'img/blank.png', 'aaa')).toEqual([])
  })

  it('gives none for a path no release had', () => {
    expect(releasesOf(known, 'ahk/new.ahk', 'aaa')).toEqual([])
  })

  it('finds a path in another case', () => {
    expect(releasesOf(known, 'AHK/main.ahk', 'aaa')).toEqual(['1.0.2', '1.0.3'])
    expect(releasesOf(known, 'IMG/BLANK.PNG', 'ccc')).toHaveLength(4)
  })
})

describe('everShipped', () => {
  it('is true for a path a release had, in any case', () => {
    expect(everShipped(known, 'ahk/Main.ahk')).toBe(true)
    expect(everShipped(known, 'ahk/main.AHK')).toBe(true)
  })

  it('is false for a path no release had', () => {
    expect(everShipped(known, 'ahk/new.ahk')).toBe(false)
    expect(everShipped(known, 'local/configurator.json')).toBe(false)
  })
})

describe('KNOWN_RELEASES', () => {
  it('names a last release that its files mention', () => {
    const mentioned = new Set(Object.values(KNOWN_RELEASES.files).flatMap((byPrint) => Object.values(byPrint).flat()))
    expect(mentioned.has(KNOWN_RELEASES.last)).toBe(true)
  })

  it('holds the starter files of the old releases', () => {
    expect(everShipped(KNOWN_RELEASES, 'config.json')).toBe(true)
    expect(everShipped(KNOWN_RELEASES, 'ahk/main.ahk')).toBe(true)
    expect(everShipped(KNOWN_RELEASES, 'omb-manifest.json')).toBe(false)
  })
})
