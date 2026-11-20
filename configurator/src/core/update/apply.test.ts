import { describe, expect, it } from 'vitest'
import { GuardedFolder, type FolderCall } from '../../../test/guardedFolder'
import { MemoryFolder } from '../folder/memory'
import type { DirEntry, FolderAccess } from '../folder/types'
import type { StarterFile } from '../starter'
import { applyUpdate, type UpdateDone, type UpdatePicks, type UpdateResult } from './apply'
import { fingerprint, type StarterIndex } from './fingerprint'
import { everShipped, type KnownReleases } from './history'
import { INCLUDE_FILE, listsExactly } from './includeList'
import { MANIFEST_PATH, readManifest } from './manifest'
import { planUpdate, type UpdatePlan } from './plan'

type Texts = Record<string, string>
/** A text replaces or adds a file; null takes it out. */
type Changes = Record<string, string | null>

const encode = (text: string) => new TextEncoder().encode(text)
const print = (path: string, text: string) => fingerprint(path, encode(text))

const lines = (...all: string[]) => [...all, ''].join('\n')
const WINDOWS = String.raw`#Include commands\windows.ahk`
const CHROME = String.raw`#Include commands\custom\chrome.ahk`
const NEW = String.raw`#Include commands\custom\new.ahk`
const GONE = String.raw`#Include commands\gone.ahk`
const MINE = String.raw`#Include commands\custom\mine.ahk`

/** An include file: a title line, then a Custom Commands section listing `listed`, then the next section. */
const includeText = (title: string, ...listed: string[]) =>
  lines(title, '; ****** Custom Commands ******', ...listed, '; ****** Macro Definitions ******')

const WINDOWS_FILE = 'ahk/commands/windows.ahk'
const CHROME_FILE = 'ahk/commands/custom/chrome.ahk'
const NEW_FILE = 'ahk/commands/custom/new.ahk'
const MINE_FILE = 'ahk/commands/custom/mine.ahk'
const GONE_FILE = 'ahk/commands/gone.ahk'
const JSON_FILE = 'ahk/lib/json.ahk'
const SSH_FILE = 'powershell/commands/custom/ssh.ps1'
const OLD_PS1 = 'powershell/commands/old.ps1'

/** The app's copy (1.0.6), as texts. */
const APP: Texts = {
  'config.json': 'config 1.0.6\n',
  [INCLUDE_FILE]: includeText('; config 1.0.6', WINDOWS, CHROME, NEW),
  [JSON_FILE]: 'json 1.0.6\n',
  [WINDOWS_FILE]: 'windows 1.0.6\n',
  [CHROME_FILE]: 'chrome 1.0.6\n',
  /** New in 1.0.6: no release shipped it. */
  [NEW_FILE]: 'new 1.0.6\n',
  [SSH_FILE]: 'ssh 1.0.6\n',
}

/** What 1.0.5, a release before the record, shipped: a folder it set up holds these. */
const OLD: Texts = {
  'config.json': 'config 1.0.5\n',
  [INCLUDE_FILE]: includeText('; config 1.0.5', WINDOWS, CHROME, GONE),
  [JSON_FILE]: 'json 1.0.5\n',
  [WINDOWS_FILE]: 'windows 1.0.5\n',
  [CHROME_FILE]: 'chrome 1.0.5\n',
  /** Gone in 1.0.6, like the next one. */
  [GONE_FILE]: 'gone 1.0.5\n',
  [SSH_FILE]: 'ssh 1.0.5\n',
  [OLD_PS1]: 'old 1.0.5\n',
}

/** The name of a backup the update makes: the first free one, or the nth after it. */
const backupOf = (path: string, n = 0) => (n === 0 ? `${path}.before-update.bak` : `${path}.before-update.${n}.bak`)

/** An include file the person changed, listing what 1.0.5 shipped. */
const MY_INCLUDE: Changes = { [INCLUDE_FILE]: includeText('; my config', WINDOWS, CHROME, GONE) }
/** On a folder 1.0.5 set up: the app's copy, and nothing the app no longer has. */
const UP_TO_DATE: Changes = { ...APP, [GONE_FILE]: null, [OLD_PS1]: null }

const FILES: StarterFile[] = Object.entries(APP).map(([path, text]) => ({ path, data: encode(text) }))

/** Each path's text turned into its fingerprint. */
async function printsOf(texts: Texts): Promise<Record<string, string>> {
  const entries = await Promise.all(Object.entries(texts).map(async ([path, text]) => [path, await print(path, text)] as const))
  return Object.fromEntries(entries)
}

/** The app's fingerprint of a path of its copy. */
const appPrint = (path: string) => print(path, APP[path])

interface Fixture {
  index: StarterIndex
  known: KnownReleases
}

async function fixtureOf(): Promise<Fixture> {
  const old = await printsOf(OLD)
  return {
    index: { version: '1.0.6', files: await printsOf(APP) },
    known: { last: '1.0.5', files: Object.fromEntries(Object.entries(old).map(([path, sum]) => [path, { [sum]: ['1.0.5'] }])) },
  }
}

