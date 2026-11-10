import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

// The same words the browser platform uses for a remembered folder that is gone.
const lostMessage = (name: string) => `The folder ${name} is no longer available. Open it again.`

/** Remembers the folder the user opened, in `file` (omb-electron.json in userData). */
export function saveLastFolder(file: string, root: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ lastFolder: root }, null, 2)}\n`)
}

/**
 * The remembered folder; null when none is saved (or the file cannot be read);
 * lost when the folder is gone or can no longer be read.
 */
export function restoreLastFolder(file: string): string | { lost: string } | null {
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const root =
    typeof saved === 'object' && saved !== null ? (saved as { lastFolder?: unknown }).lastFolder : undefined
  if (typeof root !== 'string' || root === '') return null
  try {
    readdirSync(root)
    return root
  } catch {
    return { lost: lostMessage(basename(root)) }
  }
}

/** Forgets the remembered folder. */
export function forgetLastFolder(file: string): void {
  rmSync(file, { force: true })
}
