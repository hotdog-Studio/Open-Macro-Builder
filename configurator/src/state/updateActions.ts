import type { FolderAccess } from '../core/folder/types'
import { commandFileAt } from '../core/languages'
import { messageOf, withoutFullStop } from '../core/message'
import type { StarterFile } from '../core/starter'
import { applyUpdate, type UpdatePicks, type UpdateResult } from '../core/update/apply'
import type { StarterIndex } from '../core/update/fingerprint'
import { KNOWN_RELEASES, type KnownReleases } from '../core/update/history'
import { planUpdate, type UpdatePlan } from '../core/update/plan'
import { compareVersions } from '../core/update/version'
import type { AppActions } from './actions'
import type { MacropadActions } from './macropad'
import { loadStarter, loadStarterIndex } from './starter'
import type { Action, AppState, UpdateOffer, UpdateOutcome } from './store'

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
  /** The number of the newest load, for a check of the folder it opened. */
  loadNumber(): number
  /** The open folder; null once it is closed. */
  folder(): FolderAccess | null
  /** Resolves once the Commands tab's work in flight has ended: saves, creates, deletes and their changes of the manifest. */
  idle(): Promise<void>
  /** The command files with unsaved edits, as of the last edit (React may not have committed it yet). */
  draftPaths(): string[]
  /**
   * Scans again everything the load reads from the shared files (the command lists, the library, the icon
   * sets), as after a change from outside. The layout is the person's, under local/, and is not read again.
   */
  rescan(): Promise<void>
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
  /** True from the press of Update until its outcome is shown: nothing may open, close or reload a folder meanwhile. */
  updating(): boolean
}

/** Why Update is off while the Commands tab has unsaved changes in a shared command file. */
export const SHARED_DRAFTS = 'Save or discard your changes in the Commands tab first.'

/**
 * What keeps Update off: unsaved changes in a shared command file (`drafts` are the paths with unsaved
 * edits). Unsaved changes in the person's own files under local/, the layout among them, do not: the update
 * never touches local/.
 */
export function updateBlockers(drafts: readonly string[]): string[] {
  return drafts.some((path) => commandFileAt(path)?.group === 'shared') ? [SHARED_DRAFTS] : []
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

/** Whether an update wrote or removed any of the scripts, an include file whose list alone it rewrote among them (backups are not scripts). */
export const scriptsWritten = (result: UpdateResult) =>
  [result.replaced, result.added, result.removed, result.adjusted].some((list) => list.length > 0)

/** Whether the shared files may have changed, so they are scanned again. */
function mayHaveChanged(outcome: UpdateOutcome): boolean {
  if ('threw' in outcome) return true
  if ('notStarted' in outcome) return false
  return outcome.ok || scriptsWritten(outcome)
}

/** Why a plan made again at the press cannot be carried out, as a clause, or null when it can. */
function skipReason(plan: UpdatePlan): string | null {
  if (plan.skip === null) return null
  if (plan.skip.reason === 'newer') {
    return `this folder was last updated by version ${plan.skip.folderVersion}, which is newer than this app (${plan.to})`
  }
  return 'this folder has a .git entry now, and a folder kept with Git is not updated by this app'
}

/** Why the update could not start, as a clause that names no file. */
class NotStarted extends Error {}

const notLoaded = (e: unknown) => new NotStarted(`the app's copy of the scripts could not be loaded (${withoutFullStop(messageOf(e))})`)

/** The plan made again at the press. */
async function planAgain(src: UpdateSource, folder: FolderAccess): Promise<UpdatePlan> {
  let index: StarterIndex
  try {
    index = await src.loadIndex()
  } catch (e) {
    throw notLoaded(e)
  }
  try {
    return await planUpdate(folder, index, src.known)
  } catch (e) {
    throw new NotStarted(`the folder could not be read (${withoutFullStop(messageOf(e))})`)
  }
}

/** The files of the app's copy. */
async function filesOf(src: UpdateSource): Promise<StarterFile[]> {
  try {
    return await src.loadFiles()
  } catch (e) {
    throw notLoaded(e)
  }
}

/** What came of pressing Update: the plan it carried out (or the one it was offered) and the outcome. */
interface Shown {
  plan: UpdatePlan
  result: UpdateOutcome
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

  async function check(folder: FolderAccess, token: number): Promise<void> {
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
  }

  /**
   * Makes the plan again (the folder may have changed since the bar appeared) and loads the app's copy, then
   * carries out the picks that are still in the new plan. Null when `folder` is no longer the open one once
   * the plan is made: in the desktop app a folder access writes to whichever folder is open.
   */
  async function carryOut(src: UpdateSource, folder: FolderAccess, offer: UpdateOffer, picks: UpdatePicks): Promise<Shown | null> {
    // A delete's change of the manifest and the update's own write of it never overlap.
    await deps.idle()
    let prepared: [UpdatePlan, StarterFile[]]
    try {
      prepared = await Promise.all([planAgain(src, folder), filesOf(src)])
    } catch (e) {
      if (!(e instanceof NotStarted)) throw e
      return deps.folder() === folder ? { plan: offer.plan, result: { ok: false, notStarted: e.message } } : null
    }
    if (deps.folder() !== folder) return null
    const [plan, files] = prepared
    const skipped = skipReason(plan)
    if (skipped !== null) return { plan, result: { ok: false, notStarted: skipped } }
    return { plan, result: await applyUpdate(folder, plan, picks, files) }
  }

  /**
   * The outcome of pressing Update, with the running macropad after a success; null when the folder that was
   * open at the press is no longer the open one. Anything that throws is an outcome too, never a dialog left busy.
   */
  async function outcomeOf(src: UpdateSource, folder: FolderAccess, offer: UpdateOffer, picks: UpdatePicks): Promise<UpdateOffer | null> {
    let shown: Shown | null
    try {
      shown = await carryOut(src, folder, offer, picks)
    } catch (e) {
      shown = { plan: offer.plan, result: { ok: false, threw: messageOf(e) } }
    }
    if (shown === null) return null
    // In the desktop app, Reload the macropad when one is running.
    const macropad = shown.result.ok ? await deps.macropad.find() : null
    if (deps.folder() !== folder) return null
    return { plan: shown.plan, dialog: true, busy: false, result: shown.result, macropad, note: null }
  }

  return {
    check,

    reviewUpdate() {
      const update = offered()
      if (update) dispatch({ type: 'update', update: { ...update, dialog: true } })
    },

    dismissUpdate() {
      const update = offered()
      if (!update || update.busy) return
      dispatch({ type: 'update', update: null })
      // After a failure the bar comes back when there is still something to offer, so the update can be run again.
      const folder = deps.folder()
      if (update.result?.ok === false && folder !== null) void check(folder, deps.loadNumber())
    },

    async applyUpdate(picks) {
      const offer = offered()
      const folder = deps.folder()
      if (source === null || folder === null || updating || !offer?.dialog || offer.busy) return
      if (updateBlockers(deps.draftPaths()).length > 0) return
      updating = true
      dispatch({ type: 'update', update: { ...offer, busy: true, result: null, macropad: null, note: null } })
      let shown: UpdateOffer | null
      try {
        shown = await outcomeOf(source, folder, offer, picks)
        if (shown !== null) dispatch({ type: 'update', update: shown })
      } finally {
        // Only once the outcome is shown: until then no folder may be opened over this one.
        updating = false
      }
      if (shown?.result && mayHaveChanged(shown.result)) await deps.rescan()
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
