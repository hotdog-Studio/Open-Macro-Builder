import { normalizePath } from './path'
import type { DirEntry, FolderAccess } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** In-memory FolderAccess for tests and demos. */
export class MemoryFolder implements FolderAccess {
  private readonly files = new Map<string, Uint8Array>()

  constructor(
    readonly name: string,
    files: Record<string, string | Uint8Array> = {},
  ) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(
        normalizePath(path),
        typeof content === 'string' ? encoder.encode(content) : content.slice(),
      )
    }
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    return this.files.get(normalizePath(path))?.slice() ?? null
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    this.files.set(normalizePath(path), data.slice())
  }

  async list(dir: string): Promise<DirEntry[]> {
    const prefix = dir === '' ? '' : `${normalizePath(dir)}/`
    const entries = new Map<string, DirEntry>()
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        entries.set(rest, { name: rest, kind: 'file' })
      } else {
        const name = rest.slice(0, slash)
        entries.set(name, { name, kind: 'dir' })
      }
    }
    return [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    this.files.delete(normalizePath(path))
  }

  /** Test convenience: the file decoded as UTF-8, or null when missing. */
  text(path: string): string | null {
    const bytes = this.files.get(normalizePath(path))
    return bytes ? decoder.decode(bytes) : null
  }
}
