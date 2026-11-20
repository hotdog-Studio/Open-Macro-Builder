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

const CHROME_FILE = 'ahk/commands/custom/chrome.ahk'
const NEW_FILE = 'ahk/commands/custom/new.ahk'
const GONE_FILE = 'ahk/commands/gone.ahk'
const SSH_FILE = 'powershell/commands/custom/ssh.ps1'

/** The app's copy (1.0.6), as texts. */
const APP: Texts = {
  'config.json': 'config 1.0.6\n',
  [INCLUDE_FILE]: includeText('; config 1.0.6', WINDOWS, CHROME, NEW),
  'ahk/lib/json.ahk': 'json 1.0.6\n',
  'ahk/commands/windows.ahk': 'windows 1.0.6\n',
  [CHROME_FILE]: 'chrome 1.0.6\n',
  /** New in 1.0.6: no release shipped it. */
  [NEW_FILE]: 'new 1.0.6\n',
  [SSH_FILE]: 'ssh 1.0.6\n',
}

/** What 1.0.5, a release before the record, shipped: a folder it set up holds these. */
const OLD: Texts = {
  'config.json': 'config 1.0.5\n',
  [INCLUDE_FILE]: includeText('; config 1.0.5', WINDOWS, CHROME, GONE),
  'ahk/lib/json.ahk': 'json 1.0.5\n',
  'ahk/commands/windows.ahk': 'windows 1.0.5\n',
  [CHROME_FILE]: 'chrome 1.0.5\n',
  /** Gone in 1.0.6, like the next one. */
  [GONE_FILE]: 'gone 1.0.5\n',
  [SSH_FILE]: 'ssh 1.0.5\n',
  'powershell/commands/old.ps1': 'old 1.0.5\n',
}

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

/** A folder that refuses a read of a path no version ever had, and every call under local/. */
async function guardedOf(folder: FolderAccess): Promise<GuardedFolder> {
  const { index, known } = await FIXTURE
  const app = new Set(Object.keys(index.files).map((path) => path.toLowerCase()))
  return new GuardedFolder(folder, (path) => path === MANIFEST_PATH || app.has(path.toLowerCase()) || everShipped(known, path))
}

const NO_PICKS: UpdatePicks = { replaceChanged: [], restoreDeleted: [] }
const NOTHING_DONE: UpdateDone = { replaced: [], added: [], removed: [], kept: [], backups: [] }

interface Run {
  plan: UpdatePlan
  guarded: GuardedFolder
  result: UpdateResult
}

/** Plans the update of `folder`, makes the `later` changes, then carries the plan out through a GuardedFolder. */
async function update(folder: FolderAccess, picks = NO_PICKS, later: Changes = {}, files = FILES): Promise<Run> {
  const { index, known } = await FIXTURE
  const plan = await planUpdate(folder, index, known)
  await change(folder, later)
  const guarded = await guardedOf(folder)
  return { plan, guarded, result: await applyUpdate(guarded, plan, picks, files) }
}

/** The calls that change the folder. */
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
  'ahk/lib/json.ahk': 'my json\n',
  'ahk/commands/windows.ahk': 'my windows\n',
  [CHROME_FILE]: null,
  'ahk/commands/custom/mine.ahk': 'mine\n',
  [SSH_FILE]: null,
  'powershell/commands/old.ps1': 'my old\n',
  'local/configurator.json': '{}\n',
  'local/ahk/commands.ahk': 'x\n',
}
const EVERY_PICKS: UpdatePicks = { replaceChanged: ['ahk/commands/windows.ahk'], restoreDeleted: [SSH_FILE] }
const EVERY_DONE: UpdateDone = {
  replaced: ['config.json', 'ahk/commands/windows.ahk', INCLUDE_FILE],
  added: [NEW_FILE, SSH_FILE],
  removed: [GONE_FILE],
  kept: ['ahk/lib/json.ahk', 'powershell/commands/old.ps1'],
  backups: ['ahk/commands/windows.ahk.bak'],
}

