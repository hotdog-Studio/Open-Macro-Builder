import { hashBytes } from '../core/folder/hash'
import { ConflictError, writeTextFile, type TextFile } from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import {
  LANGUAGES,
  mergeRescan,
  readCommandFile,
  scanCommands,
  withCommandFile,
  type CommandFile,
} from '../core/languages'
import type { Platform } from '../platform/types'
import type { AppActions, SaveResult } from './actions'
import { draftDone } from './commandsSlice'
import type { Action, AppState } from './store'

export interface CommandDeps {
  platform: Platform
  dispatch: (a: Action) => void
  getState: () => AppState
  /** The open folder; null once closed or replaced. */
  folder(): FolderAccess | null
  /**
   * The command files as the app last read or wrote them: the closure copy, ahead of React's
   * commit. Every version a save checks comes from here, never from the state.
   */
  files: { get(): CommandFile[]; set(next: CommandFile[]): void }
}

export type CommandActions = Pick<
  AppActions,
  'editCommand' | 'saveCommandFile' | 'reloadCommandFile' | 'recheckCommands'
> & {
  /** Resolves once no command file is being saved, however the saves ended. */
  settled(): Promise<void>
  /** The paths with unsaved edits, as of the last edit (React may not have committed it yet). */
  draftPaths(): string[]
  /** Forgets every draft: the folder was closed, replaced or loaded again. */
  clearDrafts(): void
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Saving and reloading one command file at a time. */
export function createCommandActions(deps: CommandDeps): CommandActions {
  const { dispatch, files } = deps
  /** The save in progress for each path. */
  const saves = new Map<string, Promise<SaveResult>>()
  /**
   * The drafts by path, kept in step with the reducer's `commands.drafts` but ahead of React's
   * commit, so a save or a reload never misses an edit made just before it. `base` is the version
   * of the text the first edit was made on; a save checks the disk against it.
   */
  const drafts = new Map<string, { text: string; base: string | null }>()

  const entry = (path: string) => files.get().find((f) => f.file.path === path)
  const banner = (text: string) => dispatch({ type: 'banner', banner: { text, kind: 'error' } })

  async function settled(): Promise<void> {
    await Promise.all([...saves.values()].map((s) => s.catch(() => undefined)))
  }

  async function recheckCommands(): Promise<void> {
    // The app's own write is never an outside change: the recheck starts once it has landed.
    await settled()
    const folder = deps.folder()
    if (!folder) return
    const snapshot = files.get()
    let fresh: CommandFile[]
    try {
      fresh = await scanCommands(folder)
    } catch {
      // Unreadable for now (a locked file, a lost permission); a save or reload says why.
      return
    }
    // The folder was closed or replaced, or a save or reload holds a newer entry or is still
    // writing one: that one decides, and the next recheck sees the rest.
    if (deps.folder() !== folder || files.get() !== snapshot || saves.size > 0) return
    const { files: merged } = mergeRescan(snapshot, fresh, new Set(drafts.keys()))
    const held = new Map(snapshot.map((f) => [f.file.path, f]))
    // A file with unsaved edits differs from the disk when the disk is not the version its draft
    // was made on (usually the version held; an older one when the edit raced a quiet replace).
    const onDisk = new Map(fresh.map((f) => [f.file.path, f.file.version]))
    const changed: { path: string; version: string | null }[] = []
    for (const [path, draft] of drafts) {
      const version = onDisk.get(path) ?? null
      if (held.has(path) && version !== draft.base) changed.push({ path, version })
    }
    // A file whose bytes did not change keeps the entry the app holds, so nothing that holds
    // that entry (a reload reading it, a later recheck) sees it as replaced.
    const next = merged.map((f) => {
      const was = held.get(f.file.path)
      return was?.file.version === f.file.version ? was : f
    })
    const same = next.length === snapshot.length && next.every((f, i) => f === snapshot[i])
    const list = same ? snapshot : next
    if (!same) files.set(list)
    dispatch({ type: 'command-files', files: list, changed })
  }

  async function trySave(path: string, force: boolean): Promise<SaveResult> {
    const folder = deps.folder()
    const held = entry(path)
    if (!folder || !held?.editable) return 'blocked'
    const draft = drafts.get(path)
    if (!draft) return 'blocked'
    /** False once the folder was closed or replaced, or the file was reloaded, meanwhile. */
    const current = () => deps.folder() === folder && entry(path) === held
    let written: TextFile
    try {
      // The version the draft was made on, which is not the one held when the edit raced a
      // quiet replace: that edit must not land on the newer text unseen.
      let version = draft.base
      if (force) {
        // Overwrite anyway: the outside edit being replaced is kept beside the file, and only that
        // edit is replaced. A failed copy stops the save.
        const onDisk = await folder.readBytes(path)
        version = onDisk === null ? null : await hashBytes(onDisk)
        if (onDisk !== null) await folder.writeBytes(`${path}.bak`, onDisk)
      }
      // Refuses with ConflictError, writing nothing, when the disk is not that version: the
      // draft's, or after Overwrite anyway the one just copied to .bak.
      written = await writeTextFile(folder, { ...held.file, text: draft.text, version })
    } catch (e) {
      if (!current()) return 'blocked'
      if (e instanceof ConflictError) {
        dispatch({ type: 'command-dialog', dialog: { kind: 'conflict', path } })
        return 'conflict'
      }
      banner(`${path} was not saved: ${messageOf(e)}`)
      return 'blocked'
    }
    // The write happened, but the editor moved on to another folder or version of the file.
    if (!current()) return 'saved'
    const file: CommandFile = { ...held, file: written, functions: LANGUAGES[held.lang].findFunctions(written.text) }
    files.set(withCommandFile(files.get(), path, file))
    // The user may have typed during the write: only a draft equal to what was written is done.
    // Typing that goes on is now made on what was written.
    const after = drafts.get(path)
    if (after?.text === written.text) drafts.delete(path)
    else if (after) drafts.set(path, { text: after.text, base: written.version })
    dispatch({ type: 'command-saved', file })
    return 'saved'
  }

  return {
    editCommand(path, text, base) {
      const held = entry(path)
      // A file that is gone or not UTF-8 is never edited.
      if (!held?.editable) return
      // A draft keeps the version it was started on; later edits never move it.
      const start = drafts.get(path)?.base ?? base
      // The reducer applies the same rule (draftDone) with the same base, so both keep the same drafts.
      if (draftDone(held.file, text, start)) drafts.delete(path)
      else drafts.set(path, { text, base: start })
      dispatch({ type: 'draft', path, text, base: start })
    },

    saveCommandFile(path, { force = false } = {}) {
      // A second click while saving gets the same save.
      const running = saves.get(path)
      if (running) return running
      const save = trySave(path, force).finally(() => {
        if (saves.get(path) === save) saves.delete(path)
      })
      saves.set(path, save)
      return save
    },

    async reloadCommandFile(path) {
      await saves.get(path)?.catch(() => undefined)
      const folder = deps.folder()
      if (!folder) return
      const held = entry(path)
      let file: CommandFile | null
      try {
        file = await readCommandFile(folder, path)
      } catch (e) {
        if (deps.folder() === folder && entry(path) === held) banner(`${path} was not reloaded: ${messageOf(e)}`)
        return
      }
      // A save of the file since the read holds a newer version, and that one decides.
      if (deps.folder() !== folder || entry(path) !== held || saves.has(path)) return
      files.set(withCommandFile(files.get(), path, file))
      drafts.delete(path)
      dispatch({ type: 'command-file', path, file })
    },

    recheckCommands,

    settled,

    draftPaths: () => [...drafts.keys()],

    clearDrafts() {
      drafts.clear()
    },
  }
}
