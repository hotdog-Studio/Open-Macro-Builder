import { describe, expect, it, vi } from 'vitest'
import { renameKey } from '../core/config/ops'
import { ConflictError } from '../core/folder/textFile'
import { MemoryFolder } from '../core/folder/memory'
import type { DirEntry, FolderAccess } from '../core/folder/types'
import { SETTINGS_PATH } from '../core/settings'
import type { LangId } from '../core/languages'
import type { Platform } from '../platform/types'
import { writeConfig } from '../core/config/write'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { createActions } from './actions'
import { initialState, reducer, type Action, type AppState, type EditState, type StoredState } from './store'

// These tests drive the actions with the real reducer and no screen, so a failure in the folder
// (a file that throws, one that vanishes, one that changes midway) can be staged exactly.

const CONFIG = 'local/config.json'
const MINE = 'local/ahk/mine.ahk'
const HUB = 'local/ahk/commands.ahk'
const enc = new TextEncoder()
const EXAMPLE = readRepoText('config.json')

/** A folder whose reads, writes, listings and removals a test can slow down, change or make fail. */
class Flaky implements FolderAccess {
  /** Runs first; may throw, wait, or change the folder. Resolves to bytes to answer with instead. */
  onRead: (path: string) => Promise<Uint8Array | null | void> | Uint8Array | null | void = () => {}
  onWrite: (path: string) => Promise<void> | void = () => {}
  onRemove: (path: string) => Promise<void> | void = () => {}
  onList: (dir: string) => Promise<void> | void = () => {}
  /** Every path written, in order. */
  readonly writes: string[] = []

  constructor(readonly inner: MemoryFolder) {}

  get name() {
    return this.inner.name
  }
  async readBytes(path: string) {
    const answer = await this.onRead(path)
    return answer === undefined ? this.inner.readBytes(path) : answer
  }
  async writeBytes(path: string, data: Uint8Array) {
    await this.onWrite(path)
    this.writes.push(path)
    return this.inner.writeBytes(path, data)
  }
  async list(dir: string): Promise<DirEntry[]> {
    await this.onList(dir)
    return this.inner.list(dir)
  }
  async remove(path: string) {
    await this.onRemove(path)
    return this.inner.remove(path)
  }
  text(path: string) {
    return this.inner.text(path)
  }
}

/** A promise a test settles by hand, to hold one step of an action until the test says go. */
function gate<T = void>() {
  let open!: (value: T) => void
  let fail!: (reason: unknown) => void
  const wait = new Promise<T>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { wait, open, fail }
}

interface Setup {
  /** Extra files, as text. */
  files?: Record<string, string>
  /** Leave local/config.json out, so opening asks which config to edit. */
  noPersonalConfig?: boolean
  /** Leave the settings file out. */
  noSettings?: boolean
  languages?: LangId[]
}

function repoFolder({ files = {}, noPersonalConfig, noSettings, languages = ['ahk'] }: Setup = {}): Flaky {
  const inner = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/config.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  const folder = new Flaky(inner)
  const put = (path: string, text: string) => inner.writeBytes(path, enc.encode(text))
  if (!noPersonalConfig) void put(CONFIG, EXAMPLE)
  if (!noSettings) void put(SETTINGS_PATH, JSON.stringify({ languages }) + '\n')
  for (const [path, text] of Object.entries(files)) void put(path, text)
  return folder
}

/** The actions on top of the real reducer. */
function harness(platform: Partial<Platform> = {}) {
  let stored: StoredState = initialState
  const view = (): AppState =>
    stored.screen === 'edit' ? { ...stored, dirty: writeConfig(stored.ws) !== writeConfig(stored.saved) } : stored
  const made = createActions({ kind: 'browser', openFolder: async () => null, restoreFolder: async () => null, ...platform }, (a) => {
    stored = reducer(stored, a)
    made.sync(view())
  })
  made.sync(view())
  const edit = (): EditState => {
    const s = view()
    if (s.screen !== 'edit') throw new Error(`expected the editor, got the ${s.screen} screen`)
    return s
  }
  const send = (a: Action) => {
    stored = reducer(stored, a)
    made.sync(view())
  }
  return { ...made, state: view, edit, send }
}

/** An editor on the folder, with its config renamed so that it has unsaved edits when `dirty`. */
async function opened(setup: Setup = {}, platform: Partial<Platform> = {}, dirty = false) {
  const folder = repoFolder(setup)
  const h = harness(platform)
  await h.actions.load(folder)
  h.edit()
  if (dirty) h.send({ type: 'edit', ws: renameKey(h.edit().ws, 'k1', 'F1') })
  return { ...h, folder }
}