describe('applyUpdate: a plan with every kind of entry', () => {
  it('reads first, then writes the .bak copies, the files, ahk/config.ahk, the removals, and the manifest last', async () => {
    const { plan, guarded } = await update(await folderOf(EVERY), EVERY_PICKS)
    expect(plan.list).toBe('replace')
    const reads = guarded.calls.filter((call) => call.op === 'readBytes')
    expect(guarded.calls.slice(0, reads.length)).toEqual(reads)
    expect(guarded.calls.slice(reads.length)).toEqual([
      { op: 'writeBytes', path: 'ahk/commands/windows.ahk.bak' },
      { op: 'writeBytes', path: NEW_FILE },
      { op: 'writeBytes', path: 'config.json' },
      { op: 'writeBytes', path: 'ahk/commands/windows.ahk' },
      { op: 'writeBytes', path: SSH_FILE },
      { op: 'writeBytes', path: INCLUDE_FILE },
      { op: 'remove', path: GONE_FILE },
      { op: 'writeBytes', path: MANIFEST_PATH },
    ])
  })

  it('says what it replaced, added, removed, kept and backed up', async () => {
    const { result } = await update(await folderOf(EVERY), EVERY_PICKS)
    expect(result).toEqual({ ok: true, ...EVERY_DONE })
  })

  it("keeps the person's bytes of a ticked changed file in its .bak, and writes the app's copy at its path", async () => {
    const folder = await folderOf(EVERY)
    await update(folder, EVERY_PICKS)
    expect(folder.text('ahk/commands/windows.ahk.bak')).toBe('my windows\n')
    expect(folder.text('ahk/commands/windows.ahk')).toBe(APP['ahk/commands/windows.ahk'])
    expect(folder.text('ahk/lib/json.ahk')).toBe('my json\n')
    expect(folder.text('ahk/lib/json.ahk.bak')).toBeNull()
  })

  it('brings a ticked deleted file back and takes it out of deleted; an unticked one stays deleted and stays in it', async () => {
    const folder = await folderOf(EVERY)
    await update(folder, EVERY_PICKS)
    expect(folder.text(SSH_FILE)).toBe(APP[SSH_FILE])
    expect(folder.text(CHROME_FILE)).toBeNull()
    expect((await readManifest(folder))?.deleted).toEqual([CHROME_FILE])
  })

  it('gives a folder without a manifest one, naming the deleted command files that were not ticked', async () => {
    const folder = await folderOf(EVERY)
    const { plan } = await update(folder, EVERY_PICKS)
    expect(plan.manifest).toBeNull()
    expect(await readManifest(folder)).toEqual({
      version: '1.0.6',
      files: {
        [INCLUDE_FILE]: await appPrint(INCLUDE_FILE),
        [NEW_FILE]: await appPrint(NEW_FILE),
        'ahk/commands/windows.ahk': await appPrint('ahk/commands/windows.ahk'),
        'config.json': await appPrint('config.json'),
        [SSH_FILE]: await appPrint(SSH_FILE),
      },
      deleted: [CHROME_FILE],
      offered: { 'ahk/lib/json.ahk': await appPrint('ahk/lib/json.ahk') },
    })
  })

  it('lists exactly the AutoHotkey command files the folder holds afterwards', async () => {
    const folder = await folderOf(EVERY)
    await update(folder, EVERY_PICKS)
    expect(folder.text(INCLUDE_FILE)).toBe(includeText('; config 1.0.6', WINDOWS, NEW, MINE))
    expect(listsExactly(folder.text(INCLUDE_FILE) ?? '', await ahkCommandFilesIn(folder))).toBe(true)
  })

  it('reads, writes and removes nothing under local/', async () => {
    const folder = await folderOf(EVERY)
    const { guarded } = await update(folder, EVERY_PICKS)
    expect(guarded.refused).toEqual([])
    expect(guarded.calls.filter((call) => call.path.toLowerCase().startsWith('local'))).toEqual([])
    expect(folder.text('local/configurator.json')).toBe('{}\n')
    expect(folder.text('local/ahk/commands.ahk')).toBe('x\n')
  })

  it('takes a pick in any case, and ignores one that names no changed or deleted path', async () => {
    const picks: UpdatePicks = {
      replaceChanged: ['AHK/Commands/Windows.AHK', 'config.json', 'powershell/commands/old.ps1'],
      restoreDeleted: ['Powershell/Commands/Custom/SSH.ps1', 'ahk/lib/json.ahk'],
    }
    const folder = await folderOf(EVERY)
    const { result } = await update(folder, picks)
    expect(result).toEqual({ ok: true, ...EVERY_DONE })
    expect(folder.text('ahk/lib/json.ahk')).toBe('my json\n')
    expect(folder.text('powershell/commands/old.ps1')).toBe('my old\n')
    expect(folder.text('config.json.bak')).toBeNull()
  })
})

