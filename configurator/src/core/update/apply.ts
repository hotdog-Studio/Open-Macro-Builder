import { compareText } from '../folder/path'
import type { FolderAccess } from '../folder/types'
import type { StarterFile } from '../starter'
import { fingerprint } from './fingerprint'
import { INCLUDE_FILE, adjustList, listFor } from './includeList'
import { MANIFEST_PATH, writeManifest, type Manifest } from './manifest'
import type { UpdatePlan } from './plan'

/** What the person ticked in the dialog. */
export interface UpdatePicks {
  /** Changed files to replace; theirs is kept beside each as <path>.bak. */
  replaceChanged: string[]
  /** Deleted command files to bring back. */
  restoreDeleted: string[]
}

/** What an update did, each path as the folder spells it. */
export interface UpdateDone {
  replaced: string[]
  added: string[]
  removed: string[]
  /** Left as the person has them: changed ones not ticked, changed ones the app no longer has, and those that changed since the plan. */
  kept: string[]
  backups: string[]
}

export type UpdateResult =
  | ({ ok: true } & UpdateDone)
  | ({ ok: false; failedAt: string; message: string } & UpdateDone)

/** The message of what a step threw or rejected with. */
function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return typeof cause === 'string' ? cause : 'An unknown error.'
}

/** A step that failed: the path it was at, with the message of the error it met. */
class StepFailure extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(messageOf(cause))
  }
}

/** Runs the step at `path`; what it throws or rejects with becomes a StepFailure there. */
async function at<T>(path: string, step: () => T | Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (error) {
    throw new StepFailure(path, error)
  }
}

/** A file of the app's copy, with its fingerprint. */
interface AppFile {
  file: StarterFile
  print: string
}

/** A path as the folder has it just before the first write; data and print are null when it is missing. */
interface Now {
  path: string
  data: Uint8Array | null
  print: string | null
}

/** A file to write, and the list of the result it goes into once written. */
interface Write {
  path: string
  data: Uint8Array
  into: 'replaced' | 'added' | null
}

/** The plan, the app's copy and what the second look found, by lower-case path. */
interface Context {
  plan: UpdatePlan
  app: Map<string, AppFile>
  now: Map<string, Now>
  tickedChanged: string[]
  untickedChanged: string[]
  tickedDeleted: string[]
  untickedDeleted: string[]
}

/** The update to carry out, worked out before the first write. */
interface Work {
  backups: StarterFile[]
  writes: Write[]
  include: Write | null
  removals: string[]
  kept: string[]
  /** The removals left as they are because they changed since the plan. */
  keptRemovals: string[]
  /** Each path's fingerprint once the update is done, null when the folder will not have it, by lower-case path. */
  after: Map<string, { path: string; print: string | null }>
}

const keyOf = (path: string) => path.toLowerCase()
const byLowerCase = (a: string, b: string) => compareText(keyOf(a), keyOf(b))
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (data: Uint8Array) => new TextDecoder().decode(data)

/** The paths of `list` that `picks` names, ignoring case; a pick of any other path is ignored. */
function tickedOf(list: string[], picks: string[]): string[] {
  const picked = new Set(picks.map(keyOf))
  return list.filter((path) => picked.has(keyOf(path)))
}

/** Every path this update may write or remove, and the include file, once each. */
function pathsToLookAt(plan: UpdatePlan, tickedChanged: string[], tickedDeleted: string[]): string[] {
  const include = Object.keys(plan.seen).filter((path) => keyOf(path) === INCLUDE_FILE)
  const all = [...plan.add, ...plan.replace, ...tickedChanged, ...tickedDeleted, ...plan.remove, ...include]
  return [...new Map(all.map((path) => [keyOf(path), path])).values()]
}

/** Reads each path once more, in parallel, with its fingerprint. A failed read is a failure at that path. */
async function lookAgain(folder: FolderAccess, paths: string[]): Promise<Map<string, Now>> {
  const read = await Promise.all(
    paths.map((path) =>
      at(path, async () => {
        const data = await folder.readBytes(path)
        const now: Now = { path, data, print: data === null ? null : await fingerprint(path, data) }
        return [keyOf(path), now] as const
      }),
    ),
  )
  return new Map(read)
}

/** The app's copy by lower-case path, each file with its fingerprint (computed in parallel). */
async function appCopyOf(files: StarterFile[]): Promise<Map<string, AppFile>> {
  const entries = await Promise.all(
    files.map(async (file) => [keyOf(file.path), { file, print: await fingerprint(file.path, file.data) }] as const),
  )
  return new Map(entries)
}

