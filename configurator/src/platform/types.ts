import type { FolderAccess } from '../core/folder/types'
import type { LangId } from '../core/languages'

/** string = folder name (needsPermission) or a message for the user (lost). */
export type Restore =
  | { folder: FolderAccess }
  | { needsPermission: string }
  | { lost: string }
  | null

/** One problem a syntax check found; path is folder-relative with /, or as the checker printed it. */
export interface SyntaxProblem {
  path: string | null
  line: number | null
  message: string
}

/** What a syntax check found, or why it did not run. */
export type SyntaxReport = { ok: true } | { ok: false; problems: SyntaxProblem[] } | { skipped: string }

export interface Platform {
  kind: 'browser' | 'electron'
  /** Resolves to null when the user cancels. */
  openFolder(): Promise<FolderAccess | null>
  /** Resolves to null when nothing is remembered. */
  restoreFolder(): Promise<Restore>
  /**
   * Browser: call from a click, after restoreFolder gave needsPermission.
   * null only when the user declines; lost when permission was granted but the
   * folder can no longer be read.
   */
  grantPermission?(): Promise<{ folder: FolderAccess } | { lost: string } | null>
  watch?(paths: string[], onChange: (path: string) => void): () => void
  findMacropad?(): Promise<LangId | null>
  reloadMacropad?(): Promise<LangId | null>
  installedLanguages?(): Promise<LangId[]>
  /** Checks the syntax of a saved command file; `path` is relative to the opened folder. */
  checkSyntax?(lang: LangId, path: string): Promise<SyntaxReport>
}
