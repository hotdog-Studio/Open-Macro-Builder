import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { KeyId, Workspace } from '../core/config/model'
import { writeConfig } from '../core/config/write'
import type { TextFile } from '../core/folder/textFile'
import type { FolderAccess } from '../core/folder/types'
import type { CatalogEntry, CommandFile } from '../core/languages'
import type { Settings } from '../core/settings'
import type { Platform } from '../platform/types'
import { createActions, type AppActions } from './actions'

export type Tab = 'shape' | 'layers' | 'macros'

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

export interface EditState extends Session {
  screen: 'edit'
  settings: Settings
  tab: Tab
  selectedKey: KeyId | null
  selectedLayer: string | null
  banner: Banner | null
  /** writeConfig(ws) !== writeConfig(saved); recomputed whenever ws or saved change. */
  dirty: boolean
}

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

export const initialState: AppState = { screen: 'open', message: null, reopen: null }

const isDirty = (ws: Workspace, saved: Workspace) => writeConfig(ws) !== writeConfig(saved)

function loadedState(session: Session, settings: Settings): EditState {
  const notices = session.ws.notices
  return {
    ...session,
    screen: 'edit',
    settings,
    tab: 'shape',
    selectedKey: null,
    selectedLayer: null,
    banner: notices.length > 0 ? { text: notices.join('\n'), kind: 'info' } : null,
    dirty: isDirty(session.ws, session.saved),
  }
}

/** Actions that only make sense while editing. */
function editReducer(state: EditState, action: Action): EditState {
  switch (action.type) {
    case 'edit':
      return action.ws === state.ws ? state : { ...state, ws: action.ws, dirty: isDirty(action.ws, state.saved) }
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
    default:
      return state
  }
}

export function reducer(state: AppState, action: Action): AppState {
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
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { actions, sync } = useMemo(() => createActions(platform, dispatch), [platform])
  // Actions run from clicks and after awaits; they read the last committed state.
  useEffect(() => sync(state), [sync, state])
  const value = useMemo(() => ({ state, dispatch, actions }), [state, actions])
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
