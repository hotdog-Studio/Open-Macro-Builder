import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { KeyId, Workspace } from '../core/config/model'
import { writeConfig } from '../core/config/write'
import type { TextFile } from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import type { CatalogEntry, CommandFile, LangId } from '../core/languages'
import type { Settings } from '../core/settings'
import type { Platform } from '../platform/types'
import { createActions, type AppActions } from './actions'
import { commandsReducer, initialCommands, type CommandAction, type CommandsView } from './commandsSlice'

export type Tab = 'shape' | 'layers' | 'macros' | 'commands'

export interface Banner {
  text: string
  kind: 'info' | 'error'
}

/** Everything read from an opened folder. */
export interface Session {
  folder: FolderAccess
  /** local/config.json or config.json, as read (its version guards the save). */
  configFile: TextFile
  /** The workspace as it is on disk. */
  saved: Workspace
  /** The workspace being edited. */
  ws: Workspace
  catalog: CatalogEntry[]
  commandFiles: CommandFile[]
  iconSets: string[]
}

/** The open screen: nothing loaded. */
export interface OpenState {
  screen: 'open'
  /** Why the last folder did not open (inspectFolder, ConfigError, EncodingError, lost, …). */
  message: string | null
  /** Name of a remembered folder that needs a click to get permission again. */
  reopen: string | null
}

/** local/config.json is missing: edit a copy or the shared example. */
export interface PickConfigState {
  screen: 'pick-config'
  folder: FolderAccess
}

/** Loaded, but no settings yet and the browser cannot tell which version is installed. */
export interface PickLanguageState {
  screen: 'pick-language'
  session: Session
}

/** The dialog of the save flow (SaveFlow.tsx) that is open, if any. */
export type SaveDialog =
  /** checkWorkspace found errors; nothing was written. */
  | { kind: 'blocked'; errors: string[] }
  /**
   * Saved. The warnings are about a language the user does not run; `macropad` is the
   * running macropad that Reload macropad would restart (Electron only), and `note` what
   * came of pressing it.
   */
  | { kind: 'saved'; warnings: string[]; macropad: LangId | null; note: string | null }
  /** config.json changed on disk since it was loaded; nothing was written. */
  | { kind: 'conflict' }
  /** Overwrite anyway was chosen and waits for its confirmation. */
  | { kind: 'confirm-overwrite' }

/** The config file on disk is not the version the app holds. */
export interface OutsideChange {
  /** The version seen on disk (null: the file is gone), so a dismissed banner returns only for a newer change. */
  version: string | null
  dismissed: boolean
}

/** The editor as the reducer keeps it: no derived fields. */
export interface EditCore extends Session {
  screen: 'edit'
  settings: Settings
  tab: Tab
  selectedKey: KeyId | null
  selectedLayer: string | null
  banner: Banner | null
  saveDialog: SaveDialog | null
  outsideChange: OutsideChange | null
  commands: CommandsView
}

/** The editor as components see it. */
export interface EditState extends EditCore {
  /** writeConfig(ws) !== writeConfig(saved), derived by AppProvider; never stored. */
  dirty: boolean
}

/** What the reducer keeps. */
export type StoredState = OpenState | PickConfigState | PickLanguageState | EditCore

/** What useApp() gives: the stored state plus derived fields. */
export type AppState = OpenState | PickConfigState | PickLanguageState | EditState

export type Action =
  | { type: 'show-open'; message: string | null; reopen?: string | null }
  | { type: 'pick-config'; folder: FolderAccess }
  | { type: 'pick-language'; session: Session }
  | { type: 'loaded'; session: Session; settings: Settings }
  /** Every tab dispatches the result of a pure op from core/config/ops. */
  | { type: 'edit'; ws: Workspace }
  /** Leaves out a field to keep its selection. */
  | { type: 'select'; key?: KeyId | null; layer?: string | null }
  | { type: 'tab'; tab: Tab }
  | { type: 'banner'; banner: Banner | null }
  | { type: 'settings'; settings: Settings }
  /** A save wrote `configFile`; `saved` is the workspace it holds. */
  | { type: 'saved'; configFile: TextFile; saved: Workspace }
  /**
   * Reload from disk: a fresh session, edits to config.json dropped; settings, tab and command
   * drafts stay. Its command files are already merged with the ones holding drafts (mergeAfterRead).
   */
  | { type: 'reloaded'; session: Session }
  | { type: 'save-dialog'; dialog: SaveDialog | null }
  /** A recheck of the config file: `changed` when the disk holds another version than the app. */
  | { type: 'disk'; changed: boolean; version: string | null }
  | { type: 'dismiss-disk' }
  | CommandAction

