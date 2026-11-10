import type { FolderAccess } from '../core/folder/types'
import type { LangId } from '../core/languages'

/** string = folder name (needsPermission) or a message for the user (lost). */
export type Restore =
  | { folder: FolderAccess }
  | { needsPermission: string }
  | { lost: string }
  | null

export interface Platform {
  kind: 'browser' | 'electron'
  /** Resolves to null when the user cancels. */
  openFolder(): Promise<FolderAccess | null>
  /** Resolves to null when nothing is remembered. */
  restoreFolder(): Promise<Restore>
  /** Browser: call from a click, after restoreFolder gave needsPermission. */
  grantPermission?(): Promise<FolderAccess | null>
  watch?(paths: string[], onChange: (path: string) => void): () => void
  findMacropad?(): Promise<LangId | null>
  reloadMacropad?(): Promise<LangId | null>
  installedLanguages?(): Promise<LangId[]>
}
