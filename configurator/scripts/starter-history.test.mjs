// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { fingerprintsAtTags, mergeReleases, releaseVersions } from './starter-history.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const knownPath = resolve(repoRoot, 'configurator/src/core/update/knownReleases.json')
const known = JSON.parse(readFileSync(knownPath, 'utf8'))

const compareVersions = (a, b) => {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

describe('mergeReleases', () => {
  it('lists, per path and fingerprint, the releases that shipped it, oldest first', () => {
    const merged = mergeReleases([
      ['1.0.2', { 'a.txt': 'x1', 'b.txt': 'y1' }],
      ['1.0.3', { 'a.txt': 'x1', 'b.txt': 'y2' }],
      ['1.0.4', { 'a.txt': 'x2', 'b.txt': 'y2', 'c.txt': 'z1' }],
    ])
    expect(merged).toEqual({
      last: '1.0.4',
      files: {
        'a.txt': { x1: ['1.0.2', '1.0.3'], x2: ['1.0.4'] },
        'b.txt': { y1: ['1.0.2'], y2: ['1.0.3', '1.0.4'] },
        'c.txt': { z1: ['1.0.4'] },
      },
    })
  })

  it('sorts the paths so that a rebuild writes the same file', () => {
    const merged = mergeReleases([['1.0.2', { 'b.txt': 'y', 'a.txt': 'x' }]])
    expect(Object.keys(merged.files)).toEqual(['a.txt', 'b.txt'])
  })
})

describe('knownReleases.json', () => {
  const releases = [...new Set(Object.values(known.files).flatMap((byPrint) => Object.values(byPrint).flat()))]

  it('has a last release that is the newest it mentions', () => {
    expect(releases.sort(compareVersions).at(-1)).toBe(known.last)
  })

  it('lists the releases of each fingerprint oldest first, each once', () => {
    for (const byPrint of Object.values(known.files)) {
      for (const list of Object.values(byPrint)) {
        expect(list).toEqual([...new Set(list)].sort(compareVersions))
      }
    }
  })
})

// The expected side comes from git (the release tags' trees, read here), the actual side from the JSON.
// Without the tags (a build agent's shallow checkout, the image build) there is nothing to compare with.
const tagged = releaseVersions(repoRoot)
const wanted = [
  ...new Set([...tagged.filter((v) => compareVersions(v, known.last) <= 0), ...Object.values(known.files).flatMap((byPrint) => Object.values(byPrint).flat())]),
].sort(compareVersions)
const missing = wanted.filter((version) => !tagged.includes(version)).map((version) => `v${version}`)
const skipNote = missing.length > 0 ? ` (skipped: ${missing.join(', ')} not in this clone)` : ''

describe('the known releases against the release tags', () => {
  let fromGit = new Map()
  beforeAll(() => {
    if (missing.length === 0) fromGit = fingerprintsAtTags(repoRoot, wanted)
  })

  it.skipIf(missing.length > 0)(`holds every release the tags show, from v1.0.2 to v${known.last}${skipNote}`, () => {
    const mentioned = new Set(Object.values(known.files).flatMap((byPrint) => Object.values(byPrint).flat()))
    expect([...mentioned].sort(compareVersions)).toEqual(wanted)
  })

  it.skipIf(missing.length > 0)(`gives each release's files the fingerprints its tag has${skipNote}`, () => {
    for (const version of wanted) {
      const held = {}
      for (const [path, byPrint] of Object.entries(known.files)) {
        for (const [print, releases] of Object.entries(byPrint)) if (releases.includes(version)) held[path] = print
      }
      expect(held, `v${version}`).toEqual(fromGit.get(version))
    }
  })
})
