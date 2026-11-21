import { compareText } from '../folder/path'
import { decodeLenient, encodeTextFile } from '../folder/textFile'
import type { FolderAccess } from '../folder/types'
import { messageOf } from '../message'
import type { StarterFile } from '../starter'
import { fingerprint } from './fingerprint'
import { INCLUDE_FILE, adjustList, listFor, listsAll } from './includeList'
import { isSharedCommandPath, MANIFEST_PATH, writeManifest, type Manifest } from './manifest'
import { walk, type UpdatePlan } from './plan'

/** What the person ticked in the dialog. */
export interface UpdatePicks {
  /** Changed files to replace; theirs is kept beside each as a backup (<path>.before-update.bak, or .1 to .9 before .bak). */
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
  /** The backups written, under the names they got. */
  backups: string[]
  /**
   * The files this update rewrote without replacing, adding or removing them: ahk/config.ahk, when only its
   * list was brought up to date (under the person's body, or under the app's as a repair of its list).
   */
  adjusted: string[]
}

export type UpdateResult =
  | ({ ok: true } & UpdateDone)
  | ({
      ok: false
      /** The path the update stopped at, as the folder spells it; the folder's name when its root could not be listed. */
      failedAt: string
      message: string
    } & UpdateDone)

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
  into: 'replaced' | 'added' | 'adjusted'
}

/** What the look-again found. */
interface Found {
  /** Each path read again, by lower-case path. */
  now: Map<string, Now>
  /** The .ahk files under ahk/commands, as the folder spells them. */
  ahkFiles: string[]
  /** For each ticked changed file, by lower-case path: the first backup name the folder does not have, or null. */
  backupNames: Map<string, string | null>
}

/** The plan, the picks, the app's copy and what the look-again found. */
interface Context extends Found {
  plan: UpdatePlan
  app: Map<string, AppFile>
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
  /** Paths to replace or remove that the folder no longer had at the look-again. */
  gone: string[]
  /** Each path's fingerprint once the update is done, null when the folder will not have it, by lower-case path. */
  after: Map<string, { path: string; print: string | null }>
}

const AHK_COMMANDS = 'ahk/commands/'
/** The folders that lead to ahk/commands; walk enters every folder below it by itself. */
const TO_AHK_COMMANDS: ReadonlySet<string> = new Set(['ahk', 'ahk/commands'])
/** How many backup names a file has: <path>.before-update.bak, then <path>.before-update.1.bak to .9.bak. */
const BACKUP_NAMES = 10

const keyOf = (path: string) => path.toLowerCase()
const byLowerCase = (a: string, b: string) => compareText(keyOf(a), keyOf(b))
const isAhkCommandFile = (key: string) => key.startsWith(AHK_COMMANDS) && key.endsWith('.ahk')
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (data: Uint8Array) => new TextDecoder().decode(data)
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])
/**
 * The names a backup of `path` may take, in order. Never the plain <path>.bak: the app's own saves write that
 * name over and over (config.json.bak at every save of the layout, a command file's at "Overwrite anyway"), so
 * a backup put there would be gone at the next save. A plain <path>.bak is neither looked at nor touched.
 */
