import { normalizePath } from '../core/folder/path'
import type { DirEntry, FolderAccess } from '../core/folder/types'
import type { LangId } from '../core/languages'
import type { Platform, SyntaxReport } from './types'

/**
 * What the Electron preload exposes as `window.omb`. Paths are relative to the
 * folder the main process holds; the page never names a folder on disk.
 */
export interface OmbBridge {
  /** The opened folder's name, or null when the user cancels. */
  openFolder(): Promise<string | null>
  /** The remembered folder's name, null when none is remembered, or lost with a message. */
  restoreFolder(): Promise<string | null | { lost: string }>
  readBytes(rel: string): Promise<Uint8Array | null>
  writeBytes(rel: string, data: Uint8Array): Promise<void>
  list(rel: string): Promise<DirEntry[]>
  remove(rel: string): Promise<void>
  /** Replaces the files being watched; [] stops watching. */
  watch(rels: string[]): Promise<void>
  /** Calls `cb` with the path of a watched file that changed; returns an unsubscribe function. */
  onChanged(cb: (rel: string) => void): () => void
  findMacropad(): Promise<LangId | null>
  reloadMacropad(): Promise<LangId | null>
  installedLanguages(): Promise<LangId[]>
  checkSyntax(lang: LangId, rel: string): Promise<SyntaxReport>
}

/**
 * FolderAccess over the bridge. Paths are normalised here too, so a bad path
 * fails with PathError before it reaches the main process (which checks again).
 */
class BridgeFolder implements FolderAccess {
  constructor(
    readonly name: string,
    private readonly bridge: OmbBridge,
  ) {}

  async readBytes(path: string): Promise<Uint8Array | null> {
    return this.bridge.readBytes(normalizePath(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    return this.bridge.writeBytes(normalizePath(path), data)
  }

  async list(dir: string): Promise<DirEntry[]> {
    // '' is the folder root; every other path is normalised.
    return this.bridge.list(dir === '' ? '' : normalizePath(dir))
  }

  async remove(path: string): Promise<void> {
    return this.bridge.remove(normalizePath(path))
  }
}

export function createElectronPlatform(bridge: OmbBridge): Platform {
  /** Counts watches so a late stop of an older watch leaves the newer one running. */
  let latestWatch = 0

  return {
    kind: 'electron',

    async openFolder() {
      const name = await bridge.openFolder()
      return name === null ? null : new BridgeFolder(name, bridge)
    },

    async restoreFolder() {
      const restored = await bridge.restoreFolder()
      if (restored === null) return null
      if (typeof restored === 'string') return { folder: new BridgeFolder(restored, bridge) }
      return { lost: restored.lost }
    },

    watch(paths, onChange) {
      const id = ++latestWatch
      const wanted = new Set(paths.map(normalizePath))
      const unsubscribe = bridge.onChanged((rel) => {
        if (wanted.has(rel)) onChange(rel)
      })
      // Watching is a convenience: the app also rechecks when its window regains focus.
      void bridge.watch([...wanted]).catch(() => {})
      return () => {
        unsubscribe()
        if (id === latestWatch) void bridge.watch([]).catch(() => {})
      }
    },

    findMacropad: () => bridge.findMacropad(),
    reloadMacropad: () => bridge.reloadMacropad(),
    installedLanguages: () => bridge.installedLanguages(),
    // Normalised here too, so a bad path fails before it reaches the main process.
    checkSyntax: async (lang, path) => bridge.checkSyntax(lang, normalizePath(path)),
  }
}
