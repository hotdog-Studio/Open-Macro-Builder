import knownReleases from './knownReleases.json'

/**
 * What the releases before the record shipped (1.0.2 up to the last release whose folders have no
 * manifest), as fingerprints. Made by scripts/starter-history.mjs from the release tags.
 */
export interface KnownReleases {
  /** The last release whose folders have no manifest. */
  last: string
  /** path -> fingerprint -> the releases that shipped that content, oldest first. */
  files: Record<string, Record<string, string[]>>
}

export const KNOWN_RELEASES: KnownReleases = knownReleases

/** The fingerprints of a path, compared ignoring the case of the path. */
function entryOf(known: KnownReleases, path: string): Record<string, string[]> | undefined {
  if (Object.hasOwn(known.files, path)) return known.files[path]
  const lower = path.toLowerCase()
  const key = Object.keys(known.files).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : known.files[key]
}

/** The releases that shipped `fingerprint` at `path` (compared ignoring case); [] when none did. */
export function releasesOf(known: KnownReleases, path: string, fingerprint: string): readonly string[] {
  const byPrint = entryOf(known, path)
  return byPrint !== undefined && Object.hasOwn(byPrint, fingerprint) ? byPrint[fingerprint] : []
}

/** Whether any release ever had this path. */
export function everShipped(known: KnownReleases, path: string): boolean {
  return entryOf(known, path) !== undefined
}
