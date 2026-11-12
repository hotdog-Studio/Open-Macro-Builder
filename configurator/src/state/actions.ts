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
  LANGUAGES,
  scanCommands,
  type CommandFile,
  type LangId,
} from '../core/languages'
import { copyExampleConfig, inspectFolder, listIconSets } from '../core/repo'
import { loadSettings, saveSettings, type Settings } from '../core/settings'
import type { Platform } from '../platform/types'
import { createCommandActions } from './commandActions'
import { mergeReloaded } from './commandsSlice'
import type { Action, AppState, EditState, SaveDialog, Session } from './store'

export type SaveResult = 'saved' | 'blocked' | 'conflict'

export interface AppActions {
  /** On start: reopens the remembered folder, or offers Reopen <name>, or says it is gone. */
  restore(): Promise<void>
  /**
   * The Open folder button, on the open screen and in the editor's header. A cancelled
   * picker changes nothing; the header asks before discarding edits.
   */
  openFolder(): Promise<void>
  /** The Reopen <name> button; must run straight from the click (browsers want a user gesture). */
  reopen(): Promise<void>
  /** inspectFolder → readTextFile → parseConfig → scanCommands → listIconSets → loadSettings. */
  load(folder: FolderAccess): Promise<void>
  /** Answer to the missing local/config.json prompt. */
  chooseConfig(choice: 'copy' | 'example'): Promise<void>
  /** Answer to Which version do you run? */
  chooseLanguage(lang: LangId): Promise<void>
  /** I run: ignored when it would leave no language; saved straight away. */
  setLanguages(languages: LangId[]): Promise<void>
  /** Back to the open screen without writing anything. */
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
  /** Electron: restarts the running macropad from the after-save dialog; the dialog then shows what happened. */
  reloadMacropad(): Promise<void>
  /**
   * Saves the draft of one command file, checked against the version the app holds. 'blocked'
   * without a draft, for a file that is not editable, or when the write failed; 'conflict' when
   * the file changed on disk. `force` is Overwrite anyway: the disk's bytes go to <path>.bak first.
   */
  saveCommandFile(path: string, opts?: { force?: boolean }): Promise<SaveResult>
  /** Reads one command file again, after a save of it finishes; its draft is dropped. */
  reloadCommandFile(path: string): Promise<void>
}

/** The config file as the app last read or wrote it, with its folder. */
interface Held {
  folder: FolderAccess
  configFile: TextFile
}

const PERSONAL_CONFIG = 'local/config.json'
const EXAMPLE_CONFIG = 'config.json'

/** What the open screen shows for an error while opening a folder. */
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

/** Reads the config, the command files and the icon sets of an opened folder. */
async function readSession(folder: FolderAccess, configPath: string): Promise<Session> {
  const configFile = await readTextFile(folder, configPath)
  if (!configFile) throw new ConfigError(`${configPath} is missing.`)
  const parsed = parseConfig(configFile.text, configPath)
  const commandFiles = await scanCommands(folder)
  // A command file that is not UTF-8 is listed but never edited; the load notices say so.
  const ws = { ...parsed, notices: [...parsed.notices, ...commandFileNotices(commandFiles)] }
  const iconSets = await listIconSets(folder)
  return { folder, configFile, saved: ws, ws, catalog: commandCatalog(commandFiles), commandFiles, iconSets }
}

/**
 * The side effects of the app (folder IO), dispatching their results. `sync` is
 * called by AppProvider after every commit, so actions read the latest state.
 */
