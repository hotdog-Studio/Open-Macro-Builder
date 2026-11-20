import type { StarterFile } from '../core/starter'
import type { StarterIndex } from '../core/update/fingerprint'

/**
 * The files of a fresh Open Macro Builder (config.json, ahk/, powershell/, img/), as built into the
 * page. Imported on demand so they are a chunk of their own, fetched only when a setup needs them.
 */
export async function loadStarter(): Promise<StarterFile[]> {
  const { default: files } = await import('virtual:omb-starter')
  return files.map(({ path, base64 }) => ({
    path,
    data: Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0),
  }))
}

/** The version of the app's copy of the scripts and the fingerprint of each of its files, as built into the page. */
export async function loadStarterIndex(): Promise<StarterIndex> {
  const { default: index } = await import('virtual:omb-starter-index')
  return index
}
