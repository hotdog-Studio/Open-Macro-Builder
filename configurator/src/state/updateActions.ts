import type { FolderAccess } from '../core/folder/types'
import { commandFileAt } from '../core/languages'
import type { StarterFile } from '../core/starter'
import { applyUpdate, type UpdatePicks, type UpdateResult } from '../core/update/apply'
import type { StarterIndex } from '../core/update/fingerprint'
import { KNOWN_RELEASES, type KnownReleases } from '../core/update/history'
import { planUpdate, type UpdatePlan } from '../core/update/plan'
import { compareVersions } from '../core/update/version'
import type { AppActions } from './actions'
import type { MacropadActions } from './macropad'
import { loadStarter, loadStarterIndex } from './starter'
import type { Action, AppState, UpdateOffer } from './store'

/** What a check compares a folder with: the app's copy of the scripts, and what the releases before the record shipped. */
export interface UpdateSource {
  /** The version and fingerprints of the app's copy; fetched when a check needs them. */
  loadIndex(): Promise<StarterIndex>
  /** The files of the app's copy; fetched when an update writes them. */
  loadFiles(): Promise<StarterFile[]>
  known: KnownReleases
}

/** The app's own copy of the scripts, as built into the page. */
export const APP_SCRIPTS: UpdateSource = { loadIndex: loadStarterIndex, loadFiles: loadStarter, known: KNOWN_RELEASES }

export interface UpdateDeps {
  /** What folders are checked against; null checks no folder. */
  source: UpdateSource | null
  dispatch: (a: Action) => void
  getState: () => AppState
  /** Whether load number `token` is still the newest: a check of an older load drops its outcome. */
  current(token: number): boolean
  /** The open folder; null once it is closed. */
  folder(): FolderAccess | null
  /** Resolves once the Commands tab's work in flight has ended: saves, creates, deletes and their changes of the manifest. */
  idle(): Promise<void>
  /** The command files with unsaved edits, as of the last edit (React may not have committed it yet). */
  draftPaths(): string[]
  /** Scans the command files again, as after a change from outside. */
  recheckCommands(): Promise<void>
  /** The path of the layout file the app holds, or null. */
  configPath(): string | null
  /** Reads the layout file again, as after a change from outside. */
  reloadConfig(): Promise<void>
  /** Finds and reloads the running macropad, as a save does. */
  macropad: MacropadActions
}

export type UpdateActions = Pick<AppActions, 'reviewUpdate' | 'dismissUpdate' | 'applyUpdate' | 'reloadMacropadAfterUpdate'> & {
  /**
   * Checks the folder load number `token` has just opened, and shows what it found: the update bar
   * when there is something new to offer, a passing message when the folder is newer than the app.
   * Never rejects: a check that fails shows nothing.
   */
  check(folder: FolderAccess, token: number): Promise<void>
  /** True from the press of Update until its outcome shows: nothing may open, close or reload a folder meanwhile. */
  updating(): boolean
}

/** Why Update is off while the Commands tab has unsaved changes in a shared command file. */
export const SHARED_DRAFTS = 'Save or discard your changes in the Commands tab first.'
/** Why Update is off while the layout has unsaved changes. */
export const LAYOUT_DRAFT = 'Save or discard your changes to the layout first.'

/**
 * What keeps Update off: unsaved changes in a shared command file (`drafts` are the paths with unsaved
 * edits) or in the layout (`dirty`). Unsaved changes in the person's own files under local/ do not.
 */
export function updateBlockers(dirty: boolean, drafts: readonly string[]): string[] {
  const shared = drafts.some((path) => commandFileAt(path)?.group === 'shared')
  return [...(shared ? [SHARED_DRAFTS] : []), ...(dirty ? [LAYOUT_DRAFT] : [])]
}

/** The sentence of the update bar (and of the dialog behind it) for a plan. */
export function updateSentence(plan: Pick<UpdatePlan, 'from' | 'to'>): string {
  const { from, to } = plan
  if (from === null) return `The scripts in this folder are from an older version. This app has ${to}.`
  // "From version 1.0.6. This app has 1.0.6." would read as a fault: a file is missing or differs.
  if (compareVersions(from, to) === 0) return `Some of the scripts in this folder are missing or differ from this app's (${to}).`
  return `The scripts in this folder are from version ${from}. This app has ${to}.`
}

/** The sentence of a folder newer than the app. */
const newerSentence = (folderVersion: string, to: string) =>
  `This folder was last updated by version ${folderVersion}, which is newer than this app (${to}).`

/** The message of what a step threw or rejected with. */
function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return typeof cause === 'string' ? cause : 'An unknown error.'
}

/** An update that ended before anything was written, at `failedAt`, for `message`. */
const notStarted = (failedAt: string, message: string): UpdateResult => ({
  ok: false,
  failedAt,
  message,
  replaced: [],
  added: [],
  removed: [],
  kept: [],
  backups: [],
})

