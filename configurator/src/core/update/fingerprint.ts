import { hashBytes } from '../folder/hash'
import { canonicalBytes } from './canonical.mjs'

export { canonicalBytes }

/** What the app's copy of the scripts says about itself: its version, and the fingerprint of each file it carries. */
export interface StarterIndex {
  version: string
  files: Record<string, string>
}

/**
 * A file's fingerprint: the SHA-256, as lower-case hex, of its canonical bytes. Two copies of a file
 * that differ only in their line ends, or (ahk/config.ahk) in the shared commands they list, have the same one.
 */
export function fingerprint(path: string, data: Uint8Array): Promise<string> {
  return hashBytes(canonicalBytes(path, data))
}