const FIXTURE = fixtureOf()

/** A manifest, with texts where it holds fingerprints. */
interface ManifestTexts {
  version: string
  files?: Texts
  deleted?: string[]
}

/** The files of a folder 1.0.5 set up, with `changes` on top, and the manifest when one is given. */
async function textsOf(changes: Changes, manifest: ManifestTexts | null): Promise<Texts> {
  const texts: Texts = {}
  for (const [path, text] of Object.entries({ ...OLD, ...changes })) {
    if (text !== null) texts[path] = text
  }
  if (manifest !== null) {
    const files = await printsOf(manifest.files ?? {})
    texts[MANIFEST_PATH] = JSON.stringify({ version: manifest.version, files, deleted: manifest.deleted ?? [], offered: {} })
  }
  return texts
}

const folderOf = async (changes: Changes = {}, manifest: ManifestTexts | null = null) =>
  new MemoryFolder('scripts', await textsOf(changes, manifest))

async function change(folder: FolderAccess, changes: Changes): Promise<void> {
  await Promise.all(
    Object.entries(changes).map(([path, text]) => (text === null ? folder.remove(path) : folder.writeBytes(path, encode(text)))),
  )
}

/** A folder that refuses a read of a path no version ever had (a backup name aside), and every call under local/. */
async function guardedOf(folder: FolderAccess): Promise<GuardedFolder> {
  const { index, known } = await FIXTURE
  const app = new Set(Object.keys(index.files).map((path) => path.toLowerCase()))
  const mayRead = (path: string) =>
    path === MANIFEST_PATH || path.endsWith('.bak') || app.has(path.toLowerCase()) || everShipped(known, path)
  return new GuardedFolder(folder, mayRead)
}

/** The next check of the folder, by the same app. */
async function nextPlan(folder: FolderAccess): Promise<UpdatePlan> {
  const { index, known } = await FIXTURE
  return planUpdate(folder, index, known)
}

const NO_PICKS: UpdatePicks = { replaceChanged: [], restoreDeleted: [] }
const NOTHING_DONE: UpdateDone = { replaced: [], added: [], removed: [], kept: [], backups: [] }

interface UpdateOptions {
  picks?: UpdatePicks
  /** Made between the plan and the update. */
  later?: Changes
  files?: StarterFile[]
  index?: StarterIndex
  known?: KnownReleases
  /** A call to fail, through GuardedFolder's `fails`, with `failure`. */
  fails?: GuardedFolder['fails']
  failure?: unknown
}

interface Run {
  plan: UpdatePlan
  guarded: GuardedFolder
  result: UpdateResult
}

/** Plans the update of `folder`, makes the `later` changes, then carries the plan out through a GuardedFolder. */
async function update(folder: FolderAccess, options: UpdateOptions = {}): Promise<Run> {
  const { picks = NO_PICKS, later = {}, files = FILES, fails = null, failure = new Error('disk full') } = options
  const { index, known } = await FIXTURE
  const plan = await planUpdate(folder, options.index ?? index, options.known ?? known)
  await change(folder, later)
  const guarded = await guardedOf(folder)
  guarded.fails = fails
  guarded.failure = failure
  return { plan, guarded, result: await applyUpdate(guarded, plan, picks, files) }
}

/** The calls that change the folder. */
/** A folder whose read of a path in `gone` finds nothing, while its listing still names it. */
class Vanishing extends MemoryFolder {
  readonly gone = new Set<string>()
  override readBytes(path: string): Promise<Uint8Array | null> {
    return this.gone.has(path) ? Promise.resolve(null) : super.readBytes(path)
  }
}

const changesIn = (calls: FolderCall[]) => calls.filter((call) => call.op === 'writeBytes' || call.op === 'remove')

/** Every file below `dir`. */
async function filesUnder(folder: FolderAccess, dir: string): Promise<string[]> {
  const entries: DirEntry[] = await folder.list(dir)
  const found = await Promise.all(
    entries.map((entry) => (entry.kind === 'file' ? [`${dir}/${entry.name}`] : filesUnder(folder, `${dir}/${entry.name}`))),
  )
  return found.flat()
}

/** The AutoHotkey command files the folder holds. */
const ahkCommandFilesIn = async (folder: FolderAccess) =>
  (await filesUnder(folder, 'ahk/commands')).filter((path) => path.toLowerCase().endsWith('.ahk'))

/** Whether the folder's include file lists exactly the AutoHotkey command files it holds. */
const listsWhatItHolds = async (folder: MemoryFolder) =>
  listsExactly(folder.text(INCLUDE_FILE) ?? '', await ahkCommandFilesIn(folder))

const LISTS = ['replaced', 'added', 'removed', 'kept', 'backups'] as const
/** The lists of the result that name `path`. */
const listsHolding = (result: UpdateResult, path: string) => LISTS.filter((list) => result[list].includes(path))

/**
 * A folder 1.0.5 set up, with an entry of every kind: an include file of an earlier body (its list with the
 * person's own file and without a deleted one), a file to replace, one to add, one to remove, two changed
 * (one ticked), two deleted (one ticked), a changed one the app no longer has, and the person's local/.
 */
