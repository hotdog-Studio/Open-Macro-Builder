import { checkNewFile, newFilePath } from '../core/commands/files'
import { hashBytes } from '../core/folder/hash'
import {
  ConflictError,
  currentVersion,
  newTextFile,
  readTextFile,
  readTextFileLenient,
  writeTextFile,
  type TextFile,
} from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import {
  commandFileAt,
  commandFilePath,
  LANGUAGES,
  mergeRescan,
  readCommandFile,
  scanCommands,
  withCommandFile,
  type CommandFile,
  type LangId,
  type Language,
} from '../core/languages'
import type { Platform, SyntaxReport } from '../platform/types'
import type { AppActions, SaveResult } from './actions'
import { draftDone, type AfterSave } from './commandsSlice'
import type { MacropadActions } from './macropad'
import type { Action, AppState } from './store'

export interface CommandDeps {
  platform: Platform
  /** Finds and reloads the running macropad, as config.json's save does. */
  macropad: MacropadActions
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
  | 'editCommand'
  | 'saveCommandFile'
  | 'reloadCommandFile'
  | 'recheckCommands'
  | 'createCommandFiles'
  | 'createMissingFile'
  | 'deleteCommandFile'
  | 'reloadMacropadFor'
> & {
  /** Resolves once no command file is being saved, however the saves ended. */
  settled(): Promise<void>
  /** The paths with unsaved edits, as of the last edit (React may not have committed it yet). */
  draftPaths(): string[]
  /** Forgets every draft: the folder was closed, replaced or loaded again. */
  clearDrafts(): void
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Adds the line that loads `path` to its include file (made when missing). Include files are read
 * right before the edit and written with the version just read, so they never hold stale text.
 */
async function addInclude(folder: FolderAccess, lang: Language, listPath: string, path: string): Promise<void> {
  const include = await readTextFile(folder, listPath)
  const text = lang.addListing(include?.text ?? null, path)
  if (include === null) await writeTextFile(folder, newTextFile(listPath, text))
  else if (text !== include.text) await writeTextFile(folder, { ...include, text })
}

/** What removeInclude changed: the include file before and after; null when it changed nothing. */
interface Removed {
  before: TextFile
  after: TextFile
}

/** Removes the lines that load `path` from its include file, read and written as addInclude does. */
async function removeInclude(
  folder: FolderAccess,
  lang: Language,
  listPath: string,
  path: string,
): Promise<Removed | null> {
  const include = await readTextFile(folder, listPath)
  if (include === null) return null
  const text = lang.removeListing(include.text, path)
  if (text === include.text) return null
  return { before: include, after: await writeTextFile(folder, { ...include, text }) }
}

/**
 * Puts back what removeInclude removed. Read fresh and written with the version just read: when
 * nothing else touched the include file since, it gets its exact text back (the line where it was);
 * otherwise the line is added again as addInclude adds it.
 */
async function restoreInclude(
  folder: FolderAccess,
  lang: Language,
  listPath: string,
  path: string,
  removed: Removed,
): Promise<void> {
  const include = await readTextFile(folder, listPath)
  if (include !== null && include.version === removed.after.version) {
    await writeTextFile(folder, { ...include, text: removed.before.text })
  } else {
    await addInclude(folder, lang, listPath, path)
  }
}

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
  /**
   * After a save, by path: an edit that still carries the version from before the save (React has
   * not committed the save yet) is made on the text just written. Holds only while the written
   * entry is the one held; any other replacement of the entry ends it.
   */
  const written = new Map<string, { from: string | null; to: string | null; entry: CommandFile }>()

  /** Numbers the saves, so a background result of one save is never taken for another's. */
  let saveCount = 0

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

  /** The platform's syntax check of a saved file; null without one. A check that fails says why. */
  async function syntaxReport(lang: LangId, path: string): Promise<SyntaxReport | null> {
    const { platform } = deps
    if (!platform.checkSyntax) return null
    try {
      return await platform.checkSyntax(lang, path)
    } catch (e) {
      return { skipped: messageOf(e) }
    }
  }

  /**
   * The include file that should list `path` but does not, read fresh; null when it lists it, when
   * nothing needs to, or when it cannot be read (the save already went through; this is only a note).
   */
  async function unlistedIn(folder: FolderAccess | null, lang: LangId, path: string): Promise<string | null> {
    const language = LANGUAGES[lang]
    const listPath = language.listedIn(path)
    if (!folder || listPath === null) return null
    try {
      const include = await readTextFileLenient(folder, listPath)
      return include !== null && language.isListed(include.file.text, path) ? null : listPath
    } catch {
      return null
    }
  }

  /**
   * After save number `n` of `path`: its syntax check, whether its include file loads it, and the
   * macropad lookup, in the background, so none holds up or fails the save. The check and the
   * include file are reported together, so the check never says a file is fine before the note that
   * it is not loaded. The reducer drops a result once another save, an edit, a reload or a delete of
   * the file came first.
   */
  function checkSaved(path: string, lang: LangId, n: number): void {
    const report = (result: Partial<Omit<AfterSave, 'n'>>) => dispatch({ type: 'command-after-save', path, n, result })
    void Promise.all([syntaxReport(lang, path), unlistedIn(deps.folder(), lang, path)]).then(([check, unlisted]) => {
      if (check) report({ check, unlisted })
      else if (unlisted) report({ unlisted })
    })
    void deps.macropad.find().then((macropad) => {
      if (macropad) report({ macropad })
    })
  }

  /** The base of an edit that starts a draft: the written version when it was made on a save's text. */
  function afterSave(path: string, held: CommandFile, base: string | null): string | null {
    const save = written.get(path)
    if (!save) return base
    // The entry was replaced since the save (a reload, a recheck, config.json's reload): no longer.
    if (save.entry !== held) {
      written.delete(path)
      return base
    }
    return base === save.from ? save.to : base
  }

  async function trySave(path: string, force: boolean): Promise<SaveResult> {
    const folder = deps.folder()
    const held = entry(path)
    if (!folder || !held?.editable) return 'blocked'
    const draft = drafts.get(path)
    if (!draft) return 'blocked'
    /** False once the folder was closed or replaced, or the file was reloaded, meanwhile. */
    const current = () => deps.folder() === folder && entry(path) === held
    let saved: TextFile
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
      saved = await writeTextFile(folder, { ...held.file, text: draft.text, version })
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
    const file: CommandFile = { ...held, file: saved, functions: LANGUAGES[held.lang].findFunctions(saved.text) }
    files.set(withCommandFile(files.get(), path, file))
    // The editor reports the held version until React commits this save.
    written.set(path, { from: held.file.version, to: saved.version, entry: file })
    // The user may have typed during the write: only a draft equal to what was written is done.
    // Typing that goes on is now made on what was written.
    const after = drafts.get(path)
    if (after?.text === saved.text) drafts.delete(path)
    else if (after) drafts.set(path, { text: after.text, base: saved.version })
    const n = ++saveCount
    dispatch({ type: 'command-saved', file, n, check: deps.platform.checkSyntax ? 'running' : null })
    checkSaved(path, held.lang, n)
    return 'saved'
  }

  /**
   * Makes the command file at `path`: its starter text, then the include line that loads it. The
   * include line is worked out before anything is written, so a file it cannot be added to writes
   * nothing. Once written, the file joins the list even when its include line failed. Resolves to
   * null when done, else why not.
   */
  async function createFile(path: string): Promise<string | null> {
    const folder = deps.folder()
    const at = commandFileAt(path)
    if (!folder || !at) return null
    const lang = LANGUAGES[at.lang]
    const listPath = lang.listedIn(path)
    try {
      if (listPath) lang.addListing((await readTextFile(folder, listPath))?.text ?? null, path)
      if ((await folder.readBytes(path)) !== null) return `${path} already exists.`
    } catch (e) {
      return messageOf(e)
    }
    let made: TextFile
    try {
      // Version null: a file that appeared since the check is never replaced.
      made = await writeTextFile(folder, newTextFile(path, lang.starterFile(at.pair)))
    } catch (e) {
      return e instanceof ConflictError ? `${path} already exists.` : `${path} was not created: ${messageOf(e)}`
    }
    const error =
      listPath === null
        ? null
        : await addInclude(folder, lang, listPath, path).then(
            () => null,
            (e: unknown) => `${path} was created, but ${listPath} was not updated: ${messageOf(e)}`,
          )
    if (deps.folder() !== folder) return error
    const file: CommandFile = { ...at, file: made, functions: lang.findFunctions(made.text), editable: true }
    files.set(withCommandFile(files.get(), path, file))
    drafts.delete(path)
    written.delete(path)
    dispatch({ type: 'command-file', path, file })
    return error
  }

  return {
    editCommand(path, text, base) {
      const held = entry(path)
      // A file that is gone or not UTF-8 is never edited.
      if (!held?.editable) return
      // A draft keeps the version it was started on; later edits never move it.
      const start = drafts.get(path)?.base ?? afterSave(path, held, base)
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
      written.delete(path)
      dispatch({ type: 'command-file', path, file })
    },

    recheckCommands,

    async createCommandFiles({ group, name, langs }) {
      const why = checkNewFile(files.get(), name, group, langs)
      if (why) return why
      let error: string | null = null
      const made: LangId[] = []
      for (const lang of langs) {
        const path = newFilePath(lang, group, name)
        // One language at a time; a failed one does not stop the next.
        const failed = await createFile(path)
        error ??= failed
        if (entry(path)) made.push(lang)
      }
      if (made.length > 0) {
        const at = commandFileAt(newFilePath(made[0], group, name))!
        const state = deps.getState()
        const lang = state.screen === 'edit' && made.includes(state.commands.lang) ? state.commands.lang : made[0]
        dispatch({ type: 'commands-show', pair: `${at.group}:${at.pair}`, lang })
      }
      return error
    },

    async createMissingFile(pairKey, lang) {
      const colon = pairKey.indexOf(':')
      const group = pairKey.slice(0, colon)
      if (group !== 'yours' && group !== 'shared') return null
      const path = commandFilePath(lang, group, pairKey.slice(colon + 1))
      const error = await createFile(path)
      if (entry(path)) dispatch({ type: 'commands-show', pair: pairKey, lang })
      return error
    },

    async deleteCommandFile(path) {
      await saves.get(path)?.catch(() => undefined)
      const folder = deps.folder()
      const held = entry(path)
      if (!folder || !held) return null
      const lang = LANGUAGES[held.lang]
      const listPath = lang.listedIn(path)
      let removed: Removed | null = null
      try {
        if ((await currentVersion(folder, path)) !== held.file.version) return `${path} changed on disk; reload it first.`
        // The include line goes first: AutoHotkey does not start when it includes a missing file.
        if (listPath) removed = await removeInclude(folder, lang, listPath, path)
        await folder.remove(path)
      } catch (e) {
        const why = `${path} was not deleted: ${messageOf(e)}`
        // The file stays (it is still listed and held), so its include line goes back, or the user is told it is gone.
        if (!listPath || !removed) return why
        return restoreInclude(folder, lang, listPath, path, removed).then(
          () => why,
          () => `${path} was not deleted, and ${listPath} no longer includes it: ${messageOf(e)}`,
        )
      }
      if (deps.folder() !== folder) return null
      files.set(withCommandFile(files.get(), path, null))
      drafts.delete(path)
      written.delete(path)
      dispatch({ type: 'command-file', path, file: null })
      return null
    },

    async reloadMacropadFor(path) {
      const state = deps.getState()
      const last = state.screen === 'edit' ? state.commands.saved[path] : undefined
      if (!last?.macropad) return
      const note = await deps.macropad.reload()
      // Shown only while the status line still shows that save.
      if (note !== null) dispatch({ type: 'command-after-save', path, n: last.n, result: { macropad: null, note } })
    },

    settled,

    draftPaths: () => [...drafts.keys()],

    clearDrafts() {
      drafts.clear()
      written.clear()
    },
  }
}
