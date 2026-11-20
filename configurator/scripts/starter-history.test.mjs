// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildKnownReleases, compareVersions, fingerprintsAtTags, mergeReleases, releaseVersions, releasesToCompare } from './starter-history.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const knownPath = resolve(repoRoot, 'configurator/src/core/update/knownReleases.json')
const known = JSON.parse(readFileSync(knownPath, 'utf8'))

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

  it('keeps a content that returned together with its non-adjacent releases', () => {
    const merged = mergeReleases([
      ['1.0.2', { 'x.txt': 'a' }],
      ['1.0.3', { 'x.txt': 'b' }],
      ['1.0.4', { 'x.txt': 'b' }],
      ['1.0.5', { 'x.txt': 'a' }],
    ])
    expect(merged.files['x.txt']).toEqual({ a: ['1.0.2', '1.0.5'], b: ['1.0.3', '1.0.4'] })
  })

  it('refuses two paths that differ only by case, naming both', () => {
    expect(() => mergeReleases([['1.0.2', { 'ahk/Main.ahk': 'a' }], ['1.0.3', { 'ahk/main.ahk': 'a' }]])).toThrow(
      /ahk\/Main\.ahk and ahk\/main\.ahk/,
    )
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

/** { path: fingerprint } the table holds for one release. */
function heldFor(version) {
  const held = {}
  for (const [path, byPrint] of Object.entries(known.files)) {
    for (const [print, releases] of Object.entries(byPrint)) if (releases.includes(version)) held[path] = print
  }
  return held
}

describe('releasesToCompare', () => {
  const table = { last: '1.0.5', files: { 'a.txt': { x: ['1.0.2', '1.0.3'], y: ['1.0.4', '1.0.5'] } } }

  it('compares every release when every tag is there', () => {
    const plan = releasesToCompare(['1.0.2', '1.0.3', '1.0.4', '1.0.5'], table)
    expect(plan).toEqual({ wanted: ['1.0.2', '1.0.3', '1.0.4', '1.0.5'], present: ['1.0.2', '1.0.3', '1.0.4', '1.0.5'], absent: [] })
  })

  it('compares the tags that are there and names the ones that are not', () => {
    const plan = releasesToCompare(['1.0.2', '1.0.4'], table)
    expect(plan.present).toEqual(['1.0.2', '1.0.4'])
    expect(plan.absent).toEqual(['1.0.3', '1.0.5'])
  })

  it('leaves everything absent, and nothing present, in a clone without tags', () => {
    const plan = releasesToCompare([], table)
    expect(plan.present).toEqual([])
    expect(plan.absent).toEqual(['1.0.2', '1.0.3', '1.0.4', '1.0.5'])
  })

  it('adds a tag the table lacks, but not one newer than its last release', () => {
    expect(releasesToCompare(['1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6'], table).wanted).not.toContain('1.0.6')
    expect(releasesToCompare(['1.0.2', '1.0.3', '1.0.4', '1.0.5'], { ...table, files: { 'a.txt': { x: ['1.0.2', '1.0.4', '1.0.5'] } } }).wanted).toContain('1.0.3')
  })
})

// The expected side comes from git (the release tags' trees, read here), the actual side from the JSON.
// Each release is compared when its tag is in this clone and skipped, by name, when it is not (a build
// agent's checkout without the tags, the image build): a clone with some of the tags compares those.
let tagged = []
try {
  tagged = releaseVersions(repoRoot)
} catch {
  // No git, or no repository: nothing to compare with, and every release is skipped by name.
}
const { wanted, present, absent } = releasesToCompare(tagged, known)

describe('the known releases against the release tags', () => {
  let fromGit = new Map()
  beforeAll(() => {
    if (present.length > 0) fromGit = fingerprintsAtTags(repoRoot, present)
  })

  for (const version of wanted) {
    const there = present.includes(version)
    const note = there ? '' : ` (skipped: v${version} is not in this clone)`
    const title = `gives v${version} the fingerprints its tag has${note}`
    it.skipIf(!there)(title, () => {
      expect(heldFor(version)).toEqual(fromGit.get(version))
    })
  }

  const absentNames = absent.map((version) => `v${version}`).join(', ')
  const rebuildNote = absent.length > 0 ? ` (skipped: ${absentNames} not in this clone)` : ''
  const rebuildTitle = `rebuilds the committed table from the tags${rebuildNote}`
  it.skipIf(absent.length > 0)(rebuildTitle, () => {
    expect(buildKnownReleases(repoRoot, known.last)).toEqual(known)
  })

  it.skipIf(tagged.length === 0)('mentions every release tag from v1.0.2 to the last one', () => {
    const mentioned = new Set(Object.values(known.files).flatMap((byPrint) => Object.values(byPrint).flat()))
    expect(tagged.filter((v) => compareVersions(v, known.last) <= 0).filter((v) => !mentioned.has(v))).toEqual([])
  })
})
