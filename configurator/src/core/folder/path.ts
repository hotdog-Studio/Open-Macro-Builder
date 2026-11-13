export class PathError extends Error {}

/**
 * Turns a path into the form every FolderAccess uses: relative to the opened
 * folder, forward slashes, no "." segments. Rejects empty, absolute and
 * drive-letter paths and any ".." segment. `list('')` (the folder root) is the
 * only caller that may pass '' and it must not call this function for it.
 */
export function normalizePath(path: string): string {
  const slashed = path.replaceAll('\\', '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new PathError(`Path must be relative to the opened folder: "${path}"`)
  }
  const segments = slashed.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.includes('..')) {
    throw new PathError(`Path must not contain "..": "${path}"`)
  }
  if (segments.length === 0) {
    throw new PathError('Path must not be empty')
  }
  return segments.join('/')
}

/** Orders text by its code units: the same order on every machine, which a locale's order is not. */
export function compareText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** compareText for things that have a name, such as the entries of a folder. */
export function byName(a: { name: string }, b: { name: string }): number {
  return compareText(a.name, b.name)
}