const backupNamesOf = (path: string) =>
  Array.from({ length: BACKUP_NAMES }, (_, i) => (i === 0 ? `${path}.before-update.bak` : `${path}.before-update.${i}.bak`))

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
async function readAgain(folder: FolderAccess, paths: string[]): Promise<Map<string, Now>> {
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

/**
 * The folder, whose failure to list a folder is a failure at that folder (the root goes by the folder's name).
 * walk only lists; the other calls are the folder's own.
 */
function listingAt(folder: FolderAccess): FolderAccess {
  return {
    name: folder.name,
    readBytes: folder.readBytes.bind(folder),
    writeBytes: folder.writeBytes.bind(folder),
    list: (dir) => at(dir === '' ? folder.name : dir, () => folder.list(dir)),
    remove: folder.remove.bind(folder),
  }
}

/** The .ahk files under ahk/commands, through every folder below it, as the folder spells them. */
async function ahkFilesIn(folder: FolderAccess): Promise<string[]> {
  const listing = listingAt(folder)
  const files = await walk(listing, '', await listing.list(''), new Set(TO_AHK_COMMANDS))
  return files.filter((path) => isAhkCommandFile(keyOf(path)))
}

/** For each path, the first of its backup names that the folder does not have (read in parallel), or null. */
async function freeBackupNames(folder: FolderAccess, paths: string[]): Promise<Map<string, string | null>> {
  const free = await Promise.all(
    paths.map(async (path) => {
      const names = backupNamesOf(path)
      const taken = await Promise.all(names.map((name) => at(name, async () => (await folder.readBytes(name)) !== null)))
      return [keyOf(path), names.find((_, i) => !taken[i]) ?? null] as const
    }),
  )
  return new Map(free)
}

/**
 * The look-again, just before the first write: the paths to write or remove and the include file read once
 * more, ahk/commands listed again, and the backup names probed, all in parallel. It is one read for the whole
 * update, not a second read before each single write: everything, the include file's text included, is worked
 * out from what it finds, and a file skipped at the last moment would make that text wrong for the folder.
 */
async function lookAgain(folder: FolderAccess, plan: UpdatePlan, tickedChanged: string[], tickedDeleted: string[]): Promise<Found> {
  const [now, ahkFiles, backupNames] = await Promise.all([
    readAgain(folder, pathsToLookAt(plan, tickedChanged, tickedDeleted)),
    ahkFilesIn(folder),
    freeBackupNames(folder, tickedChanged),
  ])
  return { now, ahkFiles, backupNames }
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
  if (now === undefined) throw new StepFailure(path, new Error(`${path} was not read again before the update.`))
  return now
}

function appFileOf(ctx: Context, path: string): AppFile {
  const app = ctx.app.get(keyOf(path))
  if (app === undefined) throw new StepFailure(path, new Error(`The app's copy has no ${path}.`))
  return app
}

const seenOf = (plan: UpdatePlan, path: string) => plan.seen[path] ?? null

/**
 * Whether the include file, as read again, leaves out the line of an AutoHotkey command file the folder holds: a
 * command the person switched off, as the plan counts it. Not counted: the files this update adds and the plan's
 * unfinished ones, whose lines are the update's to put in, and those it removes, which will not be there.
 */
function switchesOff(ctx: Context, data: Uint8Array): boolean {
  const { plan } = ctx
  const skip = new Set([...plan.add, ...ctx.tickedDeleted, ...plan.unfinished, ...plan.remove].map(keyOf))
  return !listsAll(decode(data), ctx.ahkFiles.filter((path) => !skip.has(keyOf(path))))
}

/**
 * Whether a path read again is as the plan saw it: the same fingerprint (or missing still) and, for the include
 * file, no command switched off.
 */
function asSeen(ctx: Context, now: Now): boolean {
  if (now.print !== seenOf(ctx.plan, now.path)) return false
  return now.data === null || keyOf(now.path) !== INCLUDE_FILE || !switchesOff(ctx, now.data)
}

/** What the look-again found of a path to replace or remove: as the plan saw it, changed since, or gone. */
function foundOf(ctx: Context, path: string): 'asSeen' | 'changed' | 'gone' {
  const now = nowOf(ctx, path)
  if (now.data === null) return 'gone'
  return asSeen(ctx, now) ? 'asSeen' : 'changed'
}

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

/** A file to replace: replaced only when it is still what the plan saw; kept when changed since, left out when gone. */
function sortReplace(ctx: Context, work: Work, path: string): void {
  const found = foundOf(ctx, path)
  if (found === 'asSeen') queueWrite(work, path, appFileOf(ctx, path), 'replaced')
  else if (found === 'changed') work.kept.push(path)
  else work.gone.push(path)
}

/** A file to remove: removed only when it is still what the plan saw; kept when changed since, left out when gone. */
function sortRemoval(ctx: Context, work: Work, path: string): void {
  const found = foundOf(ctx, path)
  if (found === 'asSeen') {
    work.removals.push(path)
    work.after.set(keyOf(path), { path, print: null })
  } else if (found === 'changed') {
    work.kept.push(path)
  } else {
    work.gone.push(path)
  }
}

/** The name the backup of `path` gets; none free ends the update before anything is written. */
function backupNameOf(ctx: Context, path: string): string {
  const name = ctx.backupNames.get(keyOf(path))
  if (!name) {
    const message = `${path}.before-update.bak and ${path}.before-update.1.bak to .9.bak are all in the way, so ${path} cannot be backed up. Move some of them away, then update again.`
    throw new StepFailure(path, new Error(message))
  }
  return name
}

/** A changed file ticked: replaced whatever it holds now, which is what goes into its backup (none when it is gone). */
function sortTicked(ctx: Context, work: Work, path: string): void {
  const now = nowOf(ctx, path)
  const app = appFileOf(ctx, path)
  if (now.data !== null) work.backups.push({ path: backupNameOf(ctx, path), data: now.data })
  queueWrite(work, path, app, 'replaced')
}

/**
 * The include file the plan had as up to date that changed since, or that switches a command off now: it is the
 * person's now, kept.
 */
function sortInclude(ctx: Context, work: Work): void {
  const now = ctx.now.get(INCLUDE_FILE)
  if (!now?.print) return
  const upToDate = seenOf(ctx.plan, now.path) === ctx.app.get(INCLUDE_FILE)?.print && !ctx.plan.changed.includes(now.path)
  if (upToDate && !asSeen(ctx, now)) work.kept.push(now.path)
}

/** Every path of the plan sorted into what is written, removed, kept or gone. */
function sortAll(ctx: Context): Work {
  const { plan } = ctx
  const after = new Map(Object.entries(plan.seen).map(([path, print]) => [keyOf(path), { path, print }]))
  for (const [key, { path, print }] of ctx.now) after.set(key, { path, print })
  const work: Work = { backups: [], writes: [], include: null, removals: [], kept: [], gone: [], after }
  for (const path of plan.add) sortMissing(ctx, work, path)
  for (const path of plan.replace) sortReplace(ctx, work, path)
  for (const path of ctx.tickedChanged) sortTicked(ctx, work, path)
  for (const path of ctx.tickedDeleted) sortMissing(ctx, work, path)
  for (const path of plan.remove) sortRemoval(ctx, work, path)
  sortInclude(ctx, work)
  work.kept.push(...ctx.untickedChanged, ...plan.keptRemoved)
  work.kept.sort(byLowerCase)
  return work
}

/** The AutoHotkey command files the folder holds after the update, by lower-case path: listed now, plus written, minus removed. */
function heldOf(ctx: Context, work: Work): Map<string, string> {
  const held = new Map(ctx.ahkFiles.map((path) => [keyOf(path), path]))
  for (const { path } of work.writes) {
    if (isAhkCommandFile(keyOf(path))) held.set(keyOf(path), path)
  }
  // The listing and the reads run in parallel: a file the listing still named may have gone before its read.
  for (const path of [...work.removals, ...work.gone]) held.delete(keyOf(path))
  return held
}

/** The app's include file, listing exactly the AutoHotkey command files the folder holds after the update. */
function wholeInclude(ctx: Context, work: Work, app: AppFile): string {
  const held = heldOf(ctx, work)
  const appFiles = [...ctx.app.values()].map(({ file }) => file.path).filter((path) => isAhkCommandFile(keyOf(path)))
  const own = [...held].filter(([key]) => !ctx.app.has(key)).map(([, path]) => path)
  return listFor(decode(app.file.data), appFiles.filter((path) => !held.has(keyOf(path))), own)
}

/** The list of the result the include file goes into when it is written whole. */
function includeInto(plan: UpdatePlan, ticked: boolean): Write['into'] {
  const names = (list: string[]) => list.some((path) => keyOf(path) === INCLUDE_FILE)
  if (ticked || names(plan.replace)) return 'replaced'
  // Neither replaced nor added: a repair of its list under the app's body.
  return names(plan.add) ? 'added' : 'adjusted'
}

/** Records the fingerprint of the include file's bytes as written. */
async function recorded(work: Work, write: Write): Promise<Write> {
  work.after.set(INCLUDE_FILE, { path: write.path, print: await fingerprint(write.path, write.data) })
  return write
}

/** The include file written whole, or null when the folder already has exactly these bytes. */
async function wholeWrite(ctx: Context, work: Work, app: AppFile, now: Now, ticked: boolean): Promise<Write | null> {
  const data = encode(wholeInclude(ctx, work, app))
  if (now.data !== null && sameBytes(data, now.data)) return null
  return recorded(work, { path: now.data === null ? app.file.path : now.path, data, into: includeInto(ctx.plan, ticked) })
}

/**
 * The folder's include file with a line for each command file this update brings in (and for each unfinished one
 * an update that stopped brought in, while it is there), and none for each it removes or found gone; null when that
 * changes nothing. The text is the person's: decoded strictly with its byte-order mark kept, as textFile does for a
 * file it edits, and one that is not UTF-8 is never edited.
 */
async function adjustedWrite(ctx: Context, work: Work, path: string, data: Uint8Array): Promise<Write | null> {
  const { file, utf8 } = await decodeLenient(path, data)
  const revived = ctx.tickedChanged.filter((ticked) => nowOf(ctx, ticked).data === null)
  const held = heldOf(ctx, work)
  const unfinished = ctx.plan.unfinished.filter((unlisted) => held.has(keyOf(unlisted)))
  const added = [...ctx.plan.add, ...ctx.tickedDeleted, ...revived, ...unfinished]
  const text = adjustList(file.text, added, [...work.removals, ...work.gone])
  if (text === file.text) return null
  if (!utf8) throw new Error(`${path} is not UTF-8 text, so its list of command files cannot be brought up to date.`)
  return recorded(work, { path, data: encodeTextFile({ ...file, text }), into: 'adjusted' })
}

/**
 * Step 3: ahk/config.ahk written whole when the plan replaces it and it is as the plan saw it (no command switched
 * off since), or when it is ticked; otherwise with its list alone adjusted. Null when the app has none or nothing
 * would change.
 */
async function includeWrite(ctx: Context, work: Work): Promise<Write | null> {
  const app = ctx.app.get(INCLUDE_FILE)
  if (app === undefined) return null
  const now = nowOf(ctx, INCLUDE_FILE)
  const ticked = ctx.tickedChanged.some((path) => keyOf(path) === INCLUDE_FILE)
  if (ticked || (ctx.plan.list === 'replace' && asSeen(ctx, now))) {
    return wholeWrite(ctx, work, app, now, ticked)
  }
  return now.data === null ? null : adjustedWrite(ctx, work, now.path, now.data)
}

/**
 * The manifest of the folder after the update: the app's fingerprint for each path it holds as the app has it,
 * the old entry for one it holds otherwise, nothing for one it does not hold; an offer for each changed file
 * not ticked; the deleted command files not ticked, and those found gone at the look-again.
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
  const gone = work.gone.filter((path) => isSharedCommandPath(path) && ctx.app.has(keyOf(path)))
  return { version: ctx.plan.to, files, deleted: [...ctx.untickedDeleted, ...gone], offered }
}

/** Looks at the folder again and works out every write, removal and the manifest, before anything is written. */
async function prepare(folder: FolderAccess, plan: UpdatePlan, picks: UpdatePicks, files: StarterFile[]) {
  const tickedChanged = tickedOf(plan.changed, picks.replaceChanged)
  const tickedDeleted = tickedOf(plan.deleted, picks.restoreDeleted)
  const [app, found] = await Promise.all([appCopyOf(files), lookAgain(folder, plan, tickedChanged, tickedDeleted)])
  const ctx: Context = {
    plan,
    app,
    ...found,
    tickedChanged,
    untickedChanged: plan.changed.filter((path) => !tickedChanged.includes(path)),
    tickedDeleted,
    untickedDeleted: plan.deleted.filter((path) => !tickedDeleted.includes(path)),
  }
  const work = sortAll(ctx)
  // A failure is named as the folder spells the file, as a failure at its write would be.
  work.include = await at(ctx.now.get(INCLUDE_FILE)?.path ?? INCLUDE_FILE, () => includeWrite(ctx, work))
  return { work, manifest: manifestOf(ctx, work) }
}

/**
 * Steps 1 to 4: the backups, the files, ahk/config.ahk, the removals. One at a time and in order, on
 * purpose: a failure must leave what was done before it and stop there (hence NOSONAR on the awaits in the loops).
 */
async function carryOut(folder: FolderAccess, work: Work, done: UpdateDone): Promise<void> {
  for (const { path, data } of work.backups) {
    await at(path, () => folder.writeBytes(path, data)) // NOSONAR S9382
    done.backups.push(path)
  }
  for (const { path, data, into } of work.include === null ? work.writes : [...work.writes, work.include]) {
    await at(path, () => folder.writeBytes(path, data)) // NOSONAR S9382
    done[into].push(path)
  }
  for (const path of work.removals) {
    await at(path, () => folder.remove(path)) // NOSONAR S9382
    done.removed.push(path)
  }
}

/**
 * Carries out `plan` with the person's `picks`, writing the app's copy (`files`): replaces what is untouched,
 * adds what is missing, removes what the app no longer has, keeps what the person changed unless ticked, and
 * writes the manifest last. Every path is read once more before the first write: one that changed since the
 * plan is kept, one that went is left out. A backup never replaces a file. The first write or removal that
 * fails ends the update with what was done until then; nothing is rolled back, and the manifest is not
 * written. Nothing under local/ is touched.
 */
export async function applyUpdate(
  folder: FolderAccess,
  plan: UpdatePlan,
  picks: UpdatePicks,
  files: StarterFile[],
): Promise<UpdateResult> {
  const done: UpdateDone = { replaced: [], added: [], removed: [], kept: [], backups: [], adjusted: [] }
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
