import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MemoryFolder } from '../src/core/folder/memory'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

function repoParts(rel: string, who: string): string[] {
  const parts = rel.split(/[\\/]+/).filter((p) => p !== '' && p !== '.')
  if (parts.includes('..')) throw new Error(`${who}: "${rel}" leaves the repository.`)
  if (parts[0]?.toLowerCase() === 'local') {
    throw new Error(`${who}: "${rel}" is under local/, which tests must never read.`)
  }
  return parts
}

/**
 * Reads a text file of the repository (path relative to the repo root, with
 * forward slashes). Line endings come back as LF: the repository stores LF, but
 * a checkout with core.autocrlf turns them into CRLF on disk. Never reads
 * anything under `local/`, which holds the owner's personal files.
 */
export function readRepoText(rel: string): string {
  const parts = repoParts(rel, 'readRepoText')
  return readFileSync(repoRoot + parts.join('/'), 'utf8').replaceAll('\r\n', '\n')
}

function collectRepoFiles(parts: string[], into: Record<string, Uint8Array>): void {
  const abs = repoRoot + parts.join('/')
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs)) collectRepoFiles([...parts, name], into)
  } else {
    into[parts.join('/')] = new Uint8Array(readFileSync(abs))
  }
}

/**
 * Copies the listed repository files and folders (recursively, as raw bytes) into
 * a MemoryFolder. Bytes stay as they are on disk: readTextFile normalises line
 * endings. Throws for any path under `local/`.
 */
export function memoryFolderFromRepo(paths: string[]): MemoryFolder {
  const files: Record<string, Uint8Array> = {}
  for (const rel of paths) collectRepoFiles(repoParts(rel, 'memoryFolderFromRepo'), files)
  return new MemoryFolder('repo', files)
}
