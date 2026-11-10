import { realpathSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { normalizePath } from '../src/core/folder/path'
import { resolveInside } from './nodeFolder'

/** File names compare without case where the file system ignores it. */
const fold = (name: string) =>
  process.platform === 'win32' || process.platform === 'darwin' ? name.toLowerCase() : name

/**
 * Calls `onChange(rel)` once a watched file has stayed quiet for `debounceMs`
 * after changing. Watches each file's folder rather than the file, so a file
 * replaced by an atomic save (write a temporary file, rename it over) is still
 * seen. Throws PathError for a path outside `root`; a file whose folder is
 * missing is not watched. Returns a function that stops watching.
 */
export function watchFiles(
  root: string,
  rels: string[],
  onChange: (rel: string) => void,
  debounceMs = 200,
): () => void {
  // Check every path before watching anything.
  const byFolder = new Map<string, Map<string, string>>()
  for (const rel of rels) {
    const abs = resolveInside(root, rel)
    const names = byFolder.get(dirname(abs)) ?? new Map<string, string>()
    names.set(fold(basename(abs)), normalizePath(rel))
    byFolder.set(dirname(abs), names)
  }

  let stopped = false
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const changed = (rel: string) => {
    clearTimeout(timers.get(rel))
    timers.set(
      rel,
      setTimeout(() => {
        timers.delete(rel)
        if (!stopped) onChange(rel)
      }, debounceMs),
    )
  }

  const watchers: FSWatcher[] = []
  for (const [folder, names] of byFolder) {
    let watcher: FSWatcher
    try {
      // The long, real name: libuv on Windows aborts the whole process when a
      // watched folder is named with 8.3 short names (C:\Users\EXAMPL~1\...).
      watcher = watch(realpathSync.native(folder), { persistent: false }, (_event, filename) => {
        if (stopped) return
        if (filename === null) {
          // Some systems do not say which file changed: report them all.
          names.forEach((rel) => changed(rel))
          return
        }
        const rel = names.get(fold(basename(String(filename))))
        if (rel) changed(rel)
      })
    } catch {
      continue // The folder does not exist (yet): nothing to watch there.
    }
    // A watched folder that is deleted or becomes unreadable ends its watch quietly.
    watcher.on('error', () => watcher.close())
    watchers.push(watcher)
  }

  return () => {
    stopped = true
    for (const watcher of watchers) watcher.close()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
}