const EVERY: Changes = {
  [INCLUDE_FILE]: includeText('; config 1.0.5', WINDOWS, GONE, MINE),
  [JSON_FILE]: 'my json\n',
  [WINDOWS_FILE]: 'my windows\n',
  [CHROME_FILE]: null,
  [MINE_FILE]: 'mine\n',
  [SSH_FILE]: null,
  [OLD_PS1]: 'my old\n',
  'local/configurator.json': '{}\n',
  'local/ahk/commands.ahk': 'x\n',
}
const EVERY_PICKS: UpdatePicks = { replaceChanged: [WINDOWS_FILE], restoreDeleted: [SSH_FILE] }
const EVERY_DONE: UpdateDone = {
  replaced: ['config.json', WINDOWS_FILE, INCLUDE_FILE],
  added: [NEW_FILE, SSH_FILE],
  removed: [GONE_FILE],
  kept: [JSON_FILE, OLD_PS1],
  backups: [backupOf(WINDOWS_FILE)],
}

describe('applyUpdate: a plan with every kind of entry', () => {
  it('reads and lists first, then writes the backups, the files, ahk/config.ahk, the removals, and the manifest last', async () => {
    const { plan, guarded } = await update(await folderOf(EVERY), { picks: EVERY_PICKS })
    expect(plan.list).toBe('replace')
    const changing = changesIn(guarded.calls)
    expect(guarded.calls.slice(guarded.calls.indexOf(changing[0]))).toEqual(changing)
    expect(changing).toEqual([
      { op: 'writeBytes', path: backupOf(WINDOWS_FILE) },
      { op: 'writeBytes', path: NEW_FILE },
      { op: 'writeBytes', path: 'config.json' },
      { op: 'writeBytes', path: WINDOWS_FILE },
      { op: 'writeBytes', path: SSH_FILE },
      { op: 'writeBytes', path: INCLUDE_FILE },
      { op: 'remove', path: GONE_FILE },
      { op: 'writeBytes', path: MANIFEST_PATH },
    ])
  })

  it('says what it replaced, added, removed, kept and backed up', async () => {
    const { result } = await update(await folderOf(EVERY), { picks: EVERY_PICKS })
    expect(result).toEqual({ ok: true, ...EVERY_DONE })
  })

  it("keeps the person's bytes of a ticked changed file in its backup, and writes the app's copy at its path", async () => {
    const folder = await folderOf(EVERY)
    await update(folder, { picks: EVERY_PICKS })
    expect(folder.text(backupOf(WINDOWS_FILE))).toBe('my windows\n')
    expect(folder.text(WINDOWS_FILE)).toBe(APP[WINDOWS_FILE])
    expect(folder.text(JSON_FILE)).toBe('my json\n')
    expect(folder.text(backupOf(JSON_FILE))).toBeNull()
  })

  it('brings a ticked deleted file back and takes it out of deleted; an unticked one stays deleted and stays in it', async () => {
    const folder = await folderOf(EVERY)
    await update(folder, { picks: EVERY_PICKS })
    expect(folder.text(SSH_FILE)).toBe(APP[SSH_FILE])
    expect(folder.text(CHROME_FILE)).toBeNull()
    expect((await readManifest(folder))?.deleted).toEqual([CHROME_FILE])
  })

  it('gives a folder without a manifest one, naming the deleted command files that were not ticked', async () => {
    const folder = await folderOf(EVERY)
    const { plan } = await update(folder, { picks: EVERY_PICKS })
    expect(plan.manifest).toBeNull()
    expect(await readManifest(folder)).toEqual({
      version: '1.0.6',
      files: {
        [INCLUDE_FILE]: await appPrint(INCLUDE_FILE),
        [NEW_FILE]: await appPrint(NEW_FILE),
        [WINDOWS_FILE]: await appPrint(WINDOWS_FILE),
        'config.json': await appPrint('config.json'),
        [SSH_FILE]: await appPrint(SSH_FILE),
      },
      deleted: [CHROME_FILE],
      offered: { [JSON_FILE]: await appPrint(JSON_FILE) },
    })
  })

  it('lists exactly the AutoHotkey command files the folder holds afterwards', async () => {
    const folder = await folderOf(EVERY)
    await update(folder, { picks: EVERY_PICKS })
    expect(folder.text(INCLUDE_FILE)).toBe(includeText('; config 1.0.6', WINDOWS, NEW, MINE))
    expect(await listsWhatItHolds(folder)).toBe(true)
  })

  it('leaves a folder the next check finds up to date, with nothing new to offer', async () => {
    const folder = await folderOf(EVERY)
    await update(folder, { picks: EVERY_PICKS })
    expect(await nextPlan(folder)).toMatchObject({
      replace: [],
      add: [],
      remove: [],
      changed: [JSON_FILE],
      deleted: [CHROME_FILE],
      keptRemoved: [OLD_PS1],
      list: 'none',
      news: false,
    })
  })

  it('reads, writes and removes nothing under local/', async () => {
    const folder = await folderOf(EVERY)
    const { guarded } = await update(folder, { picks: EVERY_PICKS })
    expect(guarded.refused).toEqual([])
    expect(guarded.calls.filter((call) => call.path.toLowerCase().startsWith('local'))).toEqual([])
    expect(folder.text('local/configurator.json')).toBe('{}\n')
    expect(folder.text('local/ahk/commands.ahk')).toBe('x\n')
  })

  it('takes a pick in any case, and ignores one that names no changed or deleted path', async () => {
    const picks: UpdatePicks = {
      replaceChanged: ['AHK/Commands/Windows.AHK', 'config.json', OLD_PS1],
      restoreDeleted: ['Powershell/Commands/Custom/SSH.ps1', JSON_FILE],
    }
    const folder = await folderOf(EVERY)
    const { result } = await update(folder, { picks })
    expect(result).toEqual({ ok: true, ...EVERY_DONE })
    expect(folder.text(JSON_FILE)).toBe('my json\n')
    expect(folder.text(OLD_PS1)).toBe('my old\n')
    expect(folder.text(backupOf('config.json'))).toBeNull()
  })
})

