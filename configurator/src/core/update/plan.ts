import { compareText } from '../folder/path'
import type { DirEntry, FolderAccess } from '../folder/types'
import { fingerprint, type StarterIndex } from './fingerprint'
import { everShipped, releasesOf, type KnownReleases } from './history'
import { INCLUDE_FILE, listsAll, listsExactly } from './includeList'
import { isSharedCommandPath, readManifest, type Manifest } from './manifest'
import { compareVersions, isVersion } from './version'

export interface UpdatePlan {
  /** Why nothing is checked, or null. */
  skip: null | { reason: 'git' } | { reason: 'newer'; folderVersion: string }
  /** The version the folder's scripts are from; null when it cannot be told. */
  from: string | null
  to: string
  replace: string[]
  add: string[]
  remove: string[]
  /** Changed by the person: kept unless picked. */
  changed: string[]
  /** Command files the person deleted: stay deleted unless picked. */
  deleted: string[]
  /** No longer in the app's copy, but changed: kept. */
  keptRemoved: string[]
  /** What happens to ahk/config.ahk: replaced with its list rebuilt, kept with its list adjusted, or left. */
  list: 'replace' | 'adjust' | 'none'
  /** Whether there is something new to offer, so the notice comes. */
  news: boolean
  /** The fingerprint each path had when the plan was made; what Task 6 checks before it writes. */
  seen: Record<string, string | null>
  /**
   * The AutoHotkey command files in the folder that the app's copy does not have and that an update leaves
   * there, as folder paths: those no version ever had, and those in keptRemoved. The include file lists them.
   */
  ownAhkCommandFiles: string[]
  /**
   * The AutoHotkey command files of the app's copy that the folder holds as the app has them but had no record of:
   * the manifest names them as deleted or not at all, or (without one) no release shipped them. Only an update that
   * stopped before it wrote the include file leaves one there without its line, so a missing line for one is that
   * update's unfinished work, not a command the person switched off: the update puts it in.
   */
  unfinished: string[]
  manifest: Manifest | null
}

const AHK_COMMANDS = 'ahk/commands/'

/** What the check makes of one path (see "The check" in the spec); 'none' is missing and not the app's. */
type State = 'upToDate' | 'replace' | 'changed' | 'deleted' | 'add' | 'remove' | 'keptRemoved' | 'none'

/** The states of a path the app's copy has whose file the folder holds after an update in which nothing was ticked. */
const HELD: ReadonlySet<State> = new Set<State>(['upToDate', 'replace', 'changed', 'add'])
/** The states that are news by themselves. */
const NEWS: ReadonlySet<State> = new Set<State>(['replace', 'add', 'remove'])

/** A path the check looks at, keyed by its lower-case form. */
interface Target {
  /** How the app's copy spells it, else the manifest, else the known releases. */
  spelling: string
  /** The app's copy's fingerprint, when it has the path. */
  app: string | undefined
  /** The manifest's fingerprint, when it names the path. */
  recorded: string | undefined
}

/** A file the folder has at a path looked at. */
interface Present {
  /** As the folder spells it. */
  path: string
  print: string
  /** The bytes, kept for the include file only. */
  data?: Uint8Array
}

interface Entry {
  key: string
  /** As the folder spells it, else as the target is spelled. */
  path: string
  state: State
  print: string | null
  app: string | undefined
  recorded: string | undefined
}

const byLowerCase = (a: string, b: string) => compareText(a.toLowerCase(), b.toLowerCase())

const isAhkCommandFile = (key: string) => key.startsWith(AHK_COMMANDS) && key.endsWith('.ahk')

const isUnderLocal = (key: string) => key.startsWith('local/')

/** A record keyed by lower-case path. */
const byLowerPath = <T>(record: Record<string, T>) =>
  new Map(Object.entries(record).map(([path, value]) => [path.toLowerCase(), value]))

/** The plan of a folder that is not checked: a newer one is from the version it was found to be. */
function skipped(index: StarterIndex, skip: NonNullable<UpdatePlan['skip']>, manifest: Manifest | null): UpdatePlan {
  return {
    skip,
    from: skip.reason === 'newer' ? skip.folderVersion : null,
    to: index.version,
    replace: [],
    add: [],
    remove: [],
    changed: [],
    deleted: [],
    keptRemoved: [],
    list: 'none',
    news: false,
    seen: {},
    ownAhkCommandFiles: [],
    unfinished: [],
    manifest,
  }
}