const MINE_TEXT = 'Mine(Macro)\n{\n}\n'
const withMine = { files: { [MINE]: MINE_TEXT } }

/** The version of a held command file, for starting a draft on it. */
const versionOf = (h: { edit(): EditState }, path: string) => h.edit().commandFiles.find((f) => f.file.path === path)!.file.version

describe('restoring the remembered folder', () => {
  it('says why the folder could not be restored', async () => {
    const h = harness({
      restoreFolder: async () => {
        throw new Error('IndexedDB is blocked')
      },
    })
    await h.actions.restore()
    expect(h.state()).toEqual({ screen: 'open', message: 'The folder could not be opened: IndexedDB is blocked', reopen: null })
  })

  it('says why when the failure is not an Error', async () => {
    const h = harness({ restoreFolder: () => Promise.reject('storage is full') })
    await h.actions.restore()
    expect(h.state()).toMatchObject({ screen: 'open', message: 'The folder could not be opened: storage is full' })
  })

  it('shows the message when the remembered folder is gone', async () => {
    const lost = 'The folder repo is no longer available. Open it again.'
    const h = harness({ restoreFolder: async () => ({ lost }) })
    await h.actions.restore()
    expect(h.state()).toEqual({ screen: 'open', message: lost, reopen: null })
  })

  it('asks for a click when the folder needs permission again', async () => {
    const h = harness({ restoreFolder: async () => ({ needsPermission: 'repo' }) })
    await h.actions.restore()
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: 'repo' })
  })

  it('drops a restore that finished after the user opened a folder', async () => {
    const slow = gate<{ lost: string }>()
    const h = harness({ restoreFolder: () => slow.wait })
    const restoring = h.actions.restore()
    await h.actions.load(repoFolder())
    slow.open({ lost: 'The folder old is no longer available. Open it again.' })
    await restoring
    expect(h.edit().folder.name).toBe('repo')
  })

  it('drops a restore failure that came after the user opened a folder', async () => {
    const slow = gate<never>()
    const h = harness({ restoreFolder: () => slow.wait })
    const restoring = h.actions.restore()
    await h.actions.load(repoFolder())
    slow.fail(new Error('too late'))
    await restoring
    expect(h.edit().banner).toBeNull()
  })
})

describe('opening a folder from the header', () => {
  it('keeps the open folder and its edits and says why the picker failed', async () => {
    const h = await opened({}, {
      openFolder: async () => {
        throw new Error('The picker is busy.')
      },
    }, true)
    const ws = h.edit().ws
    await h.actions.openFolder()
    expect(h.edit().banner).toEqual({ text: 'The folder could not be opened: The picker is busy.', kind: 'error' })
    expect(h.edit().ws).toBe(ws)
    expect(h.edit().dirty).toBe(true)
  })

  it('shows the message on the open screen when no folder is open', async () => {
    const h = harness({ openFolder: () => Promise.reject(new Error('The picker is busy.')) })
    await h.actions.openFolder()
    expect(h.state()).toMatchObject({ screen: 'open', message: 'The folder could not be opened: The picker is busy.' })
  })
})

describe('asking for permission again', () => {
  const remembered = (grant?: Platform['grantPermission']) =>
    harness({ restoreFolder: async () => ({ needsPermission: 'repo' }), grantPermission: grant })

  it('does nothing on a platform that cannot ask', async () => {
    const h = remembered()
    await h.actions.restore()
    await h.actions.reopen()
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: 'repo' })
  })

  it('says why when asking failed', async () => {
    const h = remembered(async () => {
      throw new Error('Not allowed')
    })
    await h.actions.restore()
    await h.actions.reopen()
    expect(h.state()).toEqual({ screen: 'open', message: 'The folder could not be opened: Not allowed', reopen: null })
  })

  it('says so when the folder was lost meanwhile', async () => {
    const lost = 'The folder repo is no longer available. Open it again.'
    const h = remembered(async () => ({ lost }))
    await h.actions.restore()
    await h.actions.reopen()
    expect(h.state()).toEqual({ screen: 'open', message: lost, reopen: null })
  })

  it('keeps asking when the user declined', async () => {
    const h = remembered(async () => null)
    await h.actions.restore()
    await h.actions.reopen()
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: 'repo' })
  })

  it('drops an answer that came after the user opened another folder', async () => {
    const slow = gate<{ lost: string }>()
    const h = remembered(() => slow.wait)
    await h.actions.restore()
    const asking = h.actions.reopen()
    await h.actions.load(repoFolder())
    slow.open({ lost: 'The folder old is no longer available. Open it again.' })
    await asking
    expect(h.state().screen).toBe('edit')
  })
})