describe('applyUpdate: the manifest', () => {
  it("holds the app's fingerprint for each path as the app has it, the old entry and an offer for a kept changed file", async () => {
    const folder = await folderOf(
      { 'ahk/lib/json.ahk': 'my json\n', [CHROME_FILE]: APP[CHROME_FILE], 'powershell/commands/old.ps1': 'my old\n' },
      {
        version: '1.0.5',
        files: { 'ahk/lib/json.ahk': 'json by 1.0.5-rc\n', [GONE_FILE]: OLD[GONE_FILE], 'powershell/commands/old.ps1': 'old by 1.0.5-rc\n' },
        // Brought back by hand since: the entry goes, as the folder holds the file.
        deleted: [CHROME_FILE],
      },
    )
    const { plan, result } = await update(folder)
    expect(plan.changed).toEqual(['ahk/lib/json.ahk'])
    expect(plan.keptRemoved).toEqual(['powershell/commands/old.ps1'])
    expect(result.ok).toBe(true)
    expect(await readManifest(folder)).toEqual({
      version: '1.0.6',
      files: {
        [INCLUDE_FILE]: await appPrint(INCLUDE_FILE),
        [CHROME_FILE]: await appPrint(CHROME_FILE),
        [NEW_FILE]: await appPrint(NEW_FILE),
        'ahk/commands/windows.ahk': await appPrint('ahk/commands/windows.ahk'),
        'ahk/lib/json.ahk': await print('ahk/lib/json.ahk', 'json by 1.0.5-rc\n'),
        'config.json': await appPrint('config.json'),
        'powershell/commands/old.ps1': await print('powershell/commands/old.ps1', 'old by 1.0.5-rc\n'),
        [SSH_FILE]: await appPrint(SSH_FILE),
      },
      deleted: [],
      offered: { 'ahk/lib/json.ahk': await appPrint('ahk/lib/json.ahk') },
    })
  })
})