/** The paths looked at: the app's copy's, the manifest's and the known releases', ignoring case, none under local/. */
function targetsOf(index: StarterIndex, manifest: Manifest | null, known: KnownReleases): Map<string, Target> {
  const recorded = byLowerPath(manifest?.files ?? {})
  const app = byLowerPath(index.files)
  const targets = new Map<string, Target>()
  for (const path of [...Object.keys(index.files), ...Object.keys(manifest?.files ?? {}), ...Object.keys(known.files)]) {
    const key = path.toLowerCase()
    if (targets.has(key) || isUnderLocal(key)) continue
    targets.set(key, { spelling: path, app: app.get(key), recorded: recorded.get(key) })
  }
  return targets
}

/** The lower-case folders that lead to a path looked at. */
function leadingFolders(keys: Iterable<string>): Set<string> {
  const folders = new Set<string>()
  for (const key of keys) {
    const parts = key.split('/')
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'))
  }
  return folders
}

/** The entries of a listing without a second name that differs from an earlier one only by case. */
function firstOfEachName(entries: DirEntry[]): DirEntry[] {
  const names = new Set<string>()
  return entries.filter((entry) => {
    const name = entry.name.toLowerCase()
    if (names.has(name)) return false
    names.add(name)
    return true
  })
}

/**
 * The files below `dir` (whose entries are given), as the folder spells them, entering only the folders
 * that lead to a path looked at and every folder under ahk/commands. The root's local is never entered:
 * no path looked at is under it.
 */
export async function walk(folder: FolderAccess, dir: string, entries: DirEntry[], leading: Set<string>): Promise<string[]> {
  const found = await Promise.all(
    firstOfEachName(entries).map(async (entry) => {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.kind === 'file') return [path]
      const key = path.toLowerCase()
      if (!leading.has(key) && !`${key}/`.startsWith(AHK_COMMANDS)) return []
      return walk(folder, path, await folder.list(path), leading)
    }),
  )
  return found.flat()
}

/** Reads, in parallel, each listed file that is a path looked at. */
async function readPresent(folder: FolderAccess, files: string[], targets: Map<string, Target>): Promise<Map<string, Present>> {
  const matched = files.filter((path) => targets.has(path.toLowerCase()))
  const read = await Promise.all(
    matched.map(async (path) => {
      const data = await folder.readBytes(path)
      // A file that went between the listing and the read is missing.
      if (data === null) return []
      const key = path.toLowerCase()
      const file: Present = { path, print: await fingerprint(path, data), ...(key === INCLUDE_FILE ? { data } : {}) }
      return [[key, file] as const]
    }),
  )
  return new Map(read.flat())
}

/** A missing file: deleted by the person, to add, or nothing when the app's copy does not have it. */
function missingState(key: string, target: Target, manifest: Manifest | null, known: KnownReleases): State {
  if (target.app === undefined) return 'none'
  // Without a manifest, a missing command file a release shipped counts as deleted by the person; one that is
  // new in the app's copy cannot have been.
  const deleted =
    manifest === null ? everShipped(known, key) : manifest.deleted.some((path) => path.toLowerCase() === key)
  return isSharedCommandPath(key) && deleted ? 'deleted' : 'add'
}

/**
 * Whether the folder had a record of a path: the manifest names it among its files and not as deleted; without a
 * manifest, a release shipped it.
 */
function recorded(key: string, target: Target, manifest: Manifest | null, known: KnownReleases): boolean {
  if (manifest === null) return everShipped(known, key)
  return target.recorded !== undefined && !manifest.deleted.some((path) => path.toLowerCase() === key)
}

/** See UpdatePlan's `unfinished`: as the folder spells them. */
function unfinishedOf(
  targets: Map<string, Target>,
  present: Map<string, Present>,
  manifest: Manifest | null,
  known: KnownReleases,
): string[] {
  const unfinished = [...targets].flatMap(([key, target]) => {
    const file = present.get(key)
    const asTheApp = file !== undefined && file.print === target.app
    const isUnfinished = isAhkCommandFile(key) && asTheApp && !recorded(key, target, manifest, known)
    return isUnfinished ? [file.path] : []
  })
  return unfinished.sort(byLowerCase)
}

