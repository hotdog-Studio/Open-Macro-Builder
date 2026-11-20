import type { FolderAccess } from './folder/types'
import { fingerprint } from './update/fingerprint'
import { MANIFEST_PATH, writeManifest, type Manifest } from './update/manifest'

/** One file of the starter copy: a path relative to the folder root (forward slashes) and its bytes. */
export interface StarterFile {
  path: string
  data: Uint8Array
}

/** Setting up a fresh copy could not start or had to stop; the message says why, in plain words. */
export class StarterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StarterError'
  }
}

/** Why writeStarter refused before copying anything: the folder holds something now. */
export const NOT_EMPTY = 'This folder is no longer empty, so nothing was copied into it.'

/** Writes a file that must not be there yet: one that appeared since the folder was found empty is not replaced. */
async function writeNew(folder: FolderAccess, path: string, data: Uint8Array): Promise<void> {
  if ((await folder.readBytes(path)) !== null) throw new StarterError(`${path} already exists, so the copy stopped.`)
  await folder.writeBytes(path, data)
}

/**
 * Writes the starter copy into an empty folder, then the manifest saying what was written (and
 * `version`), then config.json last, so a folder holding config.json is a finished setup. Never
 * writes into a folder that holds anything, and never replaces a file that appeared meanwhile.
 */
export async function writeStarter(folder: FolderAccess, files: StarterFile[], version: string): Promise<void> {
  if ((await folder.list('')).length > 0) throw new StarterError(NOT_EMPTY)
  // What the manifest records is what is written below: the fingerprints come from these bytes.
  const hashes = await Promise.all(files.map(({ path, data }) => fingerprint(path, data)))
  const manifest: Manifest = {
    version,
    files: Object.fromEntries(files.map(({ path }, i) => [path, hashes[i]])),
    deleted: [],
    offered: {},
  }
  const [config, rest] = [files.filter((f) => f.path === 'config.json'), files.filter((f) => f.path !== 'config.json')]
  // One file at a time, in order: the copy stops at the first failure, and config.json has to be
  // the last one written (hence NOSONAR on the awaits in the loops).
  for (const { path, data } of rest) await writeNew(folder, path, data) // NOSONAR S9382
  if ((await folder.readBytes(MANIFEST_PATH)) !== null) throw new StarterError(`${MANIFEST_PATH} already exists, so the copy stopped.`)
  await writeManifest(folder, manifest)
  for (const { path, data } of config) await writeNew(folder, path, data) // NOSONAR S9382
}