describe('choosing the config to edit', () => {
  it('says so when the copy cannot be read back', async () => {
    const folder = repoFolder({ noPersonalConfig: true })
    const h = harness()
    await h.actions.load(folder)
    expect(h.state().screen).toBe('pick-config')
    // The copy is written, but then reads as missing (a file that vanished at once).
    folder.onRead = (path) => (path === CONFIG ? null : undefined)
    await h.actions.chooseConfig('copy')
    expect(h.state()).toMatchObject({ screen: 'open', message: 'local/config.json is missing.' })
  })

  it('copies the example once when the answer is given twice', async () => {
    const folder = repoFolder({ noPersonalConfig: true })
    const h = harness()
    await h.actions.load(folder)
    await Promise.all([h.actions.chooseConfig('copy'), h.actions.chooseConfig('copy')])
    expect(h.edit().configFile.path).toBe(CONFIG)
    expect(folder.writes.filter((p) => p === CONFIG)).toHaveLength(1)
  })

  it('ignores an answer when no question is open', async () => {
    const h = await opened()
    const before = h.state()
    await h.actions.chooseConfig('copy')
    await h.actions.chooseLanguage('ps')
    expect(h.state()).toEqual(before)
  })

  it('drops an answer that a newer open overtook', async () => {
    const slow = repoFolder({ noPersonalConfig: true })
    const h = harness()
    await h.actions.load(slow)
    const hold = gate()
    slow.onRead = async (path) => {
      if (path === 'config.json') await hold.wait
    }
    const choosing = h.actions.chooseConfig('example')
    await h.actions.load(repoFolder())
    hold.open()
    await choosing
    expect(h.edit().configFile.path).toBe(CONFIG)
  })

  it('does not copy the example when it can no longer be read', async () => {
    const folder = repoFolder({ noPersonalConfig: true })
    const h = harness()
    await h.actions.load(folder)
    const hold = gate()
    const wait = (path: string) => (path === 'config.json' ? hold.wait : undefined)
    folder.onRead = wait
    const choosing = h.actions.chooseConfig('copy')
    await h.actions.load(repoFolder())
    hold.open()
    await choosing
    // The copy was not made: the answer was for a folder that is no longer the open one.
    expect(folder.writes).not.toContain(CONFIG)
  })
})

describe('choosing the language', () => {
  it('writes the choice to the settings file and opens the editor', async () => {
    const folder = repoFolder({ noSettings: true })
    const h = harness()
    await h.actions.load(folder)
    expect(h.state().screen).toBe('pick-language')
    await h.actions.chooseLanguage('ps')
    expect(h.edit().settings).toEqual({ languages: ['ps'] })
    expect(JSON.parse(folder.text(SETTINGS_PATH)!)).toEqual({ languages: ['ps'] })
  })

  it('goes back to the open screen with the reason when the choice cannot be saved', async () => {
    const folder = repoFolder({ noSettings: true })
    const h = harness()
    await h.actions.load(folder)
    folder.onWrite = (path) => {
      if (path === SETTINGS_PATH) throw new Error('The disk is full.')
    }
    await h.actions.chooseLanguage('ahk')
    expect(h.state()).toMatchObject({ screen: 'open', message: 'The folder could not be opened: The disk is full.' })
  })

  it('answers once when the choice is clicked twice', async () => {
    const folder = repoFolder({ noSettings: true })
    const h = harness()
    await h.actions.load(folder)
    await Promise.all([h.actions.chooseLanguage('ahk'), h.actions.chooseLanguage('ps')])
    expect(h.edit().settings).toEqual({ languages: ['ahk'] })
    expect(folder.writes.filter((p) => p === SETTINGS_PATH)).toHaveLength(1)
  })

  it('falls back to AutoHotkey when the platform finds no language installed', async () => {
    const folder = repoFolder({ noSettings: true })
    const h = harness({ installedLanguages: async () => [] })
    await h.actions.load(folder)
    expect(h.edit().settings).toEqual({ languages: ['ahk'] })
    expect(JSON.parse(folder.text(SETTINGS_PATH)!)).toEqual({ languages: ['ahk'] })
  })

  it('uses the first installed language without asking', async () => {
    const h = harness({ installedLanguages: async () => ['ps', 'ahk'] })
    await h.actions.load(repoFolder({ noSettings: true }))
    expect(h.edit().settings).toEqual({ languages: ['ps'] })
  })
})