/**
 * Whether the include file leaves out the line of an AutoHotkey command file the folder has (a shared one or one of
 * the person's own): the person switched that command off, which is an edit of the file whatever its body. Not
 * counted: an unfinished one, and one the update removes, which the folder will not hold afterwards.
 */
function switchesOff(present: Map<string, Present>, files: string[], notCounted: string[]): boolean {
  const data = present.get(INCLUDE_FILE)?.data
  if (data === undefined) return false
  const skip = new Set(notCounted.map((path) => path.toLowerCase()))
  const counted = files.filter((path) => isAhkCommandFile(path.toLowerCase()) && !skip.has(path.toLowerCase()))
  return !listsAll(new TextDecoder().decode(data), counted)
}

/** What the check makes of a path by its fingerprint, the app's copy compared first. */
function stateOf(key: string, target: Target, file: Present | undefined, manifest: Manifest | null, known: KnownReleases): State {
  if (file === undefined) return missingState(key, target, manifest, known)
  if (file.print === target.app) return 'upToDate'
  const untouched = file.print === target.recorded || releasesOf(known, key, file.print).length > 0
  if (target.app === undefined) return untouched ? 'remove' : 'keptRemoved'
  return untouched ? 'replace' : 'changed'
}

/** One entry per path looked at, sorted by the code units of the lower-case path. */
function entriesOf(
  targets: Map<string, Target>,
  present: Map<string, Present>,
  manifest: Manifest | null,
  known: KnownReleases,
): Entry[] {
  return [...targets]
    .map(([key, target]) => {
      const file = present.get(key)
      return {
        key,
        path: file?.path ?? target.spelling,
        state: stateOf(key, target, file, manifest, known),
        print: file?.print ?? null,
        app: target.app,
        recorded: target.recorded,
      }
    })
    .sort((a, b) => compareText(a.key, b.key))
}

/** The include file's state when it switches a command off: the person's edit, whatever its fingerprint. */
function editedState(state: State): State {
  if (state === 'upToDate' || state === 'replace') return 'changed'
  return state === 'remove' ? 'keptRemoved' : state
}

/** The entries, with the include file made the person's when it switches a command off. */
function withSwitchedOff(entries: Entry[], present: Map<string, Present>, files: string[], unfinished: string[]): Entry[] {
  const removed = entries.filter((e) => e.state === 'remove').map((e) => e.path)
  if (!switchesOff(present, files, [...unfinished, ...removed])) return entries
  return entries.map((e) => (e.key === INCLUDE_FILE ? { ...e, state: editedState(e.state) } : e))
}

const pathsIn = (entries: Entry[], state: State) => entries.filter((entry) => entry.state === state).map((entry) => entry.path)

/**
 * The version the scripts are from. Without a manifest: the oldest release that shipped each file's
 * content, and the newest of those; null when no file is one a known release shipped.
 */
function fromOf(manifest: Manifest | null, present: Map<string, Present>, known: KnownReleases): string | null {
  if (manifest !== null) return isVersion(manifest.version) ? manifest.version : null
  const oldest = [...present].flatMap(([key, file]) => releasesOf(known, key, file.print).slice(0, 1))
  return oldest.toSorted(compareVersions).at(-1) ?? null
}

/** What happens to the include file, by its state (see decision 7 of the plan). */
function listAction(state: State | undefined, listsWhatItWillHold: boolean, ahkCommandChange: boolean): UpdatePlan['list'] {
  switch (state) {
    case 'add':
    case 'replace':
      return 'replace'
    case 'upToDate':
      return listsWhatItWillHold ? 'none' : 'replace'
    case 'changed':
      return ahkCommandChange ? 'adjust' : 'none'
    default:
      return 'none'
  }
}

/**
 * The include file's action, from the AutoHotkey command files the folder will hold after an update. An unfinished
 * file without its line is a change to its list, as a file to add is.
 */
