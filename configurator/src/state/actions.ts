import { ConfigError, parseConfig } from '../core/config/parse'
import { EncodingError, readTextFile } from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import { commandCatalog, scanCommands, type LangId } from '../core/languages'
import { copyExampleConfig, inspectFolder, listIconSets } from '../core/repo'
import { loadSettings, saveSettings, type Settings } from '../core/settings'
import type { Platform } from '../platform/types'
import type { Action, AppState, Session } from './store'

export interface AppActions {
  /** On start: reopens the remembered folder, or offers Reopen <name>, or says it is gone. */
  restore(): Promise<void>
  /** The Open folder button. */
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
}

const PERSONAL_CONFIG = 'local/config.json'
const EXAMPLE_CONFIG = 'config.json'

/** What the open screen shows for an error while opening a folder. */
export function openError(e: unknown): string {
  if (e instanceof ConfigError || e instanceof EncodingError) return e.message
  return `The folder could not be opened: ${e instanceof Error ? e.message : String(e)}`
}

/** Reads the config, the command files and the icon sets of an opened folder. */
async function readSession(folder: FolderAccess, configPath: string): Promise<Session> {
  const configFile = await readTextFile(folder, configPath)
  if (!configFile) throw new ConfigError(`${configPath} is missing.`)
  const ws = parseConfig(configFile.text, configPath)
  const commandFiles = await scanCommands(folder)
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
): { actions: AppActions; sync: (state: AppState) => void } {
  let current: AppState = { screen: 'open', message: null, reopen: null }
  const getState = () => current
  /** Each load gets a number; a load that a newer one overtook drops its result. */
  let loads = 0
  const showOpen = (message: string | null, reopen: string | null = null) =>
    dispatch({ type: 'show-open', message, reopen })

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
    if (settings) dispatch({ type: 'loaded', session, settings })
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
        showOpen(openError(e))
        return
      }
      if (folder) await load(folder)
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
        if (token === loads) dispatch({ type: 'loaded', session: state.session, settings })
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
  }

  return {
    actions,
    sync: (state) => {
      current = state
    },
  }
}