/** Whether an update wrote or removed anything. */
export const wroteSomething = (result: UpdateResult) =>
  [result.replaced, result.added, result.removed, result.backups].some((list) => list.length > 0)

/** What came of pressing Update: the plan it carried out (or the one it was offered) and the result. */
interface Outcome {
  plan: UpdatePlan
  result: UpdateResult
}

/** Why a plan made again at the press cannot be carried out, or null when it can. */
function skipReason(plan: UpdatePlan): string | null {
  if (plan.skip === null) return null
  if (plan.skip.reason === 'newer') return newerSentence(plan.skip.folderVersion, plan.to)
  return 'This folder has a .git entry now, and a folder kept with Git is not updated by this app.'
}

/** The check after a folder opens, the answers to its bar, and the update its dialog carries out. */
export function createUpdateActions(deps: UpdateDeps): UpdateActions {
  const { source, dispatch, getState } = deps
  /** See UpdateActions.updating. */
  let updating = false

  /** The update the bar offers, while a folder is open. */
  const offered = () => {
    const state = getState()
    return state.screen === 'edit' ? state.update : null
  }

  /**
   * Makes the plan again (the folder may have changed since the bar appeared) and loads the app's copy,
   * then carries out the picks that are still in the new plan. Null when `folder` is no longer the open one
   * once the plan is made: in the desktop app a folder access writes to whichever folder is open.
   */
  async function carryOut(src: UpdateSource, folder: FolderAccess, offer: UpdateOffer, picks: UpdatePicks): Promise<Outcome | null> {
    // A delete's change of the manifest and the update's own write of it never overlap.
    await deps.idle()
    let prepared: [UpdatePlan, StarterFile[]]
    try {
      const loading = src.loadFiles().catch((e: unknown) => {
        throw new Error(`The app's copy of the scripts could not be loaded (${messageOf(e).replace(/\.$/, '')}).`)
      })
      prepared = await Promise.all([src.loadIndex().then((index) => planUpdate(folder, index, src.known)), loading])
    } catch (e) {
      return deps.folder() === folder ? { plan: offer.plan, result: notStarted(folder.name, messageOf(e)) } : null
    }
    if (deps.folder() !== folder) return null
    const [plan, files] = prepared
    const skipped = skipReason(plan)
    if (skipped !== null) return { plan, result: notStarted(folder.name, skipped) }
    return { plan, result: await applyUpdate(folder, plan, picks, files) }
  }

  /** After an update that wrote something: the command lists scanned again, and the layout read again when it was written. */
  async function afterwards(result: UpdateResult): Promise<void> {
    await deps.recheckCommands()
    const config = deps.configPath()?.toLowerCase()
    if ([...result.replaced, ...result.added].some((path) => path.toLowerCase() === config)) await deps.reloadConfig()
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
        // The reducer joins it to a load notice showing: this may land before React has committed the load.
        dispatch({ type: 'notice', text: newerSentence(plan.skip.folderVersion, plan.to) })
      } else if (plan.skip === null && plan.news) {
        dispatch({ type: 'update', update: { plan, dialog: false, busy: false, result: null, macropad: null, note: null } })
      }
    },

    reviewUpdate() {
      const update = offered()
      if (update) dispatch({ type: 'update', update: { ...update, dialog: true } })
    },

    dismissUpdate() {
      const update = offered()
      if (update && !update.busy) dispatch({ type: 'update', update: null })
    },

    async applyUpdate(picks) {
      const offer = offered()
      const folder = deps.folder()
      const state = getState()
      if (source === null || folder === null || updating || !offer?.dialog || offer.busy) return
      if (updateBlockers(state.screen === 'edit' && state.dirty, deps.draftPaths()).length > 0) return
      updating = true
      dispatch({ type: 'update', update: { ...offer, busy: true, result: null, macropad: null, note: null } })
      let outcome: Outcome | null
      try {
        outcome = await carryOut(source, folder, offer, picks)
      } finally {
        updating = false
      }
      if (outcome === null) return
      const { plan, result } = outcome
      // In the desktop app, Reload the macropad when one is running.
      const macropad = result.ok ? await deps.macropad.find() : null
      dispatch({ type: 'update', update: { plan, dialog: true, busy: false, result, macropad, note: null } })
      if (result.ok || wroteSomething(result)) await afterwards(result)
    },

    async reloadMacropadAfterUpdate() {
      const offer = offered()
      if (!offer?.macropad) return
      const note = await deps.macropad.reload()
      // Only while the dialog still shows the result that offered the reload.
      const now = offered()
      if (note !== null && now?.result === offer.result) dispatch({ type: 'update', update: { ...now, macropad: null, note } })
    },

    updating: () => updating,
  }
}
