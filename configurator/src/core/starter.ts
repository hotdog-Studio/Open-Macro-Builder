import type { FolderAccess } from './folder/types'

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

/**
 * Writes the starter copy into an empty folder, config.json last so a folder holding it is a finished setup.
 * Never writes into a folder that holds anything, and never replaces a file that appeared meanwhile.
 */
export async function writeStarter(folder: FolderAccess, files: StarterFile[]): Promise<void> {
  if ((await folder.list('')).length > 0) {
    throw new StarterError('This folder is no longer empty, so nothing was copied into it.')
  }
  const ordered = [...files.filter((f) => f.path !== 'config.json'), ...files.filter((f) => f.path === 'config.json')]
  for (const { path, data } of ordered) {
    if ((await folder.readBytes(path)) !== null) throw new StarterError(`${path} already exists, so the copy stopped.`)
    await folder.writeBytes(path, data)
  }
}
