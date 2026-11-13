import { useEffect, useState } from 'react'
import type { FolderAccess } from '../core/folder/types'
import { useApp } from '../state/store'

/** One file read from a folder, shared by every component that shows it. */
interface Entry {
  /** The object URL once the file has been read; null while loading, when the file is missing, and once released. */
  url: string | null
  users: number
  ready: Promise<void>
}

/** Per folder, so a different opened folder never gets another folder's picture. */
const cache = new WeakMap<FolderAccess, Map<string, Entry>>()

async function read(folder: FolderAccess, path: string): Promise<Uint8Array | null> {
  try {
    return await folder.readBytes(path)
  } catch {
    return null // a path the folder refuses, or a file that cannot be read
  }
}

function acquire(folder: FolderAccess, path: string): Entry {
  let entries = cache.get(folder)
  if (!entries) {
    entries = new Map()
    cache.set(folder, entries)
  }
  const found = entries.get(path)
  if (found) {
    found.users++
    return found
  }
  const entry: Entry = { url: null, users: 1, ready: Promise.resolve() }
  entry.ready = read(folder, path).then((bytes) => {
    // Everyone let go while the file was loading: make nothing that would never be revoked.
    if (bytes && entry.users > 0) {
      entry.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
    }
  })
  entries.set(path, entry)
  return entry
}

function release(folder: FolderAccess, path: string, entry: Entry): void {
  entry.users--
  if (entry.users > 0) return
  const entries = cache.get(folder)
  if (entries?.get(path) === entry) entries.delete(path)
  if (entry.url) {
    URL.revokeObjectURL(entry.url)
    entry.url = null
  }
}

/**
 * An object URL for a picture in the opened folder (a path relative to it, such as
 * `img/media/layer.png`), for use as an `<img src>`. It is null while the file is being read and
 * when it is missing. Components that show the same path share one URL; it is revoked when the last
 * of them goes away or the folder changes.
 */
export function useAsset(path: string | null): string | null {
  const { state } = useApp()
  const folder = state.screen === 'edit' ? state.folder : null
  // The entry, not its URL: release() clears entry.url when it revokes it, so a render that still
  // holds an entry from before the path went away sees null instead of a revoked URL.
  const [loaded, setLoaded] = useState<{ folder: FolderAccess; path: string; entry: Entry } | null>(null)

  useEffect(() => {
    if (!folder || path === null) return
    const entry = acquire(folder, path)
    let live = true
    void entry.ready.then(() => {
      if (live) setLoaded({ folder, path, entry })
    })
    return () => {
      live = false
      release(folder, path, entry)
    }
  }, [folder, path])

  return loaded?.folder === folder && loaded.path === path ? loaded.entry.url : null
}