export function createActions(
  platform: Platform,
  dispatch: (a: Action) => void,
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
  /** Stops the platform's watch of the held config file. */
  let stopWatch: (() => void) | null = null
  /** The save in progress; rechecks and reloads wait for it. */
  let saving: Promise<SaveResult> | null = null
  /** Resolves once the save in progress, if any, has finished, however it ended. */
  const saveDone = async () => {
    await saving?.catch(() => undefined)
  }

  function forget(): void {
    stopWatch?.()
    stopWatch = null
    held = null
    commandFiles = []
  }

  /** Holds the config file and the command files, and watches the config file, replacing the previous watch. */
  function hold(folder: FolderAccess, configFile: TextFile, files: CommandFile[]): void {
    forget()
    held = { folder, configFile }
    commandFiles = files
    stopWatch = platform.watch?.([configFile.path], () => actions.recheck()) ?? null
  }

  const showOpen = (message: string | null, reopen: string | null = null) => {
    forget()
    dispatch({ type: 'show-open', message, reopen })
  }

  /** The editor opens on a loaded session. */
  function opened(session: Session, settings: Settings): void {
    dispatch({ type: 'loaded', session, settings })
    hold(session.folder, session.configFile, session.commandFiles)
  }

  const commands = createCommandActions({
    platform,
    dispatch,
    getState,
    folder: () => held?.folder ?? null,
    files: {
      get: () => commandFiles,
      set: (next) => {
        commandFiles = next
      },
    },
  })

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
    if (!platform.findMacropad) return
    let macropad: LangId | null
    try {
      macropad = await platform.findMacropad()
    } catch {
      return // Not finding it only means no Reload button; the save itself succeeded.
    }
    if (macropad && held === mine && dialogs === shown) showDialog({ kind: 'saved', warnings, macropad, note: null })
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
      // writeTextFile checks the version again, in case the file changed since the read above.
      written = await writeTextFile(folder, { ...configFile, text: writeConfig(ws) }, { force })
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

  let reloading = false

  /** The after-save dialog when it is open. */
  const openSavedDialog = () => {
    const state = getState()
    return state.screen === 'edit' && state.saveDialog?.kind === 'saved' ? state.saveDialog : null
  }

  async function reloadMacropad(): Promise<void> {
    const dialog = openSavedDialog()
    if (reloading || !dialog?.macropad || !platform.reloadMacropad) return
    reloading = true
    let note: string
    try {
      const lang = await platform.reloadMacropad()
      note = lang ? `Reloaded the ${LANGUAGES[lang].label} macropad.` : 'No running macropad was found to reload.'
    } catch (e) {
      note = `The macropad was not reloaded: ${messageOf(e)}`
    } finally {
      reloading = false
    }
    // Only if the dialog is still the one that offered the reload.
    if (openSavedDialog() === dialog) showDialog({ ...dialog, macropad: null, note })
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
    if (settings) opened(session, settings)
    else dispatch({ type: 'pick-language', session })
  }

  /** Runs one step of opening a folder; any failure goes back to the open screen with its message. */
  async function guarded(token: number, step: () => Promise<void>): Promise<void> {
    try {
      await step()
    } catch (e) {
      if (token === loads) showOpen(openError(e))
    }
  }

  async function load(folder: FolderAccess): Promise<void> {
    const token = ++loads
    await guarded(token, async () => {
      const info = await inspectFolder(folder)
      if (token !== loads) return
      if (!info.ok) return showOpen(info.reason)
      if (info.configPath === EXAMPLE_CONFIG) return dispatch({ type: 'pick-config', folder })
      await finishLoad(folder, info.configPath, token)
    })
  }

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
      if (!platform.grantPermission) return
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

    async chooseConfig(choice) {
      const state = getState()
      if (state.screen !== 'pick-config' || !firstAnswer(state)) return
      const token = ++loads
      await guarded(token, async () => {
        if (choice === 'example') return finishLoad(state.folder, EXAMPLE_CONFIG, token)
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
        if (token === loads) opened(state.session, settings)
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
      if (getState().screen !== 'edit' || !file) return
      const token = ++loads
      try {
        const session = await readSession(file.folder, file.configFile.path)
        if (token !== loads || held !== file) return
        // Command files with unsaved edits keep the version they were edited on, as the reducer does.
        const state = getState()
        const drafts = state.screen === 'edit' ? state.commands.drafts : {}
        const files = mergeReloaded(commandFiles, session.commandFiles, drafts)
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

    saveCommandFile: commands.saveCommandFile,
    reloadCommandFile: commands.reloadCommandFile,

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
