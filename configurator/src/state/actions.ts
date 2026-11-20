import { ConfigError, parseConfig } from '../core/config/parse'
import { checkWorkspace, type CheckContext } from '../core/config/validate'
import { writeConfig } from '../core/config/write'
import { hashBytes } from '../core/folder/hash'
import {
  ConflictError,
  currentVersion,
  EncodingError,
  readTextFile,
  writeTextFile,
  type TextFile,
} from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import {
  commandCatalog,
  commandFileNotices,
  definedNames,
  LANG_IDS,
  scanCommands,
  scanLibrary,
  type CommandFile,
  type LangId,
  type LibraryFile,
} from '../core/languages'
import { copyExampleConfig, inspectFolder, listIconSets } from '../core/repo'
import { loadSettings, saveSettings, type Settings } from '../core/settings'
import { NOT_EMPTY, StarterError, writeStarter, type StarterFile } from '../core/starter'
import type { UpdatePicks } from '../core/update/apply'
import type { Platform } from '../platform/types'
import { createCommandActions } from './commandActions'
import { mergeAfterRead } from './commandsSlice'
import { createMacropadActions } from './macropad'
import { loadStarter, loadStarterIndex } from './starter'
import type { Action, AppState, EditState, SaveDialog, Session } from './store'
import { createUpdateActions, type UpdateSource } from './updateActions'

export type SaveResult = 'saved' | 'blocked' | 'conflict'

export interface AppActions {
  /** On start: reopens the remembered folder, or offers Reopen <name>, or says it is gone. */
  restore(): Promise<void>
  /**
   * The Open folder button, on the start screen and in the editor's header. A cancelled
   * picker changes nothing; the header asks before discarding edits.
   */
  openFolder(): Promise<void>
  /** The Reopen <name> button; must run straight from the click (browsers want a user gesture). */
  reopen(): Promise<void>
  /**
   * inspectFolder → readTextFile → parseConfig → scanCommands → listIconSets → loadSettings. An empty
   * folder offers to set up a fresh copy instead.
   */
  load(folder: FolderAccess): Promise<void>
  /** Answer to the empty-folder prompt: copies the starter into the folder, then opens it. */
  chooseSetup(): Promise<void>
  /**
   * The Create new folder dialog's answer; must run straight from the click (browsers want a user
   * gesture). An empty folder is set up without asking; an existing setup of that name opens.
   */
  createFolder(name: string): Promise<void>
  /** Answer to the missing local/config.json prompt. */
  chooseConfig(): Promise<void>
  /** Answer to Which version do you run? */
  chooseLanguage(lang: LangId): Promise<void>
  /** I run: ignored when it would leave no language; saved straight away. */
  setLanguages(languages: LangId[]): Promise<void>
  /** Back to the start screen without writing anything. */
  closeFolder(): void
  /**
   * Save config.json: checkWorkspace, then <configPath>.bak, then the file itself.
   * 'blocked' when errors (or a failed write) stopped it, 'conflict' when the file
   * changed on disk since it was loaded; a blocked or conflicting save writes
   * nothing. `force` is Overwrite anyway, chosen by the user after a conflict.
   */
  save(opts?: { force?: boolean }): Promise<SaveResult>
  /** Drops the edits and reads config.json, the commands and the icons again. */
  reloadFromDisk(): Promise<void>
  /** Shows the changed-on-disk banner when the file is not the version the app holds. */
  recheck(): Promise<void>
  /**
   * The versions of the macropad this PC can run, as the platform found them. null when the
   * platform cannot tell (the browser) or the check failed; never throws.
   */
  installedLanguages(): Promise<LangId[] | null>
  /** Electron: restarts the running macropad from the after-save dialog; the dialog then shows what happened. */
  reloadMacropad(): Promise<void>
  /**
   * Electron: Reload macropad in a command file's status line, after a save of `path`; the status
   * line then shows what happened, as long as it still shows that save.
   */
  reloadMacropadFor(path: string): Promise<void>
  /**
   * Every edit the user makes to a command file: records the draft here first, so saves and
   * reloads see it before React commits it, then dispatches 'draft'. Ignored for a file that is
   * gone or not editable. `base` is the version of the text the editor showed; a draft keeps the
   * base of its first edit, and its save checks the disk against that version. A draft started
   * on an older version than the one held marks the file changed on disk.
   */
  editCommand(path: string, text: string, base: string | null): void
  /**
   * Saves the draft of one command file, checked against the version the app holds. 'blocked'
   * without a draft, for a file that is not editable, or when the write failed; 'conflict' when
   * the file changed on disk. `force` is Overwrite anyway: the disk's bytes go to <path>.bak first.
   */
  saveCommandFile(path: string, opts?: { force?: boolean }): Promise<SaveResult>
  /** Reads one command file again, after a save of it finishes; its draft is dropped. */
  reloadCommandFile(path: string): Promise<void>
  /**
   * Scans the command files again, once no command file is being saved. Files without unsaved
   * edits take what is on disk (new files appear, deleted ones go); files with unsaved edits keep
   * them, and a changed-on-disk banner when the disk differs. Dropped when a save, a reload or a
   * folder change came first.
   */
  recheckCommands(): Promise<void>
  /**
   * New file: a starter file in each chosen language, then (AutoHotkey) the include line that
   * loads it; shows the new pair. Resolves to the first error message, or null when done.
   */
  createCommandFiles(req: { group: 'yours' | 'shared'; name: string; langs: LangId[] }): Promise<string | null>
  /** Create an empty file: the missing language of a pair, as New file makes it. */
  createMissingFile(pairKey: string, lang: LangId): Promise<string | null>
  /**
   * Delete this file: its include line first, then the file, so AutoHotkey never includes a
   * missing file; its unsaved edits go too. Refused when the file changed on disk.
   */
  deleteCommandFile(path: string): Promise<string | null>
  /** Review the update, on the update bar: opens the dialog of the update on offer. */
  reviewUpdate(): void
  /**
   * Not now, on the update bar and in its dialog, and Close once the dialog says what came of the update:
   * drops the offer until the folder is opened again. Nothing is stored about it. Ignored while the update runs.
   */
  dismissUpdate(): void
  /**
   * Update, in the update's dialog, and Try again: waits for the Commands tab's work in flight, makes the plan
   * again, carries out the picks that are still in it, and shows what came of it in the dialog. Refused while
   * a shared command file or the layout has unsaved changes. Nothing may open, close or reload a folder
   * meanwhile. Afterwards the command files are scanned again, and the layout read again when it was written.
   */
  applyUpdate(picks: UpdatePicks): Promise<void>
  /** Electron: Reload the macropad, once the update's dialog says what was done; the dialog then shows what happened. */
  reloadMacropadAfterUpdate(): Promise<void>
}

