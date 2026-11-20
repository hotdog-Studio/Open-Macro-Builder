import type { FolderAccess } from '../core/folder/types'
import type { StarterIndex } from '../core/update/fingerprint'
import { KNOWN_RELEASES, type KnownReleases } from '../core/update/history'
import { planUpdate, type UpdatePlan } from '../core/update/plan'
import { compareVersions } from '../core/update/version'
import type { AppActions } from './actions'
import { loadStarterIndex } from './starter'
import type { Action, AppState } from './store'

/** What a check compares a folder with: the app's copy of the scripts, and what the releases before the record shipped. */
export interface UpdateSource {
  /** The version and fingerprints of the app's copy; fetched when a check needs them. */
  loadIndex(): Promise<StarterIndex>
  known: KnownReleases
}

/** The app's own copy of the scripts, as built into the page. */
export const APP_SCRIPTS: UpdateSource = { loadIndex: loadStarterIndex, known: KNOWN_RELEASES }

export interface UpdateDeps {
  /** What folders are checked against; null checks no folder. */
  source: UpdateSource | null
  dispatch: (a: Action) => void
  getState: () => AppState
  /** Whether load number `token` is still the newest: a check of an older load drops its outcome. */
  current(token: number): boolean
}

export type UpdateActions = Pick<AppActions, 'reviewUpdate' | 'dismissUpdate'> & {
  /**
   * Checks the folder load number `token` has just opened, and shows what it found: the update bar
   * when there is something new to offer, a passing message when the folder is newer than the app.
   * Never rejects: a check that fails shows nothing.
   */
  check(folder: FolderAccess, token: number): Promise<void>
}

/** The sentence of the update bar (and of the dialog behind it) for a plan. */
export function updateSentence(plan: Pick<UpdatePlan, 'from' | 'to'>): string {
  const { from, to } = plan
  if (from === null) return `The scripts in this folder are from an older version. This app has ${to}.`
  // "From version 1.0.6. This app has 1.0.6." would read as a fault: a file is missing or differs.
  if (compareVersions(from, to) === 0) return `Some of the scripts in this folder are missing or differ from this app's (${to}).`
  return `The scripts in this folder are from version ${from}. This app has ${to}.`
}

/** The check after a folder opens, and the answers to its bar. */
export function createUpdateActions(deps: UpdateDeps): UpdateActions {
  const { source, dispatch, getState } = deps

  /** The update the bar offers, while a folder is open. */
  const offered = () => {
    const state = getState()
    return state.screen === 'edit' ? state.update : null
  }

  return {
    async check(folder, token) {
      if (source === null) return
      let plan: UpdatePlan
      try {
        const index = await source.loadIndex()
        plan = await planUpdate(folder, index, source.known)
      } catch {
        // The folder opened all the same; the next opening checks again.
        return
      }
      if (!deps.current(token)) return
      if (plan.skip?.reason === 'newer') {
        const text = `This folder was last updated by version ${plan.skip.folderVersion}, which is newer than this app (${plan.to}).`
        dispatch({ type: 'banner', banner: { text, kind: 'info' } })
      } else if (plan.skip === null && plan.news) {
        dispatch({ type: 'update', update: { plan, dialog: false, busy: false, result: null } })
      }
    },

    reviewUpdate() {
      const update = offered()
      if (update) dispatch({ type: 'update', update: { ...update, dialog: true } })
    },

    dismissUpdate() {
      if (offered()) dispatch({ type: 'update', update: null })
    },
  }
}