function nowOf(ctx: Context, path: string): Now {
  const now = ctx.now.get(keyOf(path))
  if (now === undefined) throw new Error(`${path} was not read again before the update.`)
  return now
}

function appFileOf(ctx: Context, path: string): AppFile {
  const app = ctx.app.get(keyOf(path))
  if (app === undefined) throw new StepFailure(path, new Error(`The app's copy has no ${path}.`))
  return app
}

const seenOf = (plan: UpdatePlan, path: string) => plan.seen[path] ?? null

/** Queues the app's copy to be written at `path` in step 2; the include file waits for step 3. */
function queueWrite(work: Work, path: string, app: AppFile, into: Write['into']): void {
  if (keyOf(path) === INCLUDE_FILE) return
  work.writes.push({ path, data: app.file.data, into })
  work.after.set(keyOf(path), { path, print: app.print })
}

/** A file to add, or a deleted one ticked: written, as the app spells it, only while the folder still lacks it. */
function sortMissing(ctx: Context, work: Work, path: string): void {
  const now = nowOf(ctx, path)
  const app = appFileOf(ctx, path)
  if (now.data === null) queueWrite(work, app.file.path, app, 'added')
  else if (now.print !== app.print) work.kept.push(path)
}

/** A file to replace: replaced only when it is still what the plan saw. */
function sortReplace(ctx: Context, work: Work, path: string): void {
  if (nowOf(ctx, path).print === seenOf(ctx.plan, path)) queueWrite(work, path, appFileOf(ctx, path), 'replaced')
  else work.kept.push(path)
}

/** A changed file ticked: replaced whatever it holds now, which is what goes into its .bak. */
function sortTicked(ctx: Context, work: Work, path: string): void {
  const now = nowOf(ctx, path)
  const app = appFileOf(ctx, path)
  if (now.data !== null) work.backups.push({ path: `${path}.bak`, data: now.data })
  queueWrite(work, path, app, 'replaced')
}

/** A file to remove: removed only when it is still what the plan saw. */
function sortRemoval(ctx: Context, work: Work, path: string): void {
  if (nowOf(ctx, path).print === seenOf(ctx.plan, path)) {
    work.removals.push(path)
    work.after.set(keyOf(path), { path, print: null })
  } else {
    work.kept.push(path)
    work.keptRemovals.push(path)
  }
}

/** The app's include file, listing what the folder holds after the update besides the app's own command files. */
function wholeInclude(ctx: Context, work: Work, app: AppFile): string {
  return listFor(decode(app.file.data), ctx.untickedDeleted, [...ctx.plan.ownAhkCommandFiles, ...work.keptRemovals])
}

/** The folder's include file with a line for each command file this update brings in and none for those it removes. */
function adjustedInclude(ctx: Context, work: Work, current: string | null): string | null {
  if (current === null) return null
  return adjustList(current, [...ctx.plan.add, ...ctx.tickedDeleted], work.removals)
}

/** The list of the result the include file goes into when it is written whole. */
function includeInto(plan: UpdatePlan, ticked: boolean): Write['into'] {
  const names = (list: string[]) => list.some((path) => keyOf(path) === INCLUDE_FILE)
  if (ticked || names(plan.replace)) return 'replaced'
  return names(plan.add) ? 'added' : null
}

/**
 * Step 3: ahk/config.ahk written whole when the plan replaces it and it is as the plan saw it, or when it is
 * ticked; otherwise with its list alone adjusted. Null when the app has none or its text would not change.
 */
function includeWrite(ctx: Context, work: Work): Write | null {
  const app = ctx.app.get(INCLUDE_FILE)
  if (app === undefined) return null
  const now = nowOf(ctx, INCLUDE_FILE)
  const ticked = ctx.tickedChanged.some((path) => keyOf(path) === INCLUDE_FILE)
  const whole = ticked || (ctx.plan.list === 'replace' && now.print === seenOf(ctx.plan, now.path))
  const current = now.data === null ? null : decode(now.data)
  const text = whole ? wholeInclude(ctx, work, app) : adjustedInclude(ctx, work, current)
  if (text === null || text === current) return null
  const path = now.data === null ? app.file.path : now.path
  if (whole) work.after.set(INCLUDE_FILE, { path, print: app.print })
  return { path, data: encode(text), into: whole ? includeInto(ctx.plan, ticked) : null }
}

/**
 * The manifest of the folder after the update: the app's fingerprint for each path it holds as the app has it,
 * the old entry for one it holds otherwise, nothing for one it does not hold; an offer for each changed file
 * not ticked; the deleted command files not ticked.
 */