export const initialState: StoredState = { screen: 'open', message: null, reopen: null }

function loadedState(session: Session, settings: Settings): EditCore {
  const notices = session.ws.notices
  return {
    ...session,
    screen: 'edit',
    settings,
    tab: 'shape',
    selectedKey: null,
    selectedLayer: null,
    banner: notices.length > 0 ? { text: notices.join('\n'), kind: 'info' } : null,
    saveDialog: null,
    outsideChange: null,
    commands: initialCommands(settings),
  }
}

function diskReducer(state: EditCore, changed: boolean, version: string | null): EditCore {
  if (!changed) return state.outsideChange ? { ...state, outsideChange: null } : state
  // The same outside version again (another focus, another watch event): the banner stays as it is.
  if (state.outsideChange?.version === version) return state
  return { ...state, outsideChange: { version, dismissed: false } }
}

/** Actions that only make sense while editing. */
function editReducer(state: EditCore, action: Action): EditCore {
  switch (action.type) {
    case 'edit':
      return action.ws === state.ws ? state : { ...state, ws: action.ws }
    case 'select':
      return {
        ...state,
        selectedKey: action.key === undefined ? state.selectedKey : action.key,
        selectedLayer: action.layer === undefined ? state.selectedLayer : action.layer,
      }
    case 'tab':
      return { ...state, tab: action.tab }
    case 'banner':
      return { ...state, banner: action.banner }
    case 'settings':
      return { ...state, settings: action.settings }
    case 'saved':
      // The disk now holds what the app wrote, so an outside-change banner is out of date.
      return { ...state, configFile: action.configFile, saved: action.saved, outsideChange: null }
    case 'reloaded':
      // The session carries the command files as the actions merged them, so both hold the same list.
      return { ...loadedState(action.session, state.settings), tab: state.tab, commands: state.commands }
    case 'save-dialog':
      return { ...state, saveDialog: action.dialog }
    case 'disk':
      return diskReducer(state, action.changed, action.version)
    case 'dismiss-disk':
      return state.outsideChange ? { ...state, outsideChange: { ...state.outsideChange, dismissed: true } } : state
    case 'commands-show':
    case 'draft':
    case 'command-saved':
    case 'command-after-save':
    case 'command-file':
    case 'command-files':
    case 'command-dismiss':
    case 'command-dialog':
    case 'jump':
    case 'open-command':
      return commandsReducer(state, action)
    default:
      return state
  }
}

export function reducer(state: StoredState, action: Action): StoredState {
  switch (action.type) {
    case 'show-open':
      return { screen: 'open', message: action.message, reopen: action.reopen ?? null }
    case 'pick-config':
      return { screen: 'pick-config', folder: action.folder }
    case 'pick-language':
      return { screen: 'pick-language', session: action.session }
    case 'loaded':
      return loadedState(action.session, action.settings)
    default:
      return state.screen === 'edit' ? editReducer(state, action) : state
  }
}

interface AppContextValue {
  state: AppState
  dispatch: (a: Action) => void
  actions: AppActions
  /** Where the app runs: a browser tab or the desktop app. */
  platform: Platform['kind']
}

const AppContext = createContext<AppContextValue | null>(null)

/** The text each workspace would be saved as, so dirty compares what Save would write. */
function useConfigText(ws: Workspace | null): string | null {
  return useMemo(() => (ws ? writeConfig(ws) : null), [ws])
}

export function AppProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [stored, dispatch] = useReducer(reducer, initialState)
  const editing = stored.screen === 'edit' ? stored : null
  const wsText = useConfigText(editing?.ws ?? null)
  const savedText = useConfigText(editing?.saved ?? null)
  const state = useMemo<AppState>(
    () => (stored.screen === 'edit' ? { ...stored, dirty: wsText !== savedText } : stored),
    [stored, wsText, savedText],
  )
  const { actions, sync, dispose } = useMemo(() => createActions(platform, dispatch), [platform])
  // Actions run from clicks and after awaits; they read the last committed state.
  useEffect(() => sync(state), [sync, state])
  // Stops watching config.json when the app goes away.
  useEffect(() => dispose, [dispose])
  const value = useMemo(() => ({ state, dispatch, actions, platform: platform.kind }), [state, actions, platform.kind])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

/** For components that only render while a folder is open (the tabs). */
export function useEditor(): AppContextValue & { state: EditState } {
  const value = useApp()
  if (value.state.screen !== 'edit') throw new Error('useEditor needs an open folder')
  return value as AppContextValue & { state: EditState }
}