describe('applyUpdate: looking again before writing', () => {
  it.each([
    ['to replace', 'config.json'],
    ['to remove', GONE_FILE],
  ])('leaves a file %s that changed after the plan as it is, keeps it, and offers nothing for it', async (_list, path) => {
    const folder = await folderOf()
    const { guarded, result } = await update(folder, NO_PICKS, { [path]: 'edited after the plan\n' })
    expect(result.ok).toBe(true)
    expect(listsHolding(result, path)).toEqual(['kept'])
    expect(changesIn(guarded.calls).filter((call) => call.path === path)).toEqual([])
    expect(folder.text(path)).toBe('edited after the plan\n')
    const manifest = await readManifest(folder)
    expect(manifest?.offered).toEqual({})
    expect(Object.keys(manifest?.files ?? {})).not.toContain(path)
    expect(listsExactly(folder.text(INCLUDE_FILE) ?? '', await ahkCommandFilesIn(folder))).toBe(true)
  })

  it.each([['config.json'], [INCLUDE_FILE]])('does not write back %s, to replace, gone after the plan: kept, not recorded', async (path) => {
    const folder = await folderOf()
    const { guarded, result } = await update(folder, NO_PICKS, { [path]: null })
    expect(result.ok).toBe(true)
    expect(listsHolding(result, path)).toEqual(['kept'])
    expect(changesIn(guarded.calls).filter((call) => call.path === path)).toEqual([])
    expect(folder.text(path)).toBeNull()
    expect(Object.keys((await readManifest(folder))?.files ?? {})).not.toContain(path)
  })

  const TICK_CHROME: UpdatePicks ={ replaceChanged: [], restoreDeleted: [CHROME_FILE] }
  it.each<[string, Changes, UpdatePicks, string, string, boolean]>([
    ['to add that is there now as another copy', {}, NO_PICKS, NEW_FILE, 'theirs\n', true],
    ["to add that is there now as the app's copy", {}, NO_PICKS, NEW_FILE, APP[NEW_FILE], false],
    ['deleted and ticked that is there now', { [CHROME_FILE]: null }, TICK_CHROME, CHROME_FILE, 'theirs\n', true],
  ])('leaves a file %s as it is', async (_case, changes, picks, path, text, kept) => {
    const folder = await folderOf(changes)
    const { guarded, result } = await update(folder, picks, { [path]: text })
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
  ])('replaces a ticked changed file %s, and keeps what is there now in its .bak', async (_case, later, backup) => {
    const folder = await folderOf({ 'ahk/lib/json.ahk': 'my json\n' })
    const picks: UpdatePicks = { replaceChanged: ['ahk/lib/json.ahk'], restoreDeleted: [] }
    const { result } = await update(folder, picks, { 'ahk/lib/json.ahk': later })
    expect(folder.text('ahk/lib/json.ahk')).toBe(APP['ahk/lib/json.ahk'])
    expect(folder.text('ahk/lib/json.ahk.bak')).toBe(backup)
    expect(result.backups).toEqual(backup === null ? [] : ['ahk/lib/json.ahk.bak'])
    expect(listsHolding(result, 'ahk/lib/json.ahk')).toEqual(['replaced'])
  })
})

describe('applyUpdate: the include file', () => {
  const TICK_INCLUDE: UpdatePicks = { replaceChanged: [INCLUDE_FILE], restoreDeleted: [] }
  const MY_INCLUDE = { [INCLUDE_FILE]: includeText('; my config', WINDOWS, CHROME, GONE) }
  const UP_TO_DATE = { ...APP, [GONE_FILE]: null, 'powershell/commands/old.ps1': null }
  it.each<[string, Changes, UpdatePicks, Changes, string, string[], boolean]>([
    ['missing: written whole, added', { [INCLUDE_FILE]: null }, NO_PICKS, {}, APP[INCLUDE_FILE], ['added'], true],
    [
      "of an earlier body: written whole with the person's own line and without an unticked deleted file's, replaced",
      { [CHROME_FILE]: null, 'ahk/commands/custom/mine.ahk': 'mine\n' },
      NO_PICKS,
      {},
      includeText('; config 1.0.6', WINDOWS, NEW, MINE),
      ['replaced'],
      true,
    ],
    ['changed: its list adjusted, kept', MY_INCLUDE, NO_PICKS, {}, includeText('; my config', WINDOWS, CHROME, NEW), ['kept'], true],
    ['changed and ticked: written whole, replaced', MY_INCLUDE, TICK_INCLUDE, {}, APP[INCLUDE_FILE], ['replaced'], true],
    [
      'of an earlier body changed after the plan: its list adjusted, kept',
      {},
      NO_PICKS,
      { [INCLUDE_FILE]: includeText('; edited', WINDOWS, CHROME, GONE) },
      includeText('; edited', WINDOWS, CHROME, NEW),
      ['kept'],
      true,
    ],
    [
      "up to date, its list missing the person's own file: its list rebuilt, in no list",
      { ...APP, 'ahk/commands/custom/mine.ahk': 'mine\n' },
      NO_PICKS,
      {},
      includeText('; config 1.0.6', WINDOWS, CHROME, NEW, MINE),
      [],
      true,
    ],
    [
      'up to date, a deleted file ticked back: its line added, in no list',
      { ...UP_TO_DATE, [INCLUDE_FILE]: includeText('; config 1.0.6', WINDOWS, NEW), [CHROME_FILE]: null },
      { replaceChanged: [], restoreDeleted: [CHROME_FILE] },
      {},
      includeText('; config 1.0.6', WINDOWS, NEW, CHROME),
      [],
      true,
    ],
    [
      'up to date, listing what the folder holds: not written',
      { ...UP_TO_DATE, 'config.json': 'config 1.0.5\n' },
      NO_PICKS,
      {},
      APP[INCLUDE_FILE],
      [],
      false,
    ],
  ])('%s, and lists exactly the AutoHotkey command files present', async (_row, changes, picks, later, text, lists, written) => {
    const folder = await folderOf(changes)
    const { guarded, result } = await update(folder, picks, later)
    expect(result.ok).toBe(true)
    expect(folder.text(INCLUDE_FILE)).toBe(text)
    expect(listsExactly(text, await ahkCommandFilesIn(folder))).toBe(true)
    expect(listsHolding(result, INCLUDE_FILE)).toEqual(lists)
    expect(changesIn(guarded.calls).some((call) => call.path === INCLUDE_FILE)).toBe(written)
  })
})