describe('loading', () => {
  it('ignores a folder that failed after a newer one opened', async () => {
    const old = repoFolder()
    const hold = gate()
    old.onList = () => hold.wait.then(() => Promise.reject(new Error('The old folder broke.')))
    const h = harness()
    const first = h.actions.load(old)
    await h.actions.load(repoFolder())
    hold.open()
    await first
    expect(h.edit().banner).toBeNull()
  })

  it('ignores a folder that was not a macropad folder once a newer one opened', async () => {
    const empty = new Flaky(new MemoryFolder('empty'))
    const hold = gate()
    empty.onList = () => hold.wait
    const h = harness()
    const first = h.actions.load(empty)
    await h.actions.load(repoFolder())
    hold.open()
    await first
    expect(h.edit().folder.name).toBe('repo')
  })

  it('does not finish opening a folder when the app went away meanwhile', async () => {
    const watch = vi.fn(() => () => {})
    const folder = repoFolder()
    const hold = gate()
    folder.onRead = async (path) => {
      if (path === CONFIG) await hold.wait
    }
    const h = harness({ watch })
    const loading = h.actions.load(folder)
    h.dispose()
    hold.open()
    await loading
    expect(h.state().screen).toBe('open')
    expect(watch).not.toHaveBeenCalled()
  })

  it('does not open a folder that was closed while it loaded', async () => {
    const folder = repoFolder()
    const hold = gate()
    folder.onRead = async (path) => {
      if (path === CONFIG) await hold.wait
    }
    const h = harness()
    const loading = h.actions.load(folder)
    h.actions.closeFolder()
    hold.open()
    await loading
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: null })
  })

  it('closing the folder returns to the open screen and stops saving', async () => {
    const h = await opened({}, {}, true)
    h.actions.closeFolder()
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: null })
    expect(await h.actions.save()).toBe('blocked')
  })
})

describe('the languages you run', () => {
  it('keeps the choice on screen and says so when it cannot be saved', async () => {
    const h = await opened()
    h.folder.onWrite = (path) => {
      if (path === SETTINGS_PATH) throw new Error('The disk is full.')
    }
    await h.actions.setLanguages(['ps'])
    expect(h.edit().settings).toEqual({ languages: ['ps'] })
    expect(h.edit().banner).toEqual({ text: 'Your languages were not saved: The disk is full.', kind: 'error' })
  })

  it('says why when the failure is not an Error', async () => {
    const h = await opened()
    h.folder.onWrite = (path) => {
      if (path === SETTINGS_PATH) throw 'denied'
    }
    await h.actions.setLanguages(['ps'])
    expect(h.edit().banner?.text).toBe('Your languages were not saved: denied')
  })

  it('saves the choice to the settings file', async () => {
    const h = await opened()
    await h.actions.setLanguages(['ahk', 'ps'])
    expect(JSON.parse(h.folder.text(SETTINGS_PATH)!)).toEqual({ languages: ['ahk', 'ps'] })
  })

  it('refuses to run no language at all', async () => {
    const h = await opened()
    await h.actions.setLanguages([])
    expect(h.edit().settings).toEqual({ languages: ['ahk'] })
    expect(h.folder.writes).not.toContain(SETTINGS_PATH)
  })
})

