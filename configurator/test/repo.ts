import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Reads a text file of the repository (path relative to the repo root, with
 * forward slashes). Line endings come back as LF: the repository stores LF, but
 * a checkout with core.autocrlf turns them into CRLF on disk. Never reads
 * anything under `local/`, which holds the owner's personal files.
 */
export function readRepoText(rel: string): string {
  const parts = rel.split(/[\\/]+/).filter((p) => p !== '' && p !== '.')
  if (parts.includes('..')) throw new Error(`readRepoText: "${rel}" leaves the repository.`)
  if (parts[0]?.toLowerCase() === 'local') {
    throw new Error(`readRepoText: "${rel}" is under local/, which tests must never read.`)
  }
  return readFileSync(repoRoot + parts.join('/'), 'utf8').replaceAll('\r\n', '\n')
}
