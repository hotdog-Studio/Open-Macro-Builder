import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { CommandFile, LangId } from '../core/languages'
import { withoutFullStop } from '../core/message'
import type { UpdateDone, UpdatePicks } from '../core/update/apply'
import { INCLUDE_FILE } from '../core/update/includeList'
import { commandFilesAfter, lostCommands, undefinedCommands, type NamedCommand } from '../core/update/lostCommands'
import { MANIFEST_PATH } from '../core/update/manifest'
import type { UpdatePlan } from '../core/update/plan'
import { compareVersions } from '../core/update/version'
import { useEditor, type UpdateOffer, type UpdateOutcome } from '../state/store'
import { scriptsWritten, updateBlockers } from '../state/updateActions'
import { ConfirmDialog } from './ConfirmDialog'
import { commandLine, remedy } from './UnsetCommands'

const TITLE = 'Update the scripts in this folder'
const LOCAL = 'Nothing under local/ is changed.'
const CHANGED = 'You changed these. They are kept as they are unless you tick them.'
const BACKUP = 'A ticked file is replaced, and yours is kept beside it as <name>.before-update.bak.'
const DELETED = 'You deleted these. They stay deleted unless you tick them.'
const ADJUST = `${INCLUDE_FILE}: yours is kept, and its list of command files was brought up to date.`
const START_AGAIN = 'Start the macropad again to use the new scripts.'
const SWITCHED_OFF = `Ticking ${INCLUDE_FILE} puts back the #Include lines you took out.`
/** The heading of the warning before the update, and after it. */
const WOULD_BE_UNSET = 'Your layout runs commands that no file would define after this update:'
const UNSET = 'Your layout runs commands that no file defines after this update:'
const NOT_RESCANNED = 'The command lists could not be read again after the update: open the folder again before you reload the macropad.'
const NOT_COMPARED =
  'What the update took away could not be compared with your layout: open the folder again before you reload the macropad.'
/** Why Update is off while the app's command files load, and when they could not be loaded. */
const CHECKING = 'Checking your layout against the new scripts…'
const NOT_READ = 'The new scripts could not be read, so nothing can be updated now. Close this and press Review the update to try again.'
const PATHS = 'break-all font-mono text-[12px] text-zinc-400'
/** What a button that is off does. */
const NOTHING = () => undefined

const files = (n: number) => (n === 1 ? '1 file' : `${n} files`)

const isInclude = (path: string) => path.toLowerCase() === INCLUDE_FILE

/** The dialog's first line: from which version to which. */
function firstLine({ from, to }: Pick<UpdatePlan, 'from' | 'to'>): string {
  if (from === null) return `From an older version to ${to}. ${LOCAL}`
  if (compareVersions(from, to) === 0) return `Brings the scripts back to version ${to}. ${LOCAL}`
  return `From ${from} to ${to}. ${LOCAL}`
}

type Failure = Extract<UpdateOutcome, { ok: false }>

/**
 * What a failed update says: where it stopped with scripts of two versions left; that the scripts were updated
 * but the manifest, written last, was not; or that it could not start, at a file or for a reason that names
 * none, and that nothing was changed or which backups stay; or, when it threw, that some scripts may be new already.
 */
function failureSentence(failure: Failure): string {
  if ('threw' in failure) {
    return `The update stopped: ${withoutFullStop(failure.threw)}. Some scripts may already be the new ones. Run the update again to finish it.`
  }
  if ('notStarted' in failure) return `The update could not start: ${failure.notStarted}. Nothing was changed.`
  const message = withoutFullStop(failure.message)
  // The manifest is written once every script is: the only step left undone is its record.
  if (failure.failedAt === MANIFEST_PATH) {
    return `The scripts were updated, but ${MANIFEST_PATH} could not be written: ${message}. Run the update again to finish it.`
  }
  if (scriptsWritten(failure)) {
    return `The update stopped at ${failure.failedAt}: ${message}. This folder now has scripts of two versions. Run the update again to finish it.`
  }
  const after = failure.backups.length > 0 ? `The backups it had made stay: ${failure.backups.join(', ')}.` : 'Nothing was changed.'
  return `The update could not start at ${failure.failedAt}: ${message}. ${after}`
}

/** Paths from the folder or the plan, as text. */
function Paths({ paths, ...name }: Readonly<{ paths: string[]; 'aria-label'?: string; 'aria-labelledby'?: string }>) {
  return (
    <ul {...name} className={`mt-1 mb-2 space-y-0.5 pl-4 ${PATHS}`}>
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  )
}