describe('applyUpdate: the manifest', () => {
  it("holds the app's fingerprint for each path as the app has it, the old entry and an offer for a kept changed file", async () => {
    const folder = await folderOf(
      { [JSON_FILE]: 'my json\n', [CHROME_FILE]: APP[CHROME_FILE], [OLD_PS1]: 'my old\n' },
      {
        version: '1.0.5',
        files: { [JSON_FILE]: 'json by 1.0.5-rc\n', [GONE_FILE]: OLD[GONE_FILE], [OLD_PS1]: 'old by 1.0.5-rc\n' },
        // Brought back by hand since: the entry goes, as the folder holds the file.
        deleted: [CHROME_FILE],
      },
    )
    const { plan, result } = await update(folder)
    expect(plan.changed).toEqual([JSON_FILE])
    expect(plan.keptRemoved).toEqual([OLD_PS1])
    expect(result.ok).toBe(true)
    expect(await readManifest(folder)).toEqual({
      version: '1.0.6',
      files: {
        [INCLUDE_FILE]: await appPrint(INCLUDE_FILE),
        [CHROME_FILE]: await appPrint(CHROME_FILE),
        [NEW_FILE]: await appPrint(NEW_FILE),
        [WINDOWS_FILE]: await appPrint(WINDOWS_FILE),
        [JSON_FILE]: await print(JSON_FILE, 'json by 1.0.5-rc\n'),
        'config.json': await appPrint('config.json'),
        [OLD_PS1]: await print(OLD_PS1, 'old by 1.0.5-rc\n'),
        [SSH_FILE]: await appPrint(SSH_FILE),
      },
      deleted: [],
      offered: { [JSON_FILE]: await appPrint(JSON_FILE) },
    })
  })

  it('records the fingerprint of the include file as written', async () => {
    // A whole write differs from the app's text only in its #Include commands\ lines, which the fingerprint
    // leaves out, so this always equals the app's fingerprint: the test pins only that an entry is recorded for
    // the bytes written. An adjusted, kept include gets no new entry (decision 6), so there is nothing else to pin.
    const folder = await folderOf({ [MINE_FILE]: 'mine\n' })
    await update(folder)
    const written = folder.text(INCLUDE_FILE) ?? ''
    expect(written).toBe(includeText('; config 1.0.6', WINDOWS, CHROME, NEW, MINE))
    expect((await readManifest(folder))?.files[INCLUDE_FILE]).toBe(await print(INCLUDE_FILE, written))
  })
})