function manifestOf(ctx: Context, work: Work): Manifest {
  const old = new Map(Object.entries(ctx.plan.manifest?.files ?? {}).map(([path, print]) => [keyOf(path), print]))
  const files: Record<string, string> = {}
  for (const [key, { path, print }] of work.after) {
    if (print === null) continue
    const entry = print === ctx.app.get(key)?.print ? print : old.get(key)
    if (entry !== undefined) files[path] = entry
  }
  const offered = Object.fromEntries(ctx.untickedChanged.map((path) => [path, appFileOf(ctx, path).print]))
  return { version: ctx.plan.to, files, deleted: ctx.untickedDeleted, offered }
}

/** Looks at the folder again and works out every write, removal and the manifest, before anything is written. */
async function prepare(folder: FolderAccess, plan: UpdatePlan, picks: UpdatePicks, files: StarterFile[]) {
  const tickedChanged = tickedOf(plan.changed, picks.replaceChanged)
  const tickedDeleted = tickedOf(plan.deleted, picks.restoreDeleted)
  const toLookAt = pathsToLookAt(plan, tickedChanged, tickedDeleted)
  const [app, now] = await Promise.all([appCopyOf(files), lookAgain(folder, toLookAt)])
  const ctx: Context = {
    plan,
    app,
    now,
    tickedChanged,
    untickedChanged: plan.changed.filter((path) => !tickedChanged.includes(path)),
    tickedDeleted,
    untickedDeleted: plan.deleted.filter((path) => !tickedDeleted.includes(path)),
  }
  const after = new Map(Object.entries(plan.seen).map(([path, print]) => [keyOf(path), { path, print }]))
  for (const [key, { path, print }] of now) after.set(key, { path, print })
  const work: Work = { backups: [], writes: [], include: null, removals: [], kept: [], keptRemovals: [], after }
  for (const path of plan.add) sortMissing(ctx, work, path)
  for (const path of plan.replace) sortReplace(ctx, work, path)
  for (const path of ctx.tickedChanged) sortTicked(ctx, work, path)
  for (const path of ctx.tickedDeleted) sortMissing(ctx, work, path)
  for (const path of plan.remove) sortRemoval(ctx, work, path)
  work.kept.push(...ctx.untickedChanged, ...plan.keptRemoved)
  work.kept.sort(byLowerCase)
  work.include = await at(INCLUDE_FILE, () => includeWrite(ctx, work))
  return { work, manifest: manifestOf(ctx, work) }
}

/**
 * Steps 1 to 4: the .bak copies, the files, ahk/config.ahk, the removals. One at a time and in order, on
 * purpose: a failure must leave what was done before it and stop there (hence NOSONAR on the awaits in the loops).
 */
async function carryOut(folder: FolderAccess, work: Work, done: UpdateDone): Promise<void> {
  for (const { path, data } of work.backups) {
    await at(path, () => folder.writeBytes(path, data)) // NOSONAR S9382
    done.backups.push(path)
  }
  for (const { path, data, into } of work.include === null ? work.writes : [...work.writes, work.include]) {
    await at(path, () => folder.writeBytes(path, data)) // NOSONAR S9382
    if (into !== null) done[into].push(path)
  }
  for (const path of work.removals) {
    await at(path, () => folder.remove(path)) // NOSONAR S9382
    done.removed.push(path)
  }
}

/**
 * Carries out `plan` with the person's `picks`, writing the app's copy (`files`): replaces what is untouched,
 * adds what is missing, removes what the app no longer has, keeps what the person changed unless ticked, and
 * writes the manifest last. Every path is read once more before the first write, and one that changed since
 * the plan is kept. The first write or removal that fails ends the update with what was done until then;
 * nothing is rolled back, and the manifest is not written. Nothing under local/ is touched.
 */
export async function applyUpdate(
  folder: FolderAccess,
  plan: UpdatePlan,
  picks: UpdatePicks,
  files: StarterFile[],
): Promise<UpdateResult> {
  const done: UpdateDone = { replaced: [], added: [], removed: [], kept: [], backups: [] }
  if (plan.skip !== null) return { ok: true, ...done }
  try {
    const { work, manifest } = await prepare(folder, plan, picks, files)
    done.kept.push(...work.kept)
    await carryOut(folder, work, done)
    await at(MANIFEST_PATH, () => writeManifest(folder, manifest))
    return { ok: true, ...done }
  } catch (error) {
    if (!(error instanceof StepFailure)) throw error
    return { ok: false, failedAt: error.path, message: error.message, ...done }
  }
}
