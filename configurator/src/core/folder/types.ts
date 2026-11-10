export interface DirEntry {
  name: string
  kind: 'file' | 'dir'
}

export interface FolderAccess {
  /** Folder name shown in the header. */
  readonly name: string
  /** Resolves to null when the file is missing. */
  readBytes(path: string): Promise<Uint8Array | null>
  /** Creates parent folders and replaces the file atomically. */
  writeBytes(path: string, data: Uint8Array): Promise<void>
  /** Resolves to [] when the folder is missing. '' is the folder root. */
  list(dir: string): Promise<DirEntry[]>
  /** Resolves without error when the file is missing. */
  remove(path: string): Promise<void>
}