describe('applyUpdate: looking again before writing', () => {
  it.each([
    ['to replace', 'config.json'],
    ['to remove', GONE_FILE],
  ])('leaves a file %s that changed after the plan as it is, keeps it, and offers nothing for it', async (_list, path) => {
    const folder = await folderOf()
    const { guarded, result } = await update(folder, { later: { [path]: 'edited after the plan\n' } })
    expect(result.ok).toBe(true)
    expect(listsHolding(result, path)).toEqual(['kept'])
    expect(changesIn(guarded.calls).filter((call) => call.path === path)).toEqual([])
    expect(folder.text(path)).toBe('edited after the plan\n')
    const manifest = await readManifest(folder)
    expect(manifest?.offered).toEqual({})
    expect(Object.keys(manifest?.files ?? {})).not.toContain(path)
    expect(await listsWhatItHolds(folder)).toBe(true)
  })

  it('leaves a file kept because it changed after the plan for the next check to offer', async () => {
    const folder = await folderOf()
    await update(folder, { later: { 'config.json': 'edited after the plan\n' } })
    expect(await nextPlan(folder)).toMatchObject({ replace: [], add: [], remove: [], changed: ['config.json'], news: true })
  })

  it.each([['config.json'], [INCLUDE_FILE]])('does not write back %s, to replace, gone after the plan, nor name or record it', async (path) => {
    const folder = await folderOf()
    const { guarded, result } = await update(folder, { later: { [path]: null } })
    expect(result.ok).toBe(true)
    expect(listsHolding(result, path)).toEqual([])
    expect(changesIn(guarded.calls).filter((call) => call.path === path)).toEqual([])
    expect(folder.text(path)).toBeNull()
    const manifest = await readManifest(folder)
    expect(Object.keys(manifest?.files ?? {})).not.toContain(path)
    // Neither is a command file, so neither is recorded as deleted.
    expect(manifest?.deleted).toEqual([])
  })

  it.each<{ list: string; include: string; changes: Changes; path: string; deleted: string[] }>([
    { list: 'replace', include: 'written whole', changes: {}, path: WINDOWS_FILE, deleted: [WINDOWS_FILE] },
    { list: 'remove', include: 'written whole', changes: {}, path: GONE_FILE, deleted: [] },
    { list: 'replace', include: 'adjusted', changes: MY_INCLUDE, path: WINDOWS_FILE, deleted: [WINDOWS_FILE] },
    { list: 'remove', include: 'adjusted', changes: MY_INCLUDE, path: GONE_FILE, deleted: [] },
  ])(
    'unlists a command file to $list gone after the plan, under an include file $include, and records one the app has as deleted',
    async ({ changes, path, deleted }) => {
      const folder = await folderOf(changes)
      const { result } = await update(folder, { later: { [path]: null } })
      expect(result.ok).toBe(true)
      expect(listsHolding(result, path)).toEqual([])
      expect(folder.text(path)).toBeNull()
      expect(await listsWhatItHolds(folder)).toBe(true)
      const next = await nextPlan(folder)
      expect(next.deleted).toEqual(deleted)
      expect(next.add).toEqual([])
    },
  )

  it('unlists a command file the listing still named but its read found gone', async () => {
    const folder = new Vanishing('scripts', await textsOf({}, null))
    const plan = await nextPlan(folder)
    folder.gone.add(WINDOWS_FILE)
    const guarded = await guardedOf(folder)
    const result = await applyUpdate(guarded, plan, NO_PICKS, FILES)
    expect(result.ok).toBe(true)
    expect(listsHolding(result, WINDOWS_FILE)).toEqual([])
    expect(folder.text(INCLUDE_FILE)).toBe(includeText('; config 1.0.6', CHROME, NEW))
    expect(guarded.refused).toEqual([])
  })

  const TICK_CHROME: UpdatePicks = { replaceChanged: [], restoreDeleted: [CHROME_FILE] }
  it.each<{ row: string; changes: Changes; picks: UpdatePicks; path: string; text: string; kept: boolean }>([
    { row: 'to add that is there now as another copy', changes: {}, picks: NO_PICKS, path: NEW_FILE, text: 'theirs\n', kept: true },
    { row: "to add that is there now as the app's copy", changes: {}, picks: NO_PICKS, path: NEW_FILE, text: APP[NEW_FILE], kept: false },
    { row: 'deleted and ticked that is there now', changes: { [CHROME_FILE]: null }, picks: TICK_CHROME, path: CHROME_FILE, text: 'theirs\n', kept: true },
  ])('leaves a file $row as it is', async ({ changes, picks, path, text, kept }) => {
    const folder = await folderOf(changes)
    const { guarded, result } = await update(folder, { picks, later: { [path]: text } })
    expect(changesIn(guarded.calls).filter((call) => call.path === path)).toEqual([])
    expect(folder.text(path)).toBe(text)
    expect(listsHolding(result, path)).toEqual(kept ? ['kept'] : [])
    const manifest = await readManifest(folder)
    expect(manifest?.files[path] === (await appPrint(path))).toBe(!kept)
    expect(manifest?.deleted).toEqual([])
  })

  it.each<[string, string | null, string | null]>([
    ['edited again after the plan', 'edited again\n', 'edited again\n'],
    ['gone after the plan', null, null],
  ])('replaces a ticked changed file %s, and keeps what is there now in its backup', async (_case, later, backup) => {
    const folder = await folderOf({ [JSON_FILE]: 'my json\n' })
    const picks: UpdatePicks = { replaceChanged: [JSON_FILE], restoreDeleted: [] }
    const { result } = await update(folder, { picks, later: { [JSON_FILE]: later } })
    expect(folder.text(JSON_FILE)).toBe(APP[JSON_FILE])
    expect(folder.text(backupOf(JSON_FILE))).toBe(backup)
    expect(result.backups).toEqual(backup === null ? [] : [backupOf(JSON_FILE)])
    expect(listsHolding(result, JSON_FILE)).toEqual(['replaced'])
  })
})

interface IncludeRow {
  row: string
  /** The folder 1.0.5 set up, changed so before the plan. */
  changes?: Changes
  picks?: UpdatePicks
  later?: Changes
  /** The include file's text afterwards. */
  text: string
  /** The lists of the result that name it. */
  lists?: string[]
  written?: boolean
}