/** A MemoryFolder whose calls that `fails` picks reject, as a full disk's would; with null, none does. */
class Failing extends MemoryFolder {
  readonly calls: FolderCall[] = []
  fails: ((call: FolderCall, writes: number) => boolean) | null = null
  /** What a failing call rejects with. */
  reason: unknown = new Error('disk full')

  override readBytes(path: string): Promise<Uint8Array | null> {
    return this.run({ op: 'readBytes', path }, () => super.readBytes(path))
  }

  override writeBytes(path: string, data: Uint8Array): Promise<void> {
    return this.run({ op: 'writeBytes', path }, () => super.writeBytes(path, data))
  }

  override remove(path: string): Promise<void> {
    return this.run({ op: 'remove', path }, () => super.remove(path))
  }

  private run<T>(call: FolderCall, then: () => Promise<T>): Promise<T> {
    this.calls.push(call)
    const writes = this.calls.filter((c) => c.op === 'writeBytes').length
    return this.fails?.(call, writes) ? Promise.reject(this.reason) : then()
  }
}

type Fails = Failing['fails']

/** Plans the update of a folder 1.0.5 set up, with `changes`, and carries it out with `fails` failing. */
async function failingRun(fails: Fails, changes: Changes = {}, files = FILES, reason: unknown = new Error('disk full')) {
  const { index, known } = await FIXTURE
  const folder = new Failing('scripts', await textsOf(changes, null))
  const plan = await planUpdate(folder, index, known)
  folder.calls.length = 0
  folder.fails = fails
  folder.reason = reason
  return { folder, result: await applyUpdate(folder, plan, NO_PICKS, files) }
}

const thirdWrite: Fails = (call, writes) => call.op === 'writeBytes' && writes === 3