function includeListOf(entries: Entry[], present: Map<string, Present>, own: string[], unfinished: string[]): UpdatePlan['list'] {
  const willHold = [...entries.filter((e) => HELD.has(e.state) && isAhkCommandFile(e.key)).map((e) => e.path), ...own]
  const data = present.get(INCLUDE_FILE)?.data
  const text = data === undefined ? null : new TextDecoder().decode(data)
  const exact = text !== null && listsExactly(text, willHold)
  const addsOrRemoves = entries.some((e) => (e.state === 'add' || e.state === 'remove') && isAhkCommandFile(e.key))
  const change = addsOrRemoves || (text !== null && !listsAll(text, unfinished))
  return listAction(entries.find((e) => e.key === INCLUDE_FILE)?.state, exact, change)
}

/**
 * Something to replace, add or remove, or a changed file for which the app's copy is not what the person last
 * had from the app: the manifest's offered fingerprint, else the one it recorded as written (none: news). An
 * include file changed only by a switched-off command, under the app's body, has the app's copy already.
 */
function hasNews(entries: Entry[], manifest: Manifest | null): boolean {
  const offered = byLowerPath(manifest?.offered ?? {})
  const offers = (e: Entry) => e.print !== e.app && (offered.get(e.key) ?? e.recorded) !== e.app
  return entries.some((e) => NEWS.has(e.state) || (e.state === 'changed' && offers(e)))
}

/** The AutoHotkey command files the app's copy does not have that an update leaves in the folder. */
function ownAhkCommandFilesOf(files: string[], targets: Map<string, Target>, entries: Entry[]): string[] {
  const listed = files.filter((path) => isAhkCommandFile(path.toLowerCase()) && !targets.has(path.toLowerCase()))
  const kept = entries.filter((e) => e.state === 'keptRemoved' && isAhkCommandFile(e.key)).map((e) => e.path)
  return [...listed, ...kept].sort(byLowerCase)
}

/**
 * What an update of the folder's shared files would do; nothing is written. Only the paths of the
 * app's copy, the manifest and the known releases are read; the person's own files are only listed,
 * and nothing under local/ is listed or read. A failure to list or read rejects. A folder newer than the
 * app is skipped as `newer`: by its manifest, or (without one) by its files when an update would offer something.
 */
export async function planUpdate(folder: FolderAccess, index: StarterIndex, known: KnownReleases): Promise<UpdatePlan> {
  const root = await folder.list('')
  if (root.some((entry) => entry.name.toLowerCase() === '.git')) return skipped(index, { reason: 'git' }, null)
  const manifest = await readManifest(folder)
  if (manifest !== null && compareVersions(manifest.version, index.version) > 0) {
    return skipped(index, { reason: 'newer', folderVersion: manifest.version }, manifest)
  }
  const targets = targetsOf(index, manifest, known)
  const files = await walk(folder, '', root, leadingFolders(targets.keys()))
  const present = await readPresent(folder, files, targets)
  const from = fromOf(manifest, present, known)
  const unfinished = unfinishedOf(targets, present, manifest, known)
  const entries = withSwitchedOff(entriesOf(targets, present, manifest, known), present, files, unfinished)
  const news = hasNews(entries, manifest)
  // Without a manifest, files of a release newer than the app (a development build meeting a folder a
  // release set up) are never offered the app's older copy. With nothing to offer (a copy of the app's
  // own files, as a developer opens it), the plan is the ordinary one and nothing is said.
  if (manifest === null && news && from !== null && compareVersions(from, index.version) > 0) {
    return skipped(index, { reason: 'newer', folderVersion: from }, null)
  }
  const own = ownAhkCommandFilesOf(files, targets, entries)
  return {
    skip: null,
    from,
    to: index.version,
    replace: pathsIn(entries, 'replace'),
    add: pathsIn(entries, 'add'),
    remove: pathsIn(entries, 'remove'),
    changed: pathsIn(entries, 'changed'),
    deleted: pathsIn(entries, 'deleted'),
    keptRemoved: pathsIn(entries, 'keptRemoved'),
    list: includeListOf(entries, present, own, unfinished),
    news,
    seen: Object.fromEntries(entries.map((e) => [e.path, e.print])),
    ownAhkCommandFiles: own,
    unfinished,
    manifest,
  }
}
