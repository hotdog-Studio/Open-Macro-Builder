import { compareText } from '../folder/path'
import type { FolderAccess } from '../folder/types'

/** The record of what a setup put into a folder, in the folder's root. */
export const MANIFEST_PATH = 'omb-manifest.json'

export interface Manifest {
  version: string
  /** Each shared path the app wrote, with the fingerprint of what it wrote. */
  files: Record<string, string>
  /** Command files the person deleted through the Commands tab. */
  deleted: string[]
  /** For a changed file the person kept at an update: the fingerprint of the app's copy they were shown. */
  offered: Record<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTextRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'string')

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')

/** The manifest the text holds, or null when it is not what writeManifest writes. */
function parseManifest(text: string): Manifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'string' || !isTextRecord(parsed.files)) return null
  // Absent keys default to empty; a key that is there must hold the right type (null does not).
  const deleted = 'deleted' in parsed ? parsed.deleted : []
  const offered = 'offered' in parsed ? parsed.offered : {}
  if (!isTextList(deleted) || !isTextRecord(offered)) return null
  return { version: parsed.version, files: parsed.files, deleted, offered }
}

/**
 * The folder's manifest, or null when there is none or what is there is not one (it was edited, cut
 * short or written by something else): a manifest that cannot be trusted counts as none. Only a
 * failure to read the folder itself rejects.
 */
export async function readManifest(folder: FolderAccess): Promise<Manifest | null> {
  const bytes = await folder.readBytes(MANIFEST_PATH)
  if (bytes === null) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return parseManifest(text)
}

// The paths are sorted by code unit (compareText), never by locale (localeCompare): the file must come out
// the same on every machine.
const sortedRecord = (record: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.keys(record)
      .sort(compareText)
      .map((path) => [path, record[path]]),
  )

/** Writes the manifest as JSON indented by two spaces with a final newline, the paths sorted by code unit. */
export async function writeManifest(folder: FolderAccess, manifest: Manifest): Promise<void> {
  const ordered: Manifest = {
    version: manifest.version,
    files: sortedRecord(manifest.files),
    deleted: [...manifest.deleted].sort(compareText),
    offered: sortedRecord(manifest.offered),
  }
  await folder.writeBytes(MANIFEST_PATH, new TextEncoder().encode(`${JSON.stringify(ordered, null, 2)}\n`))
}

const sameInCase = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The shared command folders, whose files a delete in the Commands tab is recorded for. */
const SHARED_COMMAND_DIRS = ['ahk/commands/', 'powershell/commands/']

/**
 * The manifest with `path` among its deleted files, as it was deleted. Null (nothing to change) when the
 * path is not in a shared command folder (through every folder below it) or `deleted` has it already, both
 * ignoring case. Whether `files` names the path does not matter: a first update of a folder from before the
 * manifest records no file the person had changed, and such a file deleted later must stay deleted. An entry
 * for a file of the person's own does nothing: the check counts only a path of the app's copy as deleted, and
 * the next update writes `deleted` anew.
 */
export function withDeleted(manifest: Manifest, path: string): Manifest | null {
  const key = path.toLowerCase()
  if (!SHARED_COMMAND_DIRS.some((dir) => key.startsWith(dir))) return null
  if (manifest.deleted.some((p) => sameInCase(p, path))) return null
  return { ...manifest, deleted: [...manifest.deleted, path] }
}

/** The manifest without `path` among its deleted files, ignoring case; null when it was not among them. */
export function withoutDeleted(manifest: Manifest, path: string): Manifest | null {
  const kept = manifest.deleted.filter((p) => !sameInCase(p, path))
  return kept.length === manifest.deleted.length ? null : { ...manifest, deleted: kept }
}