describe('saving config.json', () => {
  it('has nothing to save without an open folder', async () => {
    expect(await harness().actions.save()).toBe('blocked')
  })

  it('reports a conflict when config.json vanished, and writes nothing', async () => {
    const h = await opened({}, {}, true)
    await h.folder.inner.remove(CONFIG)
    expect(await h.actions.save()).toBe('conflict')
    expect(h.edit().saveDialog).toEqual({ kind: 'conflict' })
    expect(h.folder.text(CONFIG)).toBeNull()
  })

  it('writes config.json again after Overwrite anyway when it vanished, with no .bak', async () => {
    const h = await opened({}, {}, true)
    await h.folder.inner.remove(CONFIG)
    expect(await h.actions.save({ force: true })).toBe('saved')
    expect(h.folder.text(CONFIG)).toContain('"F1"')
    expect(h.folder.text(`${CONFIG}.bak`)).toBeNull()
    expect(h.edit().dirty).toBe(false)
  })

  it('still writes the file when the folder is closed during the save', async () => {
    const h = await opened({}, {}, true)
    const hold = gate()
    h.folder.onWrite = async (path) => {
      if (path === CONFIG) await hold.wait
    }
    const saving = h.actions.save()
    h.actions.closeFolder()
    hold.open()
    expect(await saving).toBe('saved')
    expect(h.folder.text(CONFIG)).toContain('"F1"')
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: null })
  })

  it('says blocked, not conflict, when the save failed after the folder was closed', async () => {
    const h = await opened({}, {}, true)
    const hold = gate()
    h.folder.onWrite = async (path) => {
      if (path === CONFIG) {
        await hold.wait
        throw new ConflictError(CONFIG)
      }
    }
    const saving = h.actions.save()
    h.actions.closeFolder()
    hold.open()
    expect(await saving).toBe('blocked')
    expect(h.state().screen).toBe('open')
  })

  it('says why when the copy of the old file fails, and leaves config.json alone', async () => {
    const h = await opened({}, {}, true)
    h.folder.onWrite = (path) => {
      if (path === `${CONFIG}.bak`) throw new Error('Access is denied.')
    }
    expect(await h.actions.save()).toBe('blocked')
    expect(h.edit().banner).toEqual({ text: 'local/config.json was not saved: Access is denied.', kind: 'error' })
    expect(h.folder.text(CONFIG)).toBe(EXAMPLE)
    expect(h.edit().dirty).toBe(true)
  })

  it('says why when the failure is not an Error', async () => {
    const h = await opened({}, {}, true)
    h.folder.onWrite = (path) => {
      if (path === CONFIG) throw 'locked'
    }
    await h.actions.save()
    expect(h.edit().banner?.text).toBe('local/config.json was not saved: locked')
  })
})

describe('the after-save macropad offer', () => {
  it('does not offer a reload when another save came while the macropad was being looked up', async () => {
    const hold = gate<LangId | null>()
    const findMacropad = vi.fn<() => Promise<LangId | null>>()
    findMacropad.mockReturnValueOnce(hold.wait).mockResolvedValue(null)
    const h = await opened({}, { findMacropad }, true)
    expect(await h.actions.save()).toBe('saved')
    h.send({ type: 'edit', ws: renameKey(h.edit().ws, 'k1', 'F2') })
    expect(await h.actions.save()).toBe('saved')
    hold.open('ahk')
    await new Promise((r) => setTimeout(r, 0))
    expect(h.edit().saveDialog).toBeNull()
  })

  it('offers a reload that then reports the running macropad was not found', async () => {
    const h = await opened({}, { findMacropad: async () => 'ahk', reloadMacropad: async () => null }, true)
    await h.actions.save()
    await vi.waitFor(() => expect(h.edit().saveDialog).toMatchObject({ kind: 'saved', macropad: 'ahk' }))
    await h.actions.reloadMacropad()
    expect(h.edit().saveDialog).toMatchObject({ macropad: null, note: 'No running macropad was found to reload.' })
  })

  it('does nothing when no reload was offered', async () => {
    const reloadMacropad = vi.fn(async () => 'ahk' as LangId)
    const h = await opened({}, { reloadMacropad }, true)
    await h.actions.save()
    await h.actions.reloadMacropad()
    expect(reloadMacropad).not.toHaveBeenCalled()
    expect(h.edit().saveDialog).toBeNull()
  })

  it('keeps the offer when the platform cannot reload', async () => {
    const h = await opened({}, { findMacropad: async () => 'ahk' }, true)
    await h.actions.save()
    await vi.waitFor(() => expect(h.edit().saveDialog).toMatchObject({ macropad: 'ahk' }))
    await h.actions.reloadMacropad()
    expect(h.edit().saveDialog).toMatchObject({ macropad: 'ahk', note: null })
  })

  it('drops the result of a reload once the dialog was closed', async () => {
    const hold = gate<LangId | null>()
    const h = await opened({}, { findMacropad: async () => 'ahk', reloadMacropad: () => hold.wait }, true)
    await h.actions.save()
    await vi.waitFor(() => expect(h.edit().saveDialog).toMatchObject({ macropad: 'ahk' }))
    const reloading = h.actions.reloadMacropad()
    h.send({ type: 'save-dialog', dialog: null })
    hold.open('ahk')
    await reloading
    expect(h.edit().saveDialog).toBeNull()
  })
})

