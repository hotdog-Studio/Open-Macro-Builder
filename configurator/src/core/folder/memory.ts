import { byName, normalizePath } from './path'
import type { DirEntry, FolderAccess } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The promise of what `run` gives; a throw becomes a rejection, as it does from a real folder. */
function later<T>(run: () => T): Promise<T> {
  return Promise.resolve().then(run)
}

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

  readBytes(path: string): Promise<Uint8Array | null> {
    return later(() => this.files.get(normalizePath(path))?.slice() ?? null)
  }

  writeBytes(path: string, data: Uint8Array): Promise<void> {
    return later(() => {
      this.files.set(normalizePath(path), data.slice())
    })
  }

  list(dir: string): Promise<DirEntry[]> {
    return later(() => this.entriesOf(dir))
  }

  private entriesOf(dir: string): DirEntry[] {
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
    return [...entries.values()].sort(byName)
  }

  remove(path: string): Promise<void> {
    return later(() => {
      this.files.delete(normalizePath(path))
    })
  }

  /** Test convenience: the file decoded as UTF-8, or null when missing. */
  text(path: string): string | null {
    const bytes = this.files.get(normalizePath(path))
    return bytes ? decoder.decode(bytes) : null
  }
}