describe('applyUpdate: the include file', () => {
  const TICK_INCLUDE: UpdatePicks = { replaceChanged: [INCLUDE_FILE], restoreDeleted: [] }
  const TICK_CHROME: UpdatePicks = { replaceChanged: [], restoreDeleted: [CHROME_FILE] }
  /** Up to date, listing what it holds: the chrome command file deleted and its line out. */
  const NO_CHROME: Changes = { ...UP_TO_DATE, [INCLUDE_FILE]: includeText('; config 1.0.6', WINDOWS, NEW), [CHROME_FILE]: null }
  it.each<IncludeRow>([
    { row: 'missing: written whole, added', changes: { [INCLUDE_FILE]: null }, text: APP[INCLUDE_FILE], lists: ['added'] },
    {
      row: "of an earlier body: written whole with the person's own line and without an unticked deleted file's, replaced",
      changes: { [CHROME_FILE]: null, [MINE_FILE]: 'mine\n' },
      text: includeText('; config 1.0.6', WINDOWS, NEW, MINE),
      lists: ['replaced'],
    },
    {
      row: "of an earlier body, the person's own file added after the plan: written whole with its line, replaced",
      later: { [MINE_FILE]: 'mine\n' },
      text: includeText('; config 1.0.6', WINDOWS, CHROME, NEW, MINE),
      lists: ['replaced'],
    },
    { row: 'changed: its list adjusted, kept', changes: MY_INCLUDE, text: includeText('; my config', WINDOWS, CHROME, NEW), lists: ['kept'] },
    { row: 'changed and ticked: written whole, replaced', changes: MY_INCLUDE, picks: TICK_INCLUDE, text: APP[INCLUDE_FILE], lists: ['replaced'] },
    {
      row: 'of an earlier body changed after the plan: its list adjusted, kept',
      later: { [INCLUDE_FILE]: includeText('; edited', WINDOWS, CHROME, GONE) },
      text: includeText('; edited', WINDOWS, CHROME, NEW),
      lists: ['kept'],
    },
    {
      row: "up to date, its list missing the person's own file: its list rebuilt, in no list",
      changes: { ...APP, [MINE_FILE]: 'mine\n' },
      text: includeText('; config 1.0.6', WINDOWS, CHROME, NEW, MINE),
    },
    {
      row: 'up to date, a deleted file ticked back: its line added, in no list',
      changes: NO_CHROME,
      picks: TICK_CHROME,
      text: includeText('; config 1.0.6', WINDOWS, NEW, CHROME),
    },
    {
      row: 'up to date and changed after the plan, a deleted file ticked back: its line added, kept',
      changes: NO_CHROME,
      picks: TICK_CHROME,
      later: { [INCLUDE_FILE]: includeText('; edited', WINDOWS, NEW) },
      text: includeText('; edited', WINDOWS, NEW, CHROME),
      lists: ['kept'],
    },
    {
      row: 'changed, a ticked changed command file gone after the plan written back: its line added, kept',
      changes: { [INCLUDE_FILE]: includeText('; my config', CHROME, GONE), [WINDOWS_FILE]: 'my windows\n' },
      picks: { replaceChanged: [WINDOWS_FILE], restoreDeleted: [] },
      later: { [WINDOWS_FILE]: null },
      text: includeText('; my config', CHROME, NEW, WINDOWS),
      lists: ['kept'],
    },
    {
      row: 'up to date, its list put right by the person after the plan: not written, in no list',
      changes: { ...APP, [MINE_FILE]: 'mine\n' },
      later: { [INCLUDE_FILE]: includeText('; config 1.0.6', WINDOWS, CHROME, NEW, MINE) },
      text: includeText('; config 1.0.6', WINDOWS, CHROME, NEW, MINE),
      written: false,
    },
    {
      row: 'up to date, listing what the folder holds: not written',
      changes: { ...UP_TO_DATE, 'config.json': 'config 1.0.5\n' },
      text: APP[INCLUDE_FILE],
      written: false,
    },
  ])('$row, and lists exactly the AutoHotkey command files present', async (row) => {
    const { changes = {}, picks = NO_PICKS, later = {}, text, lists = [], written = true } = row
    const folder = await folderOf(changes)
    const { guarded, result } = await update(folder, { picks, later })
    expect(result.ok).toBe(true)
    expect(folder.text(INCLUDE_FILE)).toBe(text)
    expect(await listsWhatItHolds(folder)).toBe(true)
    expect(listsHolding(result, INCLUDE_FILE)).toEqual(lists)
    expect(changesIn(guarded.calls).some((call) => call.path === INCLUDE_FILE)).toBe(written)
  })

  it.each([
    ['an earlier release had one', false],
    ['no version ever had one', true],
  ])('is left alone when neither the app nor the folder has one, and %s', async (_case, never) => {
    const { index, known } = await FIXTURE
    const without = <T>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([path]) => path !== INCLUDE_FILE))
    const folder = await folderOf({ [INCLUDE_FILE]: null })
    const { guarded, result } = await update(folder, {
      index: { ...index, files: without(index.files) },
      known: never ? { ...known, files: without(known.files) } : known,
      files: FILES.filter((file) => file.path !== INCLUDE_FILE),
    })
    expect(result.ok).toBe(true)
    expect(folder.text(INCLUDE_FILE)).toBeNull()
    expect(changesIn(guarded.calls).filter((call) => call.path === INCLUDE_FILE)).toEqual([])
  })
})

