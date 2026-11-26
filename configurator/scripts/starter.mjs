import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalBytes } from '../src/core/update/canonical.mjs'

// The "starter": the files of a fresh Open Macro Builder, carried inside the page so the
// configurator can set up an empty folder without a network or a checkout. This file turns them
// into the virtual module `virtual:omb-starter` (default export: [{ path, base64 }]). A second one,
// `virtual:omb-starter-index` (default export: { version, files: { path: fingerprint } }), says what
// those files are without carrying them, so the page can tell whether a folder's copy is the same.

const VIRTUAL_ID = 'virtual:omb-starter'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const INDEX_VIRTUAL_ID = 'virtual:omb-starter-index'
const INDEX_RESOLVED_ID = '\0' + INDEX_VIRTUAL_ID

const SOURCE_FOLDERS = new Set(['ahk', 'powershell', 'img'])
// Tests and personal files stay behind; so do image sources, editor or atomic-write leftovers and manifests.
const SKIPPED_FOLDERS = new Set(['tests', 'local'])
const SKIPPED_FILES = /\.(xcf|bak|omb-tmp)$/
// The manifest says what a setup wrote into one folder; no copy carries one, wherever it lies in the tree
// (the root is never walked, so there it is already left out).
const MANIFEST_FILE = 'omb-manifest.json'
const skipped = (name) => SKIPPED_FILES.test(name) || name.toLowerCase() === MANIFEST_FILE

/**
 * Whether a repo-relative path (forward slashes) is a file of the starter: `config.json`, or a file under
 * `ahk/`, `powershell/` or `img/` that is not inside a folder named `tests` or `local`, not a leftover
 * (`.xcf`, `.bak`, `.omb-tmp`) and not a manifest. The listing of a working tree and the reading of a
 * release tag both go by this one rule.
 */
export function isStarterFile(path) {
  if (path === 'config.json') return true
  const parts = path.split('/')
  const name = parts.pop()
  if (parts.length === 0 || !SOURCE_FOLDERS.has(parts[0])) return false
  return !parts.slice(1).some((folder) => SKIPPED_FOLDERS.has(folder)) && !skipped(name)
}

function collect(root, rel, into) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) collect(root, path, into)
    } else if (isStarterFile(path)) {
      into.push(path)
    }
  }
}

/** Repo-relative paths (forward slashes, sorted by code unit) of the files a fresh setup gets. */
export function listStarterFiles(repoRoot) {
  const files = ['config.json']
  for (const folder of SOURCE_FOLDERS) collect(repoRoot, folder, files)
  return files.sort((a, b) => Number(a > b) - Number(a < b))
}

/**
 * The version this build carries: the `APP_VERSION` it is given, else `<MAJOR.MINOR>.0-dev` from the
 * package's version. An empty `APP_VERSION` counts as none: the Dockerfile's `ENV APP_VERSION=$APP_VERSION`
 * makes it an empty string when the build argument is not passed.
 */
export function starterVersion(env, packageVersion) {
  const given = env.APP_VERSION?.trim()
  if (given) return given
  const line = /^(\d+)\.(\d+)\./.exec(packageVersion)
  return line ? `${line[1]}.${line[2]}.0-dev` : '0.0.0-dev'
}

/**
 * What the starter files are: `{ version, files }`, the files as { repo-relative path: fingerprint }.
 * The fingerprint is the page's (core/update/fingerprint.ts): SHA-256 as lower-case hex of the file's
 * canonical bytes, made here with node:crypto where the page uses Web Crypto.
 */
export function starterIndex(repoRoot, version) {
  const files = {}
  for (const path of listStarterFiles(repoRoot)) {
    const bytes = canonicalBytes(path, readFileSync(join(repoRoot, path)))
    files[path] = createHash('sha256').update(bytes).digest('hex')
  }
  return { version, files }
}

/**
 * A Vite plugin serving `virtual:omb-starter` (the starter files, each as { path, base64 }) and
 * `virtual:omb-starter-index` (their version and fingerprints). `options.env` (default process.env)
 * gives the version; `options.packageVersion` (default: configurator/package.json) its fallback.
 */
export function starterPlugin(repoRoot, options = {}) {
  const env = options.env ?? process.env
  const version = () => {
    const packageVersion =
      options.packageVersion ?? JSON.parse(readFileSync(join(repoRoot, 'configurator', 'package.json'), 'utf8')).version
    return starterVersion(env, packageVersion)
  }
  return {
    name: 'omb-starter',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      if (id === INDEX_VIRTUAL_ID) return INDEX_RESOLVED_ID
    },
    load(id) {
      if (id === INDEX_RESOLVED_ID) return `export default ${JSON.stringify(starterIndex(repoRoot, version()))}`
      if (id !== RESOLVED_ID) return
      const files = listStarterFiles(repoRoot).map((path) => ({
        path,
        base64: readFileSync(join(repoRoot, path)).toString('base64'),
      }))
      return `export default ${JSON.stringify(files)}`
    },
  }
}