describe('applyUpdate: a failure', () => {
  it.each<[string, Fails, string]>([
    ['the third write', thirdWrite, 'ahk/commands/windows.ahk'],
    ['a removal', (call) => call.op === 'remove', GONE_FILE],
    ['the manifest', (call) => call.op === 'writeBytes' && call.path === MANIFEST_PATH, MANIFEST_PATH],
  ])('at %s stops there with no manifest, and a new plan and update finish the job', async (_step, fails, failedAt) => {
    const { folder, result } = await failingRun(fails)
    expect(result).toMatchObject({ ok: false, failedAt, message: 'disk full' })
    expect(folder.text(MANIFEST_PATH)).toBeNull()
    folder.fails = null
    const { index, known } = await FIXTURE
    const again = await applyUpdate(folder, await planUpdate(folder, index, known), NO_PICKS, FILES)
    expect(again.ok).toBe(true)
    expect(Object.fromEntries(Object.keys(APP).map((path) => [path, folder.text(path)]))).toEqual(APP)
    expect(folder.text(GONE_FILE)).toBeNull()
    expect((await readManifest(folder))?.version).toBe('1.0.6')
  })

  it('keeps what was done before the failure, says what that was, and goes no further', async () => {
    const { folder, result } = await failingRun(thirdWrite)
    expect(result).toEqual({
      ok: false,
      failedAt: 'ahk/commands/windows.ahk',
      message: 'disk full',
      ...NOTHING_DONE,
      replaced: [CHROME_FILE],
      added: [NEW_FILE],
    })
    expect(changesIn(folder.calls)).toHaveLength(3)
    expect(folder.text(NEW_FILE)).toBe(APP[NEW_FILE])
    expect(folder.text('ahk/commands/windows.ahk')).toBe(OLD['ahk/commands/windows.ahk'])
  })

  it.each<[string, Fails, Changes, StarterFile[], string, unknown]>([
    ['a read before the writes fails', (call) => call.op === 'readBytes' && call.path === 'config.json', {}, FILES, 'config.json', 'disk full'],
    [
      "the app's copy lacks a file the plan would write",
      null,
      {},
      FILES.filter((file) => file.path !== 'config.json'),
      'config.json',
      "The app's copy has no config.json.",
    ],
    [
      'the include file has no section to list a new command file in',
      null,
      { [INCLUDE_FILE]: lines('; my config', WINDOWS, CHROME, GONE) },
      FILES,
      INCLUDE_FILE,
      expect.stringContaining('no Custom Commands section'),
    ],
  ])('writes nothing when %s, and says where', async (_case, fails, changes, files, failedAt, message) => {
    const { folder, result } = await failingRun(fails, changes, files)
    expect(result).toEqual({ ok: false, failedAt, message, ...NOTHING_DONE })
    expect(changesIn(folder.calls)).toEqual([])
  })

  it.each<[string, unknown, string]>([
    ['a text: that text', 'no space left', 'no space left'],
    ['anything else: that it is unknown', 42, 'An unknown error.'],
  ])('gives as the message of a rejection that is %s', async (_kind, reason, message) => {
    const { result } = await failingRun(thirdWrite, {}, FILES, reason)
    expect(result).toMatchObject({ ok: false, failedAt: 'ahk/commands/windows.ahk', message })
  })
})

describe('applyUpdate: a plan that is skipped', () => {
  it.each<[string, Changes, ManifestTexts | null]>([
    ['a .git entry in its root', { '.git/HEAD': 'ref: refs/heads/main\n' }, null],
    ['a manifest newer than the app', {}, { version: '1.0.9' }],
  ])('touches nothing in a folder with %s, and says it did nothing', async (_why, changes, manifest) => {
    const { plan, guarded, result } = await update(await folderOf(changes, manifest), EVERY_PICKS)
    expect(plan.skip).not.toBeNull()
    expect(result).toEqual({ ok: true, ...NOTHING_DONE })
    expect(guarded.calls).toEqual([])
  })
})

describe('applyUpdate: how the folder spells a path', () => {
  it("writes a file the folder has at the folder's spelling, and records it so", async () => {
    const folder = await folderOf({ 'ahk/commands/windows.ahk': null, 'ahk/commands/Windows.ahk': OLD['ahk/commands/windows.ahk'] })
    const { result } = await update(folder)
    expect(result.replaced).toContain('ahk/commands/Windows.ahk')
    expect(folder.text('ahk/commands/Windows.ahk')).toBe(APP['ahk/commands/windows.ahk'])
    expect(folder.text('ahk/commands/windows.ahk')).toBeNull()
    const files = Object.keys((await readManifest(folder))?.files ?? {})
    expect(files).toContain('ahk/commands/Windows.ahk')
    expect(files).not.toContain('ahk/commands/windows.ahk')
  })
})