describe('applyUpdate: backups', () => {
  const TICK_JSON: UpdatePicks = { replaceChanged: [JSON_FILE], restoreDeleted: [] }

  it.each<{ row: string; there: string; backup: string }>([
    { row: 'leaves a plain <path>.bak, which the app\'s own saves write, unread and untouched', there: `${JSON_FILE}.bak`, backup: backupOf(JSON_FILE) },
    { row: 'with <path>.before-update.bak there, takes <path>.before-update.1.bak', there: backupOf(JSON_FILE), backup: backupOf(JSON_FILE, 1) },
  ])('never replaces a file: $row', async ({ there, backup }) => {
    const folder = await folderOf({ [JSON_FILE]: 'my json\n', [there]: 'an earlier backup\n' })
    const { guarded, result } = await update(folder, { picks: TICK_JSON })
    expect(result.backups).toEqual([backup])
    expect(folder.text(there)).toBe('an earlier backup\n')
    expect(folder.text(backup)).toBe('my json\n')
    expect(folder.text(JSON_FILE)).toBe(APP[JSON_FILE])
    expect(guarded.calls.filter((call) => call.path === `${JSON_FILE}.bak`)).toEqual([])
    expect(guarded.refused).toEqual([])
  })

  it('writes nothing when all ten backup names are taken, and says why', async () => {
    const taken = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [backupOf(JSON_FILE, i), `backup ${i}\n`]))
    const folder = await folderOf({ [JSON_FILE]: 'my json\n', ...taken })
    const { guarded, result } = await update(folder, { picks: TICK_JSON })
    expect(result).toEqual({ ok: false, failedAt: JSON_FILE, message: expect.stringContaining('are all in the way'), ...NOTHING_DONE })
    expect(changesIn(guarded.calls)).toEqual([])
    expect(guarded.refused).toEqual([])
  })
})

describe("applyUpdate: the include file is the person's text", () => {
  const BOM = [0xef, 0xbb, 0xbf]
  const withBom = (text: string) => new Uint8Array([...BOM, ...encode(text)])
  /** The text with a last comment line ending in a Latin-1 é, which is not UTF-8. */
  const notUtf8 = (text: string) => new Uint8Array([...encode(`${text}; caf`), 0xe9, ...encode('\n')])

  it('keeps its byte-order mark when its list is adjusted', async () => {
    const folder = await folderOf()
    await folder.writeBytes(INCLUDE_FILE, withBom(includeText('; my config', WINDOWS, CHROME, GONE)))
    const { guarded, result } = await update(folder)
    expect(result.kept).toContain(INCLUDE_FILE)
    expect(await folder.readBytes(INCLUDE_FILE)).toEqual(withBom(includeText('; my config', WINDOWS, CHROME, NEW)))
    expect(guarded.refused).toEqual([])
  })

  it('leaves one that is not UTF-8 byte for byte when its list needs no change', async () => {
    const bytes = notUtf8(includeText('; my config', WINDOWS, CHROME, NEW))
    const folder = await folderOf({ ...UP_TO_DATE, 'config.json': 'config 1.0.5\n' })
    await folder.writeBytes(INCLUDE_FILE, bytes)
    const { guarded, result } = await update(folder)
    expect(result).toEqual({ ok: true, ...NOTHING_DONE, replaced: ['config.json'], kept: [INCLUDE_FILE] })
    expect(await folder.readBytes(INCLUDE_FILE)).toEqual(bytes)
    expect(guarded.refused).toEqual([])
  })

  it('writes nothing when one that is not UTF-8 needs a line, and names it as the folder spells it', async () => {
    const folder = await folderOf({ [INCLUDE_FILE]: null })
    await folder.writeBytes('ahk/Config.ahk', notUtf8(includeText('; my config', WINDOWS, CHROME, GONE)))
    const { guarded, result } = await update(folder)
    expect(result).toEqual({
      ok: false,
      failedAt: 'ahk/Config.ahk',
      message: 'ahk/Config.ahk is not UTF-8 text, so its list of command files cannot be brought up to date.',
      ...NOTHING_DONE,
    })
    expect(changesIn(guarded.calls)).toEqual([])
    expect(guarded.refused).toEqual([])
  })
})

/** The nth write. */
const nthWrite =
  (n: number): NonNullable<GuardedFolder['fails']> =>
  (call, calls) =>
    call.op === 'writeBytes' && calls.filter((c) => c.op === 'writeBytes').length === n