/** The config file as the app last read or wrote it, with its folder. */
interface Held {
  folder: FolderAccess
  configFile: TextFile
}

const PERSONAL_CONFIG = 'local/config.json'
const EXAMPLE_CONFIG = 'config.json'

/** What the start screen shows for an error while opening a folder. */
export function openError(e: unknown): string {
  if (e instanceof ConfigError || e instanceof EncodingError) return e.message
  return `The folder could not be opened: ${e instanceof Error ? e.message : String(e)}`
}

/** What checkWorkspace needs to know about the folder and the languages the user runs. */
function checkContext(state: EditState): CheckContext {
  const defined = {} as Record<LangId, Set<string>>
  for (const lang of LANG_IDS) defined[lang] = definedNames(state.commandFiles, lang)
  return { iconSets: new Set(state.iconSets), defined, languages: state.settings.languages }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** What the start screen shows when setting up a fresh copy failed. */
function setupError(e: unknown): string {
  // Refused before the first write: there is no partial copy to warn about.
  if (e instanceof StarterError && e.message === NOT_EMPTY) return e.message
  // The sentence goes on after the reason, so the reason's own full stop goes.
  const reason = messageOf(e).replace(/\.$/, '')
  return `Setting up stopped part-way: ${reason}. The folder may hold a partial copy: delete it, or pick another empty folder.`
}

/** What the start screen shows when the starter's own chunk could not be fetched (a page older than its server). */
function starterLoadError(e: unknown): string {
  return `Nothing was copied: the starter files could not be loaded (${messageOf(e)}). Reload and try again.`
}

/** True when both lists hold the same command file paths, in any order. */
function samePaths(a: CommandFile[], b: CommandFile[]): boolean {
  if (a.length !== b.length) return false
  const paths = new Set(a.map((f) => f.file.path))
  return b.every((f) => paths.has(f.file.path))
}

/**
 * Reads the config, the command files and the icon sets of an opened folder. `library` is the
 * library already held (none for a folder being opened): given back itself when the library cannot be read.
 */
async function readSession(folder: FolderAccess, configPath: string, library: LibraryFile[] = []): Promise<Session> {
  const configFile = await readTextFile(folder, configPath)
  if (!configFile) throw new ConfigError(`${configPath} is missing.`)
  const parsed = parseConfig(configFile.text, configPath)
  const commandFiles = await scanCommands(folder)
  // A command file that is not UTF-8 is listed but never edited; the load notices say so.
  const ws = { ...parsed, notices: [...parsed.notices, ...commandFileNotices(commandFiles)] }
  const iconSets = await listIconSets(folder)
  // A library file that cannot be read (locked, no permission) never stops the folder from
  // opening: the session keeps the library it held (none on opening), and the next recheck of the
  // command files reads it.
  const libraryFiles = await scanLibrary(folder, library).catch(() => library)
  return {
    folder,
    configFile,
    saved: ws,
    ws,
    catalog: commandCatalog(commandFiles),
    commandFiles,
    iconSets,
    libraryFiles,
  }
}

/**
 * The side effects of the app (folder IO), dispatching their results. `sync` is
 * called by AppProvider after every commit, so actions read the latest state.
 * `updateSource` is what the check after opening compares a folder with (AppProvider gives the app's
 * own copy); null checks no folder.
 */
export function createActions(
  platform: Platform,
  dispatch: (a: Action) => void,
  updateSource: UpdateSource | null,
): { actions: AppActions; sync: (state: AppState) => void; dispose: () => void } {
  let current: AppState = { screen: 'open', message: null, reopen: null }
  const getState = () => current
  /** Each load gets a number; a load that a newer one overtook drops its result. */
  let loads = 0

  /**
   * The config file as the app last read or wrote it. Kept here rather than read
   * from the state, so a recheck straight after a save (before React commits it)
   * compares with the saved version and never mistakes the app's own write for
   * an outside change. A new object for every load and save.
   */
  let held: Held | null = null
  /**
   * The command files as the app last read or wrote them, kept here for the same reason as
   * `held`: a save's version check must never use a version React has not committed yet.
   */
  let commandFiles: CommandFile[] = []
  /** Finds and reloads the running macropad, for config.json's save and the command files'. */
  const macropad = createMacropadActions(platform)
  /** Saves and reloads command files; keeps its own copy of the drafts, ahead of React's commit too. */
  const commands = createCommandActions({
    platform,
    macropad,
    dispatch,
    getState,
    folder: () => held?.folder ?? null,
    files: {
      get: () => commandFiles,
      set: (next) => {
        const before = commandFiles
        commandFiles = next
        if (!samePaths(before, next)) watchFiles()
      },
    },
  })
  /** The check after a folder opens, the answers to its bar, and the update its dialog carries out. */
  const update = createUpdateActions({
    source: updateSource,
    dispatch,
    getState,
    current: (token) => token === loads,
    folder: () => held?.folder ?? null,
    idle: commands.idle,
    draftPaths: commands.draftPaths,
    recheckCommands: () => actions.recheckCommands(),
    configPath: () => held?.configFile.path ?? null,
    // Unsaved edits are never dropped: then the changed-on-disk banner offers the reload.
    reloadConfig: () => {
      const state = getState()
      return state.screen === 'edit' && state.dirty ? actions.recheck() : actions.reloadFromDisk()
    },
    macropad,
  })
  /** Stops the platform's watch of the held config file and command files. */
  let stopWatch: (() => void) | null = null
  /** The save in progress; rechecks and reloads wait for it. */
  let saving: Promise<SaveResult> | null = null
  /** Resolves once the save in progress, if any, has finished, however it ended. */
  const saveDone = async () => {
    await saving?.catch(() => undefined)
  }

  /**
   * The folder the app has just filled with the starter, until the editor opens on it or any
   * other folder is opened or closed. Only that folder opens on Get started: one that already
   * held a setup opens on Pad shape.
   */
  let freshSetup: FolderAccess | null = null

  function forget(): void {
    freshSetup = null
    stopWatch?.()
    stopWatch = null
    held = null
    commandFiles = []
    commands.clearDrafts()
  }

  /**
   * Watches the held config file and every held command file, replacing the previous watch (one
   * watch list per window). An event for the config file rechecks it; any other rechecks the
   * command files.
   */
  function watchFiles(): void {
    stopWatch?.()
    stopWatch = null
    if (!held) return
    const configPath = held.configFile.path
    const paths = [configPath, ...commandFiles.map((f) => f.file.path)]
    stopWatch =
      platform.watch?.(paths, (path) => (path === configPath ? actions.recheck() : actions.recheckCommands())) ?? null
  }

  /**
   * Holds the config file and the command files, and watches them, replacing the previous
   * watch. The command drafts stay: a new folder or load calls forget() first.
   */
  function hold(folder: FolderAccess, configFile: TextFile, files: CommandFile[]): void {
    held = { folder, configFile }
    commandFiles = files
    watchFiles()
  }

  const showOpen = (message: string | null, reopen: string | null = null) => {
    forget()
    dispatch({ type: 'show-open', message, reopen })
  }

  /** The editor opens on a session loaded by load number `token`; then the folder's scripts are checked. */
  function opened(session: Session, settings: Settings, token: number): void {
    // Read before forget() clears it.
    const tab = session.folder === freshSetup ? 'start' : undefined
    dispatch({ type: 'loaded', session, settings, tab })
    forget()
    hold(session.folder, session.configFile, session.commandFiles)
    // In the background, once the tabs are shown: opening never waits for the check, and a check
    // that a newer load overtook drops its outcome.
    void update.check(session.folder, token)
  }

  /** Counts the dialogs the save flow shows, so a slow macropad lookup can tell it was overtaken. */
  let dialogs = 0
  const showDialog = (dialog: SaveDialog | null) => {
    dialogs++
    dispatch({ type: 'save-dialog', dialog })
  }

  /**
   * Electron only: after a save, looks for the running macropad and, when there is one, adds
   * Reload macropad to the after-save dialog. It runs in the background, so a slow lookup never
   * holds up the save, and gives up when another save or dialog came first.
   */
  async function offerReload(mine: Held, warnings: string[], shown: number): Promise<void> {
    const running = await macropad.find()
    if (running && held === mine && dialogs === shown) {
      showDialog({ kind: 'saved', warnings, macropad: running, note: null })
    }
  }

  async function trySave(force: boolean): Promise<SaveResult> {
    const state = getState()
    const file = held
    if (state.screen !== 'edit' || !file) return 'blocked'
    const { ws } = state
    const { errors, warnings } = checkWorkspace(ws, checkContext(state))
    if (errors.length > 0) {
      showDialog({ kind: 'blocked', errors })
      return 'blocked'
    }
    const { folder, configFile } = file
    let written: TextFile
    try {
      // The conflict check comes first: a refused save writes nothing, not even the .bak.
      const onDisk = await folder.readBytes(configFile.path)
      const version = onDisk === null ? null : await hashBytes(onDisk)
      if (!force && version !== configFile.version) throw new ConflictError(configFile.path)
      // The file being replaced; after Overwrite anyway, that is the outside edit.
      if (onDisk !== null) await folder.writeBytes(`${configFile.path}.bak`, onDisk)
      // Written over the version just copied to the .bak, never by force: writeTextFile refuses
      // with ConflictError when the file changed since the read above, so an edit that lands after
      // the copy is neither overwritten nor lost.
      written = await writeTextFile(folder, { ...configFile, text: writeConfig(ws), version })
    } catch (e) {
      // The folder was closed or reloaded meanwhile: nobody to tell.
      if (held !== file) return 'blocked'
      if (e instanceof ConflictError) {
        showDialog({ kind: 'conflict' })
        return 'conflict'
      }
      showDialog(null)
      dispatch({ type: 'banner', banner: { text: `${configFile.path} was not saved: ${messageOf(e)}`, kind: 'error' } })
      return 'blocked'
    }
    // The folder was closed meanwhile: the write happened, but there is no editor to update.
    if (held !== file) return 'saved'
    held = { folder, configFile: written }
    dispatch({ type: 'saved', configFile: written, saved: ws })
    showDialog(warnings.length > 0 ? { kind: 'saved', warnings, macropad: null, note: null } : null)
    void offerReload(held, warnings, dialogs)
    return 'saved'
  }

  /** The after-save dialog when it is open. */
  const openSavedDialog = () => {
    const state = getState()
    return state.screen === 'edit' && state.saveDialog?.kind === 'saved' ? state.saveDialog : null
  }

  async function reloadMacropad(): Promise<void> {
    const dialog = openSavedDialog()
    if (!dialog?.macropad) return
    const note = await macropad.reload()
    // Only if the dialog is still the one that offered the reload.
    if (note !== null && openSavedDialog() === dialog) showDialog({ ...dialog, macropad: null, note })
  }

  /** Settings to use without asking, or null when the user has to choose. */
  async function defaultSettings(): Promise<Settings | null> {
    if (!platform.installedLanguages) return null
    const installed = await platform.installedLanguages()
    return { languages: [installed[0] ?? 'ahk'] }
  }

  /** Reads the chosen config and everything else, then shows the tabs or the language prompt. */
  async function finishLoad(folder: FolderAccess, configPath: string, token: number): Promise<void> {
    await finishSession(await readSession(folder, configPath), token)
  }

  /** Settings last: loads or asks for them, then shows the tabs or the language prompt. */
  async function finishSession(session: Session, token: number): Promise<void> {
    const { folder } = session
    let settings = await loadSettings(folder)
    if (!settings) {
      settings = await defaultSettings()
      if (settings) await saveSettings(folder, settings)
    }
    if (token !== loads) return
    if (settings) opened(session, settings, token)
    else dispatch({ type: 'pick-language', session })
  }

  /** Runs one step of opening a folder; any failure goes back to the start screen with its message. */
  async function guarded(token: number, step: () => Promise<void>): Promise<void> {
    try {
      await step()
    } catch (e) {
      if (token === loads) showOpen(openError(e))
    }
  }

  /**
   * Opens a folder as inspectFolder finds it: a setup loads, an empty folder goes to `onEmpty`, and
   * anything else is refused with the reason.
   */
  async function openInspected(
    folder: FolderAccess,
    onEmpty: (folder: FolderAccess, token: number) => void | Promise<void>,
  ): Promise<void> {
    const token = ++loads
    await guarded(token, async () => {
      const info = await inspectFolder(folder)
      if (token !== loads) return
      if (!info.ok) return info.empty ? onEmpty(folder, token) : showOpen(info.reason)
      if (info.configPath === EXAMPLE_CONFIG) return dispatch({ type: 'pick-config', folder })
      await finishLoad(folder, info.configPath, token)
    })
  }

  /** An empty folder asks first: Set up a fresh copy here? */
  const load = (folder: FolderAccess) =>
    openInspected(folder, (empty) => dispatch({ type: 'setup', folder: empty, writing: false }))

  /**
   * True while setUp loads and writes the starter. In the desktop app a folder access carries no
   * identity: the main process answers for whichever folder it holds, and switches as soon as a
   * picker returns. So no picker opens until the copy is over, or the rest of it would land in the
   * folder just picked.
   */
  let copying = false

  /**
   * Copies the starter into an empty folder, then opens it like any other. A failure goes back to
   * the start screen; a newer load drops the outcome (the copy itself cannot be stopped).
   */
  async function setUp(folder: FolderAccess, token: number): Promise<void> {
    dispatch({ type: 'setup', folder, writing: true })
    copying = true
    let copied: boolean
    try {
      copied = await copyStarter(folder, token)
    } finally {
      copying = false
    }
    if (!copied || token !== loads) return
    freshSetup = folder
    await load(folder)
  }

  /** Loads the starter, then writes it; false when either failed, and the start screen says why. */
  async function copyStarter(folder: FolderAccess, token: number): Promise<boolean> {
    let files: StarterFile[]
    let version: string
    try {
      // Both before anything is written: a folder is not touched when either fails to load.
      const [loaded, index] = await Promise.all([loadStarter(), loadStarterIndex()])
      files = loaded
      version = index.version
    } catch (e) {
      // Nothing written yet, so no partial copy to warn about.
      if (token === loads) showOpen(starterLoadError(e))
      return false
    }
    try {
      await writeStarter(folder, files, version)
      return true
    } catch (e) {
      if (token === loads) showOpen(setupError(e))
      return false
    }
  }

  /**
   * True while a folder access may not change folders: the starter is being copied (see `copying`) or the
   * scripts are being updated, which writes through the open folder's access in the same way.
   */
  const writingThrough = () => copying || update.updating()

  /** The prompt state last answered, so a double click answers it once. */
  let answered: AppState | null = null
  const firstAnswer = (state: AppState) => {
    if (answered === state) return false
    answered = state
    return true
  }

  const actions: AppActions = {
    load,

    async restore() {
      const token = loads
      let result
      try {
        result = await platform.restoreFolder()
      } catch (e) {
        if (token === loads) showOpen(openError(e))
        return
      }
      if (token !== loads || !result) return
      if ('folder' in result) await load(result.folder)
      else if ('needsPermission' in result) showOpen(null, result.needsPermission)
      else showOpen(result.lost)
    },

    async openFolder() {
      // No picker while the starter is being copied or the scripts updated (see `writingThrough`).
      if (writingThrough()) return
      let folder: FolderAccess | null
      try {
        folder = await platform.openFolder()
      } catch (e) {
        // From the header: the open folder and its edits stay, with the reason in the banner.
        if (getState().screen === 'edit') {
          dispatch({ type: 'banner', banner: { text: openError(e), kind: 'error' } })
        } else showOpen(openError(e))
        return
      }
      // Cancelled: whatever is open stays as it is.
      if (!folder) return
      // The previous folder is let go first: in Electron its access now reads the new folder,
      // so it must not be saved or rechecked while the new one loads.
      forget()
      await load(folder)
    },

    async reopen() {
      if (!platform.grantPermission || writingThrough()) return
      const token = loads
      let result
      try {
        result = await platform.grantPermission()
      } catch (e) {
        if (token === loads) showOpen(openError(e))
        return
      }
      if (token !== loads || !result) return
      if ('folder' in result) await load(result.folder)
      else showOpen(result.lost)
    },

    async chooseSetup() {
      const state = getState()
      if (state.screen !== 'setup' || state.writing || !firstAnswer(state)) return
      await setUp(state.folder, ++loads)
    },

    async createFolder(name) {
      if (writingThrough()) return
      let folder: FolderAccess | null
      try {
        folder = await platform.createFolder(name)
      } catch (e) {
        showOpen(openError(e))
        return
      }
      // Cancelled: the start screen stays as it is.
      if (!folder) return
      forget()
      // The folder was named for this, so an empty one is set up without asking again.
      await openInspected(folder, setUp)
    },

    async chooseConfig() {
      const state = getState()
      if (state.screen !== 'pick-config' || !firstAnswer(state)) return
      const token = ++loads
      await guarded(token, async () => {
        // Every load check runs on the example first: a copy that cannot be
        // opened would hide config.json for good, since local/config.json wins.
        const session = await readSession(state.folder, EXAMPLE_CONFIG)
        if (token !== loads) return
        await copyExampleConfig(state.folder)
        const configFile = await readTextFile(state.folder, PERSONAL_CONFIG)
        if (!configFile) throw new ConfigError(`${PERSONAL_CONFIG} is missing.`)
        await finishSession({ ...session, configFile }, token)
      })
    },

    async chooseLanguage(lang) {
      const state = getState()
      if (state.screen !== 'pick-language' || !firstAnswer(state)) return
      const token = ++loads
      const settings: Settings = { languages: [lang] }
      await guarded(token, async () => {
        await saveSettings(state.session.folder, settings)
        if (token === loads) opened(state.session, settings, token)
      })
    },

    async setLanguages(languages) {
      const state = getState()
      if (state.screen !== 'edit' || languages.length === 0) return
      const settings: Settings = { languages }
      dispatch({ type: 'settings', settings })
      try {
        await saveSettings(state.folder, settings)
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        dispatch({ type: 'banner', banner: { text: `Your languages were not saved: ${why}`, kind: 'error' } })
      }
    },

    closeFolder() {
      if (update.updating()) return
      loads++
      showOpen(null)
    },

    save({ force = false } = {}) {
      // A second click while saving gets the same save.
      saving ??= trySave(force).finally(() => {
        saving = null
      })
      return saving
    },

    async reloadFromDisk() {
      await saveDone()
      await commands.settled()
      const file = held
      // Not while the scripts are being updated: the dialog reads the folder again once the update has ended.
      if (getState().screen !== 'edit' || !file || update.updating()) return
      const token = ++loads
      // Command files the app saves or reloads during the read keep the app's entry (mergeAfterRead).
      const before = commandFiles
      const state = getState()
      // Numbered with the rechecks' reads of the library, so the newest read of it wins whichever ends first.
      const libraryRead = commands.startLibraryRead()
      const heldLibrary = state.screen === 'edit' ? state.libraryFiles : []
      try {
        const read = await readSession(file.folder, file.configFile.path, heldLibrary)
        if (token !== loads || held !== file) return
        // Command files with unsaved edits keep the version they were edited on.
        const files = mergeAfterRead(before, commandFiles, read.commandFiles, commands.draftPaths())
        const now = getState()
        // A recheck that started after this read has put a newer library in the state already. A read
        // that failed gave back the library held at the start, which never goes over the state's.
        const failed = read.libraryFiles === heldLibrary
        const overtaken = (failed || !commands.takeLibraryRead(libraryRead)) && now.screen === 'edit'
        const libraryFiles = overtaken ? now.libraryFiles : read.libraryFiles
        const session = { ...read, libraryFiles, commandFiles: files, catalog: commandCatalog(files) }
        dispatch({ type: 'reloaded', session })
        hold(session.folder, session.configFile, files)
      } catch (e) {
        // The edits stay: a disk version that cannot be opened is no reason to lose them.
        if (token !== loads || held !== file) return
        showDialog(null)
        dispatch({ type: 'banner', banner: { text: openError(e), kind: 'error' } })
      }
    },

    reloadMacropad,
    reloadMacropadFor: commands.reloadMacropadFor,

    async installedLanguages() {
      if (!platform.installedLanguages) return null
      try {
        return await platform.installedLanguages()
      } catch {
        return null // Only the sentence about AutoHotkey is lost, so a failed check is not worth a message.
      }
    },

    editCommand: commands.editCommand,
    saveCommandFile: commands.saveCommandFile,
    reloadCommandFile: commands.reloadCommandFile,
    recheckCommands: commands.recheckCommands,
    createCommandFiles: commands.createCommandFiles,
    createMissingFile: commands.createMissingFile,
    deleteCommandFile: commands.deleteCommandFile,

    reviewUpdate: update.reviewUpdate,
    dismissUpdate: update.dismissUpdate,
    applyUpdate: update.applyUpdate,
    reloadMacropadAfterUpdate: update.reloadMacropadAfterUpdate,

    async recheck() {
      await saveDone()
      const file = held
      if (!file) return
      let version: string | null
      try {
        version = await currentVersion(file.folder, file.configFile.path)
      } catch {
        // Unreadable for now (a locked file, a lost permission); the next save says why.
        return
      }
      // A save or a load since the read holds a newer version, and that one decides.
      if (held !== file || saving !== null) return
      dispatch({ type: 'disk', changed: version !== file.configFile.version, version })
    },
  }

  return {
    actions,
    sync: (state) => {
      current = state
    },
    dispose: () => {
      // A load still running when the app goes away must not start a new watch.
      loads++
      forget()
    },
  }
}