describe('reloading config.json from disk', () => {
  it('does nothing when no folder is open', async () => {
    const h = harness()
    await h.actions.reloadFromDisk()
    expect(h.state().screen).toBe('open')
  })

  it('keeps the edits and says why when the disk version cannot be opened', async () => {
    const h = await opened({}, {}, true)
    await h.folder.inner.writeBytes(CONFIG, enc.encode('{ "fn": '))
    const ws = h.edit().ws
    h.send({ type: 'save-dialog', dialog: { kind: 'conflict' } })
    await h.actions.reloadFromDisk()
    expect(h.edit().banner?.kind).toBe('error')
    expect(h.edit().banner?.text).toMatch(/^local\/config\.json is not valid JSON: /)
    expect(h.edit().ws).toBe(ws)
    expect(h.edit().dirty).toBe(true)
    expect(h.edit().saveDialog).toBeNull()
  })

  it('keeps the edits and says so when config.json vanished', async () => {
    const h = await opened({}, {}, true)
    await h.folder.inner.remove(CONFIG)
    await h.actions.reloadFromDisk()
    expect(h.edit().banner).toEqual({ text: 'local/config.json is missing.', kind: 'error' })
    expect(h.edit().dirty).toBe(true)
  })

  it('shows nothing when the folder was closed while it was being read', async () => {
    const h = await opened({}, {}, true)
    const hold = gate()
    h.folder.onRead = async (path) => {
      if (path === CONFIG) await hold.wait
    }
    const reloading = h.actions.reloadFromDisk()
    h.actions.closeFolder()
    hold.open()
    await reloading
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: null })
  })

  it('shows no error when the folder was closed and the read failed', async () => {
    const h = await opened({}, {}, true)
    const hold = gate()
    h.folder.onRead = async (path) => {
      if (path === CONFIG) {
        await hold.wait
        throw new Error('gone')
      }
    }
    const reloading = h.actions.reloadFromDisk()
    h.actions.closeFolder()
    hold.open()
    await reloading
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: null })
  })
})