describe('applyUpdate: a failure', () => {
  it.each<{ step: string; fails: NonNullable<GuardedFolder['fails']>; failedAt: string }>([
    { step: 'the third write', fails: nthWrite(3), failedAt: WINDOWS_FILE },
    { step: 'a removal', fails: (call) => call.op === 'remove', failedAt: GONE_FILE },
    { step: 'the manifest', fails: (call) => call.op === 'writeBytes' && call.path === MANIFEST_PATH, failedAt: MANIFEST_PATH },
  ])('at $step stops there with no manifest, and a new plan and update finish the job', async ({ fails, failedAt }) => {
    const folder = await folderOf()
    const { guarded, result } = await update(folder, { fails })
    expect(result).toMatchObject({ ok: false, failedAt, message: 'disk full' })
    expect(guarded.refused).toEqual([])
    expect(folder.text(MANIFEST_PATH)).toBeNull()
    const again = await update(folder)
    expect(again.result.ok).toBe(true)
    expect(Object.fromEntries(Object.keys(APP).map((path) => [path, folder.text(path)]))).toEqual(APP)
    expect(folder.text(GONE_FILE)).toBeNull()
    expect((await readManifest(folder))?.version).toBe('1.0.6')
  })

  it('keeps what was done before the failure, says what that was, and goes no further', async () => {
    const folder = await folderOf()
    const { guarded, result } = await update(folder, { fails: nthWrite(3) })
    expect(result).toEqual({
      ok: false,
      failedAt: WINDOWS_FILE,
      message: 'disk full',
      ...NOTHING_DONE,
      replaced: [CHROME_FILE],
      added: [NEW_FILE],
    })
    expect(changesIn(guarded.calls)).toHaveLength(3)
    expect(folder.text(NEW_FILE)).toBe(APP[NEW_FILE])
    expect(folder.text(WINDOWS_FILE)).toBe(OLD[WINDOWS_FILE])
  })

  it.each<{ row: string; changes?: Changes; files?: StarterFile[]; fails?: GuardedFolder['fails']; failedAt: string; message: unknown }>([
    {
      row: 'a read before the writes fails',
      fails: (call) => call.op === 'readBytes' && call.path === 'config.json',
      failedAt: 'config.json',
      message: 'disk full',
    },
    {
      row: 'listing a folder under ahk/commands fails',
      fails: (call) => call.op === 'list' && call.path === 'ahk/commands/custom',
      failedAt: 'ahk/commands/custom',
      message: 'disk full',
    },
    {
      row: 'listing the folder itself fails',
      fails: (call) => call.op === 'list' && call.path === '',
      failedAt: 'scripts',
      message: 'disk full',
    },
    {
      row: "the app's copy lacks a file the plan would write",
      files: FILES.filter((file) => file.path !== 'config.json'),
      failedAt: 'config.json',
      message: "The app's copy has no config.json.",
    },
    {
      row: 'the include file has no section to list a new command file in',
      changes: { [INCLUDE_FILE]: lines('; my config', WINDOWS, CHROME, GONE) },
      failedAt: INCLUDE_FILE,
      message: expect.stringContaining('no Custom Commands section'),
    },
  ])('writes nothing when $row, and says where', async ({ changes = {}, files = FILES, fails = null, failedAt, message }) => {
    const { guarded, result } = await update(await folderOf(changes), { files, fails })
    expect(result).toEqual({ ok: false, failedAt, message, ...NOTHING_DONE })
    expect(changesIn(guarded.calls)).toEqual([])
    expect(guarded.refused).toEqual([])
  })

  it.each<[string, unknown, string]>([
    ['a text: that text', 'no space left', 'no space left'],
    ['anything else: that it is unknown', 42, 'An unknown error.'],
  ])('gives as the message of a rejection that is %s', async (_kind, failure, message) => {
    const { result } = await update(await folderOf(), { fails: nthWrite(3), failure })
    expect(result).toMatchObject({ ok: false, failedAt: WINDOWS_FILE, message })
  })
})

describe('applyUpdate: a plan that is skipped', () => {
  it.each<[string, Changes, ManifestTexts | null]>([
    ['a .git entry in its root', { '.git/HEAD': 'ref: refs/heads/main\n' }, null],
    ['a manifest newer than the app', {}, { version: '1.0.9' }],
  ])('touches nothing in a folder with %s, and says it did nothing', async (_why, changes, manifest) => {
    const { plan, guarded, result } = await update(await folderOf(changes, manifest), { picks: EVERY_PICKS })
    expect(plan.skip).not.toBeNull()
    expect(result).toEqual({ ok: true, ...NOTHING_DONE })
    expect(guarded.calls).toEqual([])
  })
})

describe('applyUpdate: how the folder spells a path', () => {
  it("writes a file the folder has at the folder's spelling, and records it so", async () => {
    const folder = await folderOf({ [WINDOWS_FILE]: null, 'ahk/commands/Windows.ahk': OLD[WINDOWS_FILE] })
    const { result } = await update(folder)
    expect(result.replaced).toContain('ahk/commands/Windows.ahk')
    expect(folder.text('ahk/commands/Windows.ahk')).toBe(APP[WINDOWS_FILE])
    expect(folder.text(WINDOWS_FILE)).toBeNull()
    const files = Object.keys((await readManifest(folder))?.files ?? {})
    expect(files).toContain('ahk/commands/Windows.ahk')
    expect(files).not.toContain(WINDOWS_FILE)
  })
})
