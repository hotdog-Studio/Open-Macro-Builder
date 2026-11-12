import { ConflictError, writeTextFile, type TextFile } from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import { LANGUAGES, readCommandFile, withCommandFile, type CommandFile } from '../core/languages'
import type { Platform } from '../platform/types'
import type { AppActions, SaveResult } from './actions'
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

export type CommandActions = Pick<AppActions, 'saveCommandFile' | 'reloadCommandFile'> & {
  /** Resolves once no command file is being saved, however the saves ended. */
  settled(): Promise<void>
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Saving and reloading one command file at a time. */
export function createCommandActions(deps: CommandDeps): CommandActions {
  const { dispatch, getState, files } = deps
  /** The save in progress for each path. */
  const saves = new Map<string, Promise<SaveResult>>()

  const entry = (path: string) => files.get().find((f) => f.file.path === path)
  const banner = (text: string) => dispatch({ type: 'banner', banner: { text, kind: 'error' } })

  async function trySave(path: string, force: boolean): Promise<SaveResult> {
    const state = getState()
    const folder = deps.folder()
    const held = entry(path)
    if (state.screen !== 'edit' || !folder || !held?.editable) return 'blocked'
    const draft = state.commands.drafts[path]
    if (draft === undefined) return 'blocked'
    /** False once the folder was closed or replaced, or the file was reloaded, meanwhile. */
    const current = () => deps.folder() === folder && entry(path) === held
    let written: TextFile
    try {
      if (force) {
        // Overwrite anyway: the outside edit being replaced is kept beside the file.
        const onDisk = await folder.readBytes(path)
        if (onDisk !== null) await folder.writeBytes(`${path}.bak`, onDisk)
      }
      // Refuses with ConflictError, writing nothing, when the disk is not the version held.
      written = await writeTextFile(folder, { ...held.file, text: draft }, { force })
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
    dispatch({ type: 'command-saved', file })
    return 'saved'
  }

  return {
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
      dispatch({ type: 'command-file', path, file })
    },

    async settled() {
      await Promise.all([...saves.values()].map((s) => s.catch(() => undefined)))
    },
  }
}
