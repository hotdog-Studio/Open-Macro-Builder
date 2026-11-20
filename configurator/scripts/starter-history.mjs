import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { canonicalBytes } from '../src/core/update/canonical.mjs'
import { isStarterFile } from './starter.mjs'

// The known releases: what the starter of each release from 1.0.2 on carried, as fingerprints. Folders
// those releases set up hold no record of what was installed, so the configurator recognises an
// untouched file of one of them by its fingerprint (src/core/update/history.ts reads the table).
// `node scripts/starter-history.mjs` rebuilds knownReleases.json from the release tags (run
// `git fetch --tags origin` first); starter-history.test.mjs holds the file to the tags.
//
// The starter's rules have been the same since 1.0.2, so the current rules (isStarterFile) applied to
// a tag's tree give the files that release's starter carried.

const FIRST_RELEASE = '1.0.2'
const TAG = /^v(\d+\.\d+\.\d+)$/
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/core/update/knownReleases.json')

/** Negative when version `a` (three numbers, no `v`) is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

function git(repoRoot, args, input) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { input, maxBuffer: 1 << 30 })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.toString('utf8')}`)
  }
  return result.stdout
}

/** The versions (without the `v`) of the release tags from 1.0.2 on that this clone has, oldest first. */
export function releaseVersions(repoRoot) {
  const versions = git(repoRoot, ['tag', '--list', 'v*'])
    .toString('utf8')
    .split('\n')
    .map((tag) => TAG.exec(tag.trim())?.[1])
    .filter((version) => version && compareVersions(version, FIRST_RELEASE) >= 0)
  return versions.sort(compareVersions)
}

/**
 * What a comparison of the table with the tags covers: the releases to compare (every tag from 1.0.2 to
 * `known.last` that `tagged` shows, and every release the table mentions) split into those whose tag is
 * in this clone and those whose tag is not. A clone with some tags is compared as far as it goes.
 */
export function releasesToCompare(tagged, known) {
  const mentioned = Object.values(known.files).flatMap((byPrint) => Object.values(byPrint).flat())
  const wanted = [...new Set([...tagged.filter((version) => compareVersions(version, known.last) <= 0), ...mentioned])]
  wanted.sort(compareVersions)
  return {
    wanted,
    present: wanted.filter((version) => tagged.includes(version)),
    absent: wanted.filter((version) => !tagged.includes(version)),
  }
}

/** { path: blob id } of the starter files in a tag's tree. */
function starterBlobs(repoRoot, tag) {
  const blobs = {}
  for (const entry of git(repoRoot, ['ls-tree', '-r', '-z', '--full-tree', tag]).toString('utf8').split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const [mode, type, blob] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (type === 'blob' && mode !== '120000' && isStarterFile(path)) blobs[path] = blob
  }
  return blobs
}

/** The content of each blob id, as bytes, from one `git cat-file --batch` process. */
function readBlobs(repoRoot, ids) {
  const out = git(repoRoot, ['cat-file', '--batch'], `${ids.join('\n')}\n`)
  const contents = new Map()
  let offset = 0
  for (const id of ids) {
    const lineEnd = out.indexOf(0x0a, offset)
    const [, type, size] = out.subarray(offset, lineEnd).toString('utf8').split(' ')
    if (type !== 'blob') throw new Error(`git cat-file: ${id} is not a blob`)
    const start = lineEnd + 1
    contents.set(id, out.subarray(start, start + Number(size)))
    offset = start + Number(size) + 1
  }
  return contents
}

/**
 * The fingerprints of the starter files of each release: a Map of version to { path: fingerprint }.
 * The files are read as bytes (a picture is not text, and a text file's line ends are what the canonical
 * bytes normalise) and from one git process; a file that two releases share is hashed once.
 */
export function fingerprintsAtTags(repoRoot, versions) {
  const blobsOf = new Map(versions.map((version) => [version, starterBlobs(repoRoot, `v${version}`)]))
  const ids = [...new Set([...blobsOf.values()].flatMap((blobs) => Object.values(blobs)))]
  const contents = readBlobs(repoRoot, ids)
  // The fingerprint depends on the path too (config.ahk loses its include lines, pictures keep their CRLF).
  const hashed = new Map()
  const result = new Map()
  for (const [version, blobs] of blobsOf) {
    const files = {}
    for (const [path, blob] of Object.entries(blobs)) {
      const key = `${blob} ${path}`
      if (!hashed.has(key)) {
        hashed.set(key, createHash('sha256').update(canonicalBytes(path, contents.get(blob))).digest('hex'))
      }
      files[path] = hashed.get(key)
    }
    result.set(version, files)
  }
  return result
}

/**
 * The table from the releases' files, given as [version, { path: fingerprint }] oldest first:
 * { last, files: { path: { fingerprint: [versions that shipped it, oldest first] } } }, paths sorted.
 * Two paths that differ only in case are refused: the lookup compares paths ignoring case, and a path
 * with its history split between two spellings would be found with one half.
 */
export function mergeReleases(perRelease) {
  const files = {}
  const spelled = new Map()
  for (const [version, fingerprints] of perRelease) {
    for (const [path, print] of Object.entries(fingerprints)) {
      const other = spelled.get(path.toLowerCase())
      if (other !== undefined && other !== path) {
        throw new Error(`two paths differ only by case: ${other} and ${path} (v${version})`)
      }
      spelled.set(path.toLowerCase(), path)
      const byPrint = (files[path] ??= {})
      ;(byPrint[print] ??= []).push(version)
    }
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => Number(a > b) - Number(a < b)))
  return { last: perRelease.at(-1)[0], files: sorted }
}

/** The table for every release tag this clone has from 1.0.2 on, up to `upTo` (default: the newest) when given. */
export function buildKnownReleases(repoRoot, upTo) {
  const versions = releaseVersions(repoRoot).filter((version) => upTo === undefined || compareVersions(version, upTo) <= 0)
  if (versions.length === 0) throw new Error(`no release tag from v${FIRST_RELEASE} on: run git fetch --tags origin`)
  const fingerprints = fingerprintsAtTags(repoRoot, versions)
  return mergeReleases(versions.map((version) => [version, fingerprints.get(version)]))
}

// The command line: writes buildKnownReleases's result to knownReleases.json. Only that is not run by the
// tests, which call buildKnownReleases for real and compare its result with the committed file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const table = buildKnownReleases(repoRoot)
  writeFileSync(OUTPUT, `${JSON.stringify(table, null, 2)}
`)
  const prints = new Set(Object.values(table.files).flatMap((byPrint) => Object.keys(byPrint)))
  console.log(`last ${table.last}: ${Object.keys(table.files).length} paths, ${prints.size} distinct fingerprints -> ${OUTPUT}`)
}
