import { del, get, set } from 'idb-keyval'
import { normalizePath } from '../core/folder/path'
import type { DirEntry, FolderAccess } from '../core/folder/types'
import type { Platform, Restore } from './types'

function errorName(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : undefined
}

/** A missing entry, or a file where a folder was expected (or the reverse). */
function isMissing(e: unknown): boolean {
  const name = errorName(e)
  return name === 'NotFoundError' || name === 'TypeMismatchError'
}

/** FolderAccess over a File System Access directory handle. */
export class BrowserFolder implements FolderAccess {
  constructor(private readonly handle: FileSystemDirectoryHandle) {}

  get name(): string {
    return this.handle.name
  }

  /** The folder holding `segments`, or null when any step is missing. */
  private async walk(segments: string[]): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.handle
    for (const segment of segments) {
      try {
        dir = await dir.getDirectoryHandle(segment)
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    }
    return dir
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const segments = normalizePath(path).split('/')
    const fileName = segments.pop()!
    const dir = await this.walk(segments)
    if (!dir) return null
    try {
      const file = await (await dir.getFileHandle(fileName)).getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const segments = normalizePath(path).split('/')
    const fileName = segments.pop()!
    let dir = this.handle
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    const file = await dir.getFileHandle(fileName, { create: true })
    // The browser writes to a swap file and replaces the original on close(),
    // so a failed write leaves the old content in place.
    const writable = await file.createWritable()
    try {
      await writable.write(data as unknown as FileSystemWriteChunkType)
      await writable.close()
    } catch (e) {
      await writable.abort().catch(() => {})
      throw e
    }
  }

  async list(dir: string): Promise<DirEntry[]> {
    // '' is the folder root; every other path is normalised.
    const segments = dir === '' ? [] : normalizePath(dir).split('/')
    const handle = await this.walk(segments)
    if (!handle) return []
    const entries: DirEntry[] = []
    for await (const [name, child] of handle.entries()) {
      entries.push({ name, kind: child.kind === 'directory' ? 'dir' : 'file' })
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    const segments = normalizePath(path).split('/')
    const fileName = segments.pop()!
    const dir = await this.walk(segments)
    if (!dir) return
    try {
      await dir.removeEntry(fileName)
    } catch (e) {
      if (!isMissing(e)) throw e
    }
  }
}

export interface HandleStore {
  get(): Promise<FileSystemDirectoryHandle | undefined>
  set(h: FileSystemDirectoryHandle): Promise<void>
  clear(): Promise<void>
}

const KEY = 'omb-folder'

/** Remembers the folder handle in IndexedDB (handles are structured-cloneable). */
export const idbHandleStore: HandleStore = {
  get: () => get<FileSystemDirectoryHandle>(KEY),
  set: (h) => set(KEY, h),
  clear: () => del(KEY),
}

const lostMessage = (name: string) => `The folder ${name} is no longer available. Open it again.`

export function createBrowserPlatform(deps: {
  pick: () => Promise<FileSystemDirectoryHandle>
  store: HandleStore
}): Platform {
  const { pick, store } = deps
  /** The handle restoreFolder found, kept so grantPermission can run straight from a click. */
  let remembered: FileSystemDirectoryHandle | undefined

  async function lost(handle: FileSystemDirectoryHandle): Promise<Restore> {
    remembered = undefined
    await store.clear()
    return { lost: lostMessage(handle.name) }
  }

  /** The folder when it can be listed, else null (forgetting the handle). */
  async function openIfReadable(handle: FileSystemDirectoryHandle): Promise<FolderAccess | null> {
    const folder = new BrowserFolder(handle)
    try {
      await folder.list('')
    } catch {
      await lost(handle)
      return null
    }
    return folder
  }

  return {
    kind: 'browser',

    async openFolder() {
      let handle: FileSystemDirectoryHandle
      try {
        handle = await pick()
      } catch (e) {
        if (errorName(e) === 'AbortError') return null
        throw e
      }
      remembered = handle
      // Not being able to remember the folder must not stop it opening.
      await store.set(handle).catch(() => {})
      return new BrowserFolder(handle)
    },

    async restoreFolder() {
      const handle = await store.get()
      if (!handle) return null
      remembered = handle
      let state: PermissionState
      try {
        state = await handle.queryPermission({ mode: 'readwrite' })
      } catch (e) {
        if (isMissing(e)) return lost(handle)
        throw e
      }
      if (state !== 'granted') return { needsPermission: handle.name }
      const folder = await openIfReadable(handle)
      return folder ? { folder } : { lost: lostMessage(handle.name) }
    },

    async grantPermission() {
      const handle = remembered ?? (await store.get())
      if (!handle) return null
      try {
        const state = await handle.requestPermission({ mode: 'readwrite' })
        if (state !== 'granted') return null
      } catch (e) {
        if (isMissing(e)) {
          await lost(handle)
          return null
        }
        throw e
      }
      return openIfReadable(handle)
    },
  }
}