describe('watching the files', () => {
  it('notices an outside edit of config.json when the platform reports it, and stops after the folder closes', async () => {
    let onChange: (path: string) => void = () => {}
    let watched: string[] = []
    const stop = vi.fn()
    const h = await opened({}, {
      watch: (paths, cb) => {
        watched = paths
        onChange = cb
        return stop
      },
    })
    expect(watched).toContain(CONFIG)
    expect(watched).toContain('ahk/commands/media.ahk')
    await h.folder.inner.writeBytes(CONFIG, enc.encode(EXAMPLE.replace('F13', 'F1')))
    onChange(CONFIG)
    await vi.waitFor(() => expect(h.edit().outsideChange).not.toBeNull())
    h.actions.closeFolder()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('notices an outside edit of a command file when the platform reports it', async () => {
    let onChange: (path: string) => void = () => {}
    const h = await opened(withMine, {
      watch: (_paths, cb) => {
        onChange = cb
        return () => {}
      },
    })
    h.actions.editCommand(MINE, 'Mine(Macro)\n{\n  ; mine\n}\n', versionOf(h, MINE))
    await h.folder.inner.writeBytes(MINE, enc.encode('Mine(Macro)\n{\n  ; other\n}\n'))
    onChange(MINE)
    await vi.waitFor(() => expect(h.edit().commands.outside[MINE]).toBeDefined())
  })

  it('watches a new command file too', async () => {
    const lists: string[][] = []
    const h = await opened({}, {
      watch: (paths) => {
        lists.push(paths)
        return () => {}
      },
    })
    expect(await h.actions.createCommandFiles({ group: 'yours', name: 'fresh', langs: ['ahk'] })).toBeNull()
    expect(lists.at(-1)).toContain('local/ahk/fresh.ahk')
  })
})

describe('rechecking config.json', () => {
  it('says nothing when the file cannot be read, and notices the next change', async () => {
    const h = await opened()
    let broken = true
    h.folder.onRead = (path) => {
      if (broken && path === CONFIG) throw new Error('The file is locked.')
    }
    await h.actions.recheck()
    expect(h.edit().outsideChange).toBeNull()
    expect(h.edit().banner).toBeNull()
    broken = false
    await h.folder.inner.writeBytes(CONFIG, enc.encode(EXAMPLE.replace('F13', 'F1')))
    await h.actions.recheck()
    expect(h.edit().outsideChange).not.toBeNull()
  })

  it('does nothing without an open folder', async () => {
    const h = harness()
    await h.actions.recheck()
    expect(h.state().screen).toBe('open')
  })
})

describe('command files', () => {
  it('scanning again after a failed scan finds the new file', async () => {
    const h = await opened(withMine)
    let broken = true
    h.folder.onList = () => {
      if (broken) throw new Error('The folder is locked.')
    }
    const before = h.edit().commandFiles
    await h.actions.recheckCommands()
    expect(h.edit().commandFiles).toBe(before)
    expect(h.edit().banner).toBeNull()
    broken = false
    await h.folder.inner.writeBytes('local/ahk/late.ahk', enc.encode('Late(Macro)\n{\n}\n'))
    await h.actions.recheckCommands()
    expect(h.edit().commandFiles.map((f) => f.file.path)).toContain('local/ahk/late.ahk')
  })

  it('a save is not spoiled by an include file that cannot be read', async () => {
    const h = await opened({ files: { ...withMine.files, [HUB]: '#Requires AutoHotkey v2.0\n#Include mine.ahk\n' } }, {
      checkSyntax: async () => ({ ok: true }),
    })
    h.folder.onRead = (path) => {
      if (path === HUB) throw new Error('The hub is locked.')
    }
    const text = 'Mine(Macro)\n{\n  ; changed\n}\n'
    h.actions.editCommand(MINE, text, versionOf(h, MINE))
    expect(await h.actions.saveCommandFile(MINE)).toBe('saved')
    expect(h.folder.text(MINE)).toBe(text)
    await vi.waitFor(() => expect(h.edit().commands.saved[MINE]?.check).toEqual({ ok: true }))
    expect(h.edit().commands.saved[MINE].unlisted).toBeNull()
  })

  it('says why a file could not be reloaded and keeps the one it holds', async () => {
    const h = await opened(withMine)
    h.folder.onRead = (path) => {
      if (path === MINE) throw new Error('The file is locked.')
    }
    const before = h.edit().commandFiles.find((f) => f.file.path === MINE)
    await h.actions.reloadCommandFile(MINE)
    expect(h.edit().banner).toEqual({ text: `${MINE} was not reloaded: The file is locked.`, kind: 'error' })
    expect(h.edit().commandFiles.find((f) => f.file.path === MINE)).toBe(before)
  })

  it('shows no reload error once the folder was closed', async () => {
    const h = await opened(withMine)
    const hold = gate()
    h.folder.onRead = async (path) => {
      if (path === MINE) {
        await hold.wait
        throw new Error('The file is locked.')
      }
    }
    const reloading = h.actions.reloadCommandFile(MINE)
    h.actions.closeFolder()
    hold.open()
    await reloading
    expect(h.state()).toEqual({ screen: 'open', message: null, reopen: null })
  })

  it('has nothing to save without a draft, or for a file that is not UTF-8', async () => {
    const h = await opened({ files: withMine.files })
    expect(await h.actions.saveCommandFile(MINE)).toBe('blocked')
    await h.folder.inner.writeBytes('local/ahk/broken.ahk', new Uint8Array([0x4f, 0xe9, 0x0a]))
    await h.actions.recheckCommands()
    h.actions.editCommand('local/ahk/broken.ahk', 'x', null)
    expect(h.edit().commands.drafts['local/ahk/broken.ahk']).toBeUndefined()
    expect(await h.actions.saveCommandFile('local/ahk/broken.ahk')).toBe('blocked')
  })

  it('reports a conflict when the file vanished, and recreates it with Overwrite anyway but no .bak', async () => {
    const h = await opened(withMine)
    const text = 'Mine(Macro)\n{\n  ; changed\n}\n'
    h.actions.editCommand(MINE, text, versionOf(h, MINE))
    await h.folder.inner.remove(MINE)
    expect(await h.actions.saveCommandFile(MINE)).toBe('conflict')
    expect(h.edit().commands.dialog).toEqual({ kind: 'conflict', path: MINE })
    expect(h.folder.text(MINE)).toBeNull()
    expect(await h.actions.saveCommandFile(MINE, { force: true })).toBe('saved')
    expect(h.folder.text(MINE)).toBe(text)
    expect(h.folder.text(`${MINE}.bak`)).toBeNull()
  })

  it('says why a save failed and keeps the draft', async () => {
    const h = await opened(withMine)
    const text = 'Mine(Macro)\n{\n  ; changed\n}\n'
    h.actions.editCommand(MINE, text, versionOf(h, MINE))
    h.folder.onWrite = (path) => {
      if (path === MINE) throw new Error('The disk is full.')
    }
    expect(await h.actions.saveCommandFile(MINE)).toBe('blocked')
    expect(h.edit().banner).toEqual({ text: `${MINE} was not saved: The disk is full.`, kind: 'error' })
    expect(h.edit().commands.drafts[MINE]).toBe(text)
    expect(h.folder.text(MINE)).toBe(MINE_TEXT)
  })

  describe('making files', () => {
    const request: { group: 'yours'; name: string; langs: LangId[] } = { group: 'yours', name: 'fresh', langs: ['ahk'] }

    it('says why a file could not be created and lists nothing', async () => {
      const h = await opened()
      h.folder.onWrite = (path) => {
        if (path === 'local/ahk/fresh.ahk') throw new Error('The disk is full.')
      }
      expect(await h.actions.createCommandFiles(request)).toBe('local/ahk/fresh.ahk was not created: The disk is full.')
      expect(h.edit().commandFiles.some((f) => f.file.path === 'local/ahk/fresh.ahk')).toBe(false)
      expect(h.folder.text(HUB)).toBeNull()
    })

    it('does not replace a file that appeared while it was being created', async () => {
      const h = await opened()
      let reads = 0
      h.folder.onRead = async (path) => {
        if (path === 'local/ahk/fresh.ahk' && ++reads === 2) {
          await h.folder.inner.writeBytes(path, enc.encode('Fresh(Macro)\n{\n}\n'))
        }
      }
      expect(await h.actions.createCommandFiles(request)).toBe('local/ahk/fresh.ahk already exists.')
      expect(h.folder.text('local/ahk/fresh.ahk')).toBe('Fresh(Macro)\n{\n}\n')
    })

    it('creates nothing and says why when the include file cannot be read', async () => {
      const h = await opened()
      h.folder.onRead = (path) => {
        if (path === HUB) throw new Error('The hub is locked.')
      }
      expect(await h.actions.createCommandFiles(request)).toBe('The hub is locked.')
      expect(h.folder.text('local/ahk/fresh.ahk')).toBeNull()
    })

    it('makes nothing for a group that is neither yours nor shared', async () => {
      const h = await opened()
      expect(await h.actions.createMissingFile('other:fresh', 'ahk')).toBeNull()
      expect(h.folder.writes).toEqual([])
    })

    it('makes the missing half of a pair and shows it', async () => {
      const h = await opened(withMine)
      expect(await h.actions.createMissingFile('yours:mine', 'ps')).toBeNull()
      expect(h.folder.text('local/powershell/commands/mine.ps1')).not.toBeNull()
      expect(h.edit().commands).toMatchObject({ pair: 'yours:mine', lang: 'ps' })
    })
  })

  describe('deleting a file', () => {
    const files = { ...withMine.files, [HUB]: '#Requires AutoHotkey v2.0\n#Include mine.ahk\n' }

    it('does nothing for a file that is not held', async () => {
      const h = await opened(withMine)
      expect(await h.actions.deleteCommandFile('local/ahk/nope.ahk')).toBeNull()
    })

    it('refuses a file that changed on disk', async () => {
      const h = await opened(withMine)
      await h.folder.inner.writeBytes(MINE, enc.encode('Mine(Macro)\n{\n  ; outside\n}\n'))
      expect(await h.actions.deleteCommandFile(MINE)).toBe(`${MINE} changed on disk; reload it first.`)
      expect(h.folder.text(MINE)).toContain('; outside')
    })

    it('adds the include line again, keeping an outside edit of the include file, when removing fails', async () => {
      const h = await opened({ files })
      h.folder.onRemove = async () => {
        await h.folder.inner.writeBytes(HUB, enc.encode('#Requires AutoHotkey v2.0\n; edited elsewhere\n'))
        throw new Error('The file is locked.')
      }
      expect(await h.actions.deleteCommandFile(MINE)).toBe(`${MINE} was not deleted: The file is locked.`)
      expect(h.folder.text(MINE)).toBe(MINE_TEXT)
      expect(h.folder.text(HUB)).toContain('; edited elsewhere')
      expect(h.folder.text(HUB)).toContain('#Include mine.ahk')
    })

    it('still removes the file when the folder is closed during the delete', async () => {
      const h = await opened({ files })
      const hold = gate()
      h.folder.onRead = async (path) => {
        if (path === MINE) await hold.wait
      }
      const deleting = h.actions.deleteCommandFile(MINE)
      await Promise.resolve()
      h.actions.closeFolder()
      hold.open()
      expect(await deleting).toBeNull()
      expect(h.state().screen).toBe('open')
      expect(h.folder.text(MINE)).toBeNull()
    })
  })
})
