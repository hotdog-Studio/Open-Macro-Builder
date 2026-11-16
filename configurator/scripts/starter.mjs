import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The "starter": the files of a fresh Open Macro Builder, carried inside the page so the
// configurator can set up an empty folder without a network or a checkout. This file turns them
// into the virtual module `virtual:omb-starter` (default export: [{ path, base64 }]).

const VIRTUAL_ID = 'virtual:omb-starter'
const RESOLVED_ID = '\0' + VIRTUAL_ID

const SOURCE_FOLDERS = ['ahk', 'powershell', 'img']
// Tests and personal files stay behind; so do image sources and editor or atomic-write leftovers.
const SKIPPED_FOLDERS = new Set(['tests', 'local'])
const SKIPPED_FILES = /\.(xcf|bak|omb-tmp)$/

function collect(root, rel, into) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) collect(root, path, into)
    } else if (!SKIPPED_FILES.test(entry.name)) {
      into.push(path)
    }
  }
}

/** Repo-relative paths (forward slashes, sorted by code unit) of the files a fresh setup gets. */
export function listStarterFiles(repoRoot) {
  const files = ['config.json']
  for (const folder of SOURCE_FOLDERS) collect(repoRoot, folder, files)
  return files.sort()
}

/** A Vite plugin serving `virtual:omb-starter`: the starter files, each as { path, base64 }. */
export function starterPlugin(repoRoot) {
  return {
    name: 'omb-starter',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      const files = listStarterFiles(repoRoot).map((path) => ({
        path,
        base64: readFileSync(join(repoRoot, path)).toString('base64'),
      }))
      return `export default ${JSON.stringify(files)}`
    },
  }
}