/** Paths under a line that names them. */
function NamedPaths({ heading, paths }: Readonly<{ heading: string; paths: string[] }>) {
  const id = useId()
  return (
    <>
      <p id={id} className="mt-3">
        {heading}
      </p>
      <Paths aria-labelledby={id} paths={paths} />
    </>
  )
}

/** What the macropad does about such commands, how to set it right, and how to keep a command. */
const unsetFix = (commands: readonly NamedCommand[]) =>
  `The macropad will not start until you ${remedy(commands)}. To keep a command, copy it into a file of your own before you update: Commands tab, New file.`

/** After the update, in place of Reload the macropad: what to do first. */
function clearThenReload(commands: readonly NamedCommand[]): string {
  const first = remedy(commands)
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}, or write the commands into a file of your own (Commands tab, New file); save, and then reload the macropad.`
}

interface UnsetProps {
  heading: string
  commands: NamedCommand[]
  /** The languages the person runs. */
  languages: readonly LangId[]
}

/**
 * The commands the layout runs that no file would define after the update (or defines, after it), where it runs
 * them, and what that does to the macropad. Names from the layout and the files are shown as text.
 */
function Unset({ heading, commands, languages }: Readonly<UnsetProps>) {
  const id = useId()
  if (commands.length === 0) return null
  return (
    <div className="mt-3 break-words text-amber-300">
      <p id={id}>{heading}</p>
      <ul aria-labelledby={id} className="mt-1 space-y-0.5 pl-4">
        {commands.map((command) => (
          <li key={command.name}>{commandLine(command, languages)}</li>
        ))}
      </ul>
      <p className="mt-1">{unsetFix(commands)}</p>
    </div>
  )
}

/** One row of counts: a button that shows and hides its paths. */
function Row({ label, paths }: Readonly<{ label: string; paths: string[] }>) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-zinc-800"
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[11px] text-zinc-500">
          {open ? 'hide' : 'show'}
        </span>
      </button>
      {open && <Paths aria-label={label} paths={paths} />}
    </li>
  )
}

/** What is replaced, added and removed whatever is ticked; a row with nothing in it is left out. */
function Rows({ plan }: Readonly<{ plan: UpdatePlan }>) {
  const rows = [
    { label: `Replaced ${files(plan.replace.length)} you have not changed`, paths: plan.replace },
    { label: `Added ${files(plan.add.length)}`, paths: plan.add },
    { label: `Removed ${files(plan.remove.length)}`, paths: plan.remove },
  ].filter((row) => row.paths.length > 0)
  if (rows.length === 0) return null
  return (
    <ul className="mt-3 space-y-0.5">
      {rows.map((row) => (
        <Row key={row.label} {...row} />
      ))}
    </ul>
  )
}

interface TicksProps {
  heading: string
  children?: ReactNode
  paths: string[]
  ticked: string[]
  onTick: (path: string, on: boolean) => void
}

/** A section of paths with a tick box each, labelled with its path. */
function Ticks({ heading, children, paths, ticked, onTick }: Readonly<TicksProps>) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-4">
      <h3 id={id} className="font-medium text-zinc-200">
        {heading}
      </h3>
      {children}
      <ul className="mt-1 space-y-0.5">
        {paths.map((path) => (
          <li key={path}>
            <label className="flex items-baseline gap-2">
              <input
                type="checkbox"
                className="accent-sky-500"
                checked={ticked.includes(path)}
                onChange={(e) => onTick(path, e.target.checked)}
              />
              <span className={PATHS}>{path}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The command files of the app's copy, and how far the loading has come: `files` is null unless the state is `ready`. */
interface AppCommandFiles {
  files: CommandFile[] | null
  state: 'loading' | 'ready' | 'failed'
}

const LOADING: AppCommandFiles = { files: null, state: 'loading' }

interface PlanViewProps {
  plan: UpdatePlan
  picks: UpdatePicks
  app: AppCommandFiles
  onTick: (kind: keyof UpdatePicks, path: string, on: boolean) => void
  onUpdate: () => void
}

/**
 * The commands the layout's keys run that a file defines now and none would after the update with these picks;
 * none until the app's command files have loaded (Update is off until then).
 */
function useLost(plan: UpdatePlan, picks: UpdatePicks, app: CommandFile[] | null): NamedCommand[] {
  const { ws, settings, commandFiles } = useEditor().state
  return useMemo(
    () => (app === null ? [] : lostCommands(ws, settings.languages, commandFiles, commandFilesAfter(commandFiles, app, plan, picks))),
    [ws, settings.languages, commandFiles, app, plan, picks],
  )
}

/** What the update would do, the tick boxes, and Not now and Update. */
function PlanView({ plan, picks, app, onTick, onUpdate }: Readonly<PlanViewProps>) {
  const { state, actions } = useEditor()
  const blockers = updateBlockers(Object.keys(state.commands.drafts))
  const lost = useLost(plan, picks, app.files)
  const includeTicked = picks.replaceChanged.some(isInclude)
  // Ticking a changed include file that leaves out a command file's line brings that command back.
  const switchedOff = plan.changed.some(isInclude) && plan.switchedOff.length > 0
  return (
    <ConfirmDialog
      title={TITLE}
      focusDialog
      onDismiss={actions.dismissUpdate}
      choices={[
        { label: 'Not now', onChoose: actions.dismissUpdate },
        { label: 'Update', primary: true, disabled: blockers.length > 0 || app.state !== 'ready', onChoose: onUpdate },
      ]}
    >
      <p>{firstLine(plan)}</p>
      <Rows plan={plan} />
      {plan.changed.length > 0 && (
        <Ticks
          heading={CHANGED}
          paths={plan.changed}
          ticked={picks.replaceChanged}
          onTick={(path, on) => onTick('replaceChanged', path, on)}
        >
          <p className="text-[12px] text-zinc-400">{BACKUP}</p>
        </Ticks>
      )}
      {switchedOff && <p className="mt-1 text-[12px] text-zinc-400">{SWITCHED_OFF}</p>}
      {plan.list === 'adjust' && !includeTicked && <p className="mt-2 text-[12px] text-zinc-400">{ADJUST}</p>}
      {plan.deleted.length > 0 && (
        <Ticks
          heading={DELETED}
          paths={plan.deleted}
          ticked={picks.restoreDeleted}
          onTick={(path, on) => onTick('restoreDeleted', path, on)}
        />
      )}
      <Unset heading={WOULD_BE_UNSET} commands={lost} languages={state.settings.languages} />
      {app.state === 'loading' && (
        <p role="status" className="mt-3 text-zinc-400">
          {CHECKING}
        </p>
      )}
      {app.state === 'failed' && <p className="mt-3 text-amber-300">{NOT_READ}</p>}
      {blockers.map((blocker) => (
        <p key={blocker} className="mt-3 text-amber-300">
          {blocker}
        </p>
      ))}
    </ConfirmDialog>
  )
}

/**
 * While the update runs: both buttons are off, and Escape and the backdrop do nothing. The focus is on the
 * dialog, which the busy line describes, so a screen reader announces its title and that line as the view
 * opens. The line is not a live region: nothing more is announced until the next view takes the focus.
 */
function BusyView() {
  const lineId = useId()
  return (
    <ConfirmDialog
      title={TITLE}
      focusDialog
      describedBy={lineId}
      choices={[
        { label: 'Not now', disabled: true, onChoose: NOTHING },
        { label: 'Update', primary: true, disabled: true, onChoose: NOTHING },
      ]}
    >
      <p id={lineId}>Updating the scripts…</p>
    </ConfirmDialog>
  )
}

/** After an update, the macropad's line: none while Reload the macropad is offered, then what the reload said. */
function macropadLine(offer: UpdateOffer): string | null {
  if (offer.macropad) return null
  return offer.note ?? START_AGAIN
}

/**
 * The commands the layout runs that no file defines after the update: those the rescanned lists leave undefined,
 * then those the update took away that they do not name (lists that did not land still hold the old files).
 */
function unsetAfter(offer: UpdateOffer, rescanned: NamedCommand[]): NamedCommand[] {
  const named = new Set(rescanned.map((command) => command.name.toLowerCase()))
  const lost = (offer.after?.lost ?? []).filter((command) => !named.has(command.name.toLowerCase()))
  return [...rescanned, ...lost]
}

/**
 * What the update did, in numbers and by name, and how to use the new scripts. The layout is checked against the
 * command lists as the update left them (read again before this shows): Reload the macropad is not offered while
 * the layout's keys run a command no file defines.
 */
function ResultView({ offer, result }: Readonly<{ offer: UpdateOffer; result: UpdateDone }>) {
  const { state, actions } = useEditor()
  const { ws, settings, commandFiles } = state
  const undefinedNow = useMemo(() => undefinedCommands(ws, settings.languages, commandFiles), [ws, settings.languages, commandFiles])
  const unset = unsetAfter(offer, undefinedNow)
  // Lists that were not read again may still define what the update took away: no Reload on their word.
  const notRescanned = offer.after?.rescanned === false
  // Nor when the comparison that tells what the update took away could not be made.
  const notCompared = offer.after?.compared === false
  const close = { label: 'Close', autoFocus: true, onChoose: actions.dismissUpdate }
  const reload = { label: 'Reload the macropad', primary: true, autoFocus: false, onChoose: () => void actions.reloadMacropadAfterUpdate() }
  const offersReload = offer.macropad !== null && unset.length === 0 && !notRescanned && !notCompared
  // While the macropad would not start, or that cannot be told, the lines say what to do first.
  const line = unset.length > 0 || notRescanned || notCompared ? null : macropadLine(offer)
  // An include file whose list alone this update rewrote is said so, never listed as kept as it is: under the
  // person's body, under one that changed since the plan, or as a repair of its list under the app's body.
  const adjusted = result.adjusted.some(isInclude)
  const kept = adjusted ? result.kept.filter((path) => !isInclude(path)) : result.kept
  return (
    <ConfirmDialog title={TITLE} onDismiss={actions.dismissUpdate} choices={offersReload ? [reload, close] : [{ ...close, primary: true }]}>
      <p>
        {`Updated to ${offer.plan.to}: ${result.replaced.length} replaced, ${result.added.length} added, ${result.removed.length} removed.`}
      </p>
      {kept.length > 0 && <NamedPaths heading="Kept as they are:" paths={kept} />}
      {adjusted && <p className="mt-3">{ADJUST}</p>}
      {result.backups.length > 0 && <NamedPaths heading="Your versions, kept beside the new ones:" paths={result.backups} />}
      <Unset heading={UNSET} commands={unset} languages={settings.languages} />
      {unset.length > 0 && <p className="mt-3">{clearThenReload(unset)}</p>}
      {notRescanned && <p className="mt-3">{NOT_RESCANNED}</p>}
      {notCompared && <p className="mt-3">{NOT_COMPARED}</p>}
      {line && <p className="mt-3">{line}</p>}
    </ConfirmDialog>
  )
}

/** An update that failed: where, why, and Try again. */
function FailureView({ result, onRetry }: Readonly<{ result: Failure; onRetry: () => void }>) {
  const { actions } = useEditor()
  return (
    <ConfirmDialog
      title={TITLE}
      onDismiss={actions.dismissUpdate}
      choices={[
        { label: 'Close', autoFocus: true, onChoose: actions.dismissUpdate },
        { label: 'Try again', primary: true, autoFocus: false, onChoose: onRetry },
      ]}
    >
      <p>{failureSentence(result)}</p>
    </ConfirmDialog>
  )
}

/** The command files of the app's copy, loaded each time the dialog opens: loading, then ready, or failed when they cannot be. */
function useAppCommandFiles(open: boolean): AppCommandFiles {
  const { actions } = useEditor()
  const [loaded, setLoaded] = useState<AppCommandFiles>(LOADING)
  useEffect(() => {
    if (!open) return
    let current = true
    void actions.appCommandFiles().then((files) => {
      if (current) setLoaded(files === null ? { files: null, state: 'failed' } : { files, state: 'ready' })
    })
    return () => {
      current = false
      // The next opening loads them again, and Update is off until it has.
      setLoaded(LOADING)
    }
  }, [open, actions])
  return loaded
}

/**
 * The dialog behind Review the update: what the update would do, with a tick box for each file the person
 * changed or deleted (none ticked at the start); then, in the same dialog, what came of it. The ticks live
 * here, so Try again carries out the same ones.
 */
export function UpdateDialog() {
  const { state, actions } = useEditor()
  const [picks, setPicks] = useState<UpdatePicks>({ replaceChanged: [], restoreDeleted: [] })
  const offer = state.update
  const app = useAppCommandFiles(offer?.dialog === true)
  if (!offer?.dialog) return null
  const update = () => void actions.applyUpdate(picks)
  const tick = (kind: keyof UpdatePicks, path: string, on: boolean) =>
    setPicks((now) => ({ ...now, [kind]: on ? [...now[kind], path] : now[kind].filter((p) => p !== path) }))
  if (offer.busy) return <BusyView />
  if (offer.result?.ok) return <ResultView offer={offer} result={offer.result} />
  if (offer.result) return <FailureView result={offer.result} onRetry={update} />
  return <PlanView plan={offer.plan} picks={picks} app={app} onTick={tick} onUpdate={update} />
}
