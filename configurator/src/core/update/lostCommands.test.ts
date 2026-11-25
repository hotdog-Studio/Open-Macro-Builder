import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config/parse'
import { commandFilesIn, type CommandFile, type LangId } from '../languages'
import type { UpdatePicks } from './apply'
import { commandFilesAfter, lostCommands, undefinedCommands } from './lostCommands'
import type { UpdatePlan } from './plan'

const enc = new TextEncoder()

const SPLIT_AHK = 'ahk/commands/custom/vsstudio.ahk'
const SPLIT_PS1 = 'powershell/commands/custom/vsstudio.ps1'
const WINDOWS_AHK = 'ahk/commands/windows.ahk'
const MINE_AHK = 'local/ahk/mine.ahk'
const KEPT_AHK = 'ahk/commands/custom/kept.ahk'
const GONE_AHK = 'ahk/commands/custom/gone.ahk'

/** Command files from their texts, read as a folder's are. */
const filesOf = (texts: Record<string, string>): Promise<CommandFile[]> =>
  commandFilesIn(Object.entries(texts).map(([path, text]) => ({ path, data: enc.encode(text) })))

const ahkDefining = (...names: string[]) => names.map((name) => `${name}(Macro) {\n}\n`).join('\n')
const psDefining = (...names: string[]) => names.map((name) => `function ${name} { param($Macro) }\n`).join('')

/**
 * A pad of three keys with the layer "VS Studio" on F13, whose F15 runs VsStudioSplitPanel and F14 VsStudioBuild; a
 * parked layer "Old" whose F13 runs Parked; and "Windows" on F14, whose F13 runs SnapThirdsLeft and F15 snapthirdsleft.
 */
const LAYOUT = parseConfig(
  JSON.stringify({
    fn: { key: 'ScrollLock' },
    keys: [{ key: 'F13' }, { key: 'F14' }, { key: 'F15' }],
    layers: [
      {
        title: 'VS Studio',
        icon: 'vs_studio',
        macros: [null, { action: 'VsStudioBuild', name: 'Build' }, { action: 'VsStudioSplitPanel', name: 'Split' }],
      },
      {
        title: 'Windows',
        icon: 'windows',
        macros: [{ action: 'SnapThirdsLeft', name: '1/3' }, null, { action: 'snapthirdsleft', name: 'again' }],
      },
      { title: 'Old', icon: 'old', disabled: true, macros: [{ action: 'Parked', name: 'Parked' }] },
    ],
  }),
  'local/config.json',
)

const BOTH: LangId[] = ['ahk', 'ps']
const NO_PICKS: UpdatePicks = { replaceChanged: [], restoreDeleted: [] }
const NO_PLAN: Pick<UpdatePlan, 'changed' | 'deleted' | 'remove'> = { changed: [], deleted: [], remove: [] }

const key = (name: string) => ({ kind: 'key' as const, name })
const hotkey = (name: string) => ({ kind: 'hotkey' as const, name: `Hotkey ${name}` })
const hotstring = (name: string) => ({ kind: 'hotstring' as const, name: `Hotstring ${name}` })
const split = (...langs: LangId[]) => ({ name: 'VsStudioSplitPanel', places: [key('VS Studio · F15')], langs })
const snap = (...langs: LangId[]) => ({ name: 'SnapThirdsLeft', places: [key('Windows · F13'), key('Windows · F15')], langs })

/**
 * LAYOUT with hotkeys and hotstrings: ^!e runs SnapThirdsLeft and ^!r SnapThirdsRight; :X:now runs
 * SnapThirdsRight and :*X:soon VsStudioSplitPanel. Not counted, as the layout check does not count them: an empty
 * slot, a hotkey without an action, a hotstring that only replaces text, and one with X0, which runs nothing.
 */
const HOT_LAYOUT = parseConfig(
  JSON.stringify({
    fn: { key: 'ScrollLock' },
    keys: [{ key: 'F13' }, { key: 'F14' }, { key: 'F15' }],
    layers: [
      { title: 'VS Studio', icon: 'vs_studio', macros: [null, null, { action: 'VsStudioSplitPanel', name: 'Split' }] },
      { title: 'Windows', icon: 'windows', macros: [{ action: 'SnapThirdsLeft', name: '1/3' }] },
    ],
    hotkeys: [{ hotkey: '^!e', action: 'SnapThirdsLeft' }, null, { hotkey: '^!x' }, { hotkey: '^!r', action: 'SnapThirdsRight' }],
    hotstrings: [
      { hotstring: ':X:now', action: 'SnapThirdsRight' },
      { hotstring: '::btw', replacement: 'by the way' },
      { hotstring: ':X0:off', action: 'Gone' },
      { hotstring: ':*X:soon', action: 'VsStudioSplitPanel' },
    ],
  }),
  'local/config.json',
)

/** What 1.0.5 had: the folder's files before the update. */
const NOW = {
  [SPLIT_AHK]: ahkDefining('VsStudioBuild', 'VsStudioSplitPanel'),
  [SPLIT_PS1]: psDefining('VsStudioBuild', 'VsStudioSplitPanel'),
  [WINDOWS_AHK]: ahkDefining('SnapThirdsLeft'),
}

/** The app's copy: the split and the snap gone, the build kept. */
const APP = {
  [SPLIT_AHK]: ahkDefining('VsStudioBuild'),
  [SPLIT_PS1]: psDefining('VsStudioBuild'),
  [WINDOWS_AHK]: ahkDefining('SnapWindowLeft'),
}

const byText = (a: string, b: string) => a.localeCompare(b)
const lowerPaths = (files: CommandFile[]) => files.map((f) => f.file.path.toLowerCase()).sort(byText)
const textAt = (files: CommandFile[], path: string) => files.find((f) => f.file.path.toLowerCase() === path.toLowerCase())?.file.text

describe('commandFilesIn', () => {
  it('reads the command files among the files of a copy, as a scan of a folder reads them, and leaves out the rest', async () => {
    const files = await commandFilesIn([
      { path: SPLIT_AHK, data: enc.encode(ahkDefining('VsStudioBuild')) },
      { path: SPLIT_PS1, data: enc.encode(psDefining('VsStudioBuild')) },
      { path: 'ahk/main.ahk', data: enc.encode('Main() {\n}\n') },
      { path: 'img/icon.png', data: new Uint8Array([0x89, 0x50]) },
    ])
    expect(files.map((f) => [f.file.path, f.lang, f.group, f.pair, f.functions.map((fn) => fn.name)])).toEqual([
      [SPLIT_AHK, 'ahk', 'shared', 'custom/vsstudio', ['VsStudioBuild']],
      [SPLIT_PS1, 'ps', 'shared', 'custom/vsstudio', ['VsStudioBuild']],
    ])
  })
})

describe('commandFilesAfter', () => {
  it.each<{ name: string; plan: Partial<typeof NO_PLAN>; picks?: UpdatePicks; now: Record<string, string>; want: Record<string, string | undefined> }>([
    {
      name: "a file the update replaces is the app's",
      plan: {},
      now: { [SPLIT_AHK]: NOW[SPLIT_AHK] },
      want: { [SPLIT_AHK]: APP[SPLIT_AHK] },
    },
    {
      name: 'a changed file not ticked stays as the folder has it, in any case of its path',
      plan: { changed: ['ahk/commands/custom/VsStudio.ahk'] },
      now: { 'ahk/commands/custom/VsStudio.ahk': NOW[SPLIT_AHK] },
      want: { [SPLIT_AHK]: NOW[SPLIT_AHK] },
    },
    {
      name: "a changed file ticked is the app's",
      plan: { changed: [SPLIT_AHK] },
      picks: { replaceChanged: [SPLIT_AHK], restoreDeleted: [] },
      now: { [SPLIT_AHK]: NOW[SPLIT_AHK] },
      want: { [SPLIT_AHK]: APP[SPLIT_AHK] },
    },
    {
      name: 'a deleted file not ticked stays deleted',
      plan: { deleted: [SPLIT_AHK] },
      now: {},
      want: { [SPLIT_AHK]: undefined },
    },
    {
      name: "a deleted file ticked comes back as the app's",
      plan: { deleted: [SPLIT_AHK] },
      picks: { replaceChanged: [], restoreDeleted: [SPLIT_AHK] },
      now: {},
      want: { [SPLIT_AHK]: APP[SPLIT_AHK] },
    },
    {
      name: 'a file the update removes goes',
      plan: { remove: [GONE_AHK] },
      now: { [GONE_AHK]: ahkDefining('Gone') },
      want: { [GONE_AHK]: undefined, [SPLIT_AHK]: APP[SPLIT_AHK] },
    },
    {
      name: 'a changed file the app no longer has (keptRemoved), and one of your own, stay',
      plan: {},
      now: { [KEPT_AHK]: ahkDefining('Kept'), [MINE_AHK]: ahkDefining('Mine') },
      want: { [KEPT_AHK]: ahkDefining('Kept'), [MINE_AHK]: ahkDefining('Mine'), [SPLIT_AHK]: APP[SPLIT_AHK] },
    },
  ])('$name', async ({ plan, picks, now, want }) => {
    const after = commandFilesAfter(await filesOf(now), await filesOf({ [SPLIT_AHK]: APP[SPLIT_AHK] }), { ...NO_PLAN, ...plan }, picks ?? NO_PICKS)
    for (const [path, text] of Object.entries(want)) expect(textAt(after, path)).toBe(text)
    // Nothing else, and nothing twice.
    expect(lowerPaths(after)).toEqual(Object.keys(want).filter((path) => want[path] !== undefined).map((path) => path.toLowerCase()).sort(byText))
  })
})

describe('lostCommands', () => {
  it('names each command the layers on keys use that a file defines now and none after the update, with its keys, once', async () => {
    const lost = lostCommands(LAYOUT, BOTH, await filesOf(NOW), await filesOf(APP))
    // VsStudioSplitPanel goes from both languages; SnapThirdsLeft only from AutoHotkey, the one that had it.
    expect(lost).toEqual([split('ahk', 'ps'), snap('ahk')])
  })

  it('names a command that a hotkey or a hotstring with the X option runs, by that hotkey or hotstring, after its keys', async () => {
    const now = await filesOf({ ...NOW, [WINDOWS_AHK]: ahkDefining('SnapThirdsLeft', 'SnapThirdsRight', 'Gone') })
    expect(lostCommands(HOT_LAYOUT, ['ahk'], now, await filesOf(APP))).toEqual([
      { name: 'VsStudioSplitPanel', places: [key('VS Studio · F15'), hotstring(':*X:soon')], langs: ['ahk'] },
      { name: 'SnapThirdsLeft', places: [key('Windows · F13'), hotkey('^!e')], langs: ['ahk'] },
      { name: 'SnapThirdsRight', places: [hotkey('^!r'), hotstring(':X:now')], langs: ['ahk'] },
    ])
  })

  it.each<[string, LangId[], Record<string, string>, Record<string, string>]>([
    ['every command is still defined after the update', BOTH, NOW, NOW],
    ['a command no file defines now either (the layout check reports it already)', BOTH, { [SPLIT_AHK]: '', [SPLIT_PS1]: '' }, {}],
    ['a command lost only in a language the person does not run', ['ps'], { [WINDOWS_AHK]: NOW[WINDOWS_AHK] }, { [WINDOWS_AHK]: APP[WINDOWS_AHK] }],
  ])('names none when %s', async (_name, languages, now, after) => {
    expect(lostCommands(LAYOUT, languages, await filesOf(now), await filesOf(after))).toEqual([])
  })

  it('names a command lost in one of the languages the person runs, defined in the other', async () => {
    const after = await filesOf({ ...NOW, [SPLIT_PS1]: APP[SPLIT_PS1] })
    expect(lostCommands(LAYOUT, BOTH, await filesOf(NOW), after)).toEqual([split('ps')])
  })

  it('leaves out a command only a parked layer uses: the macropad never loads that layer', async () => {
    const now = await filesOf({ ...NOW, [KEPT_AHK]: ahkDefining('Parked') })
    expect(lostCommands(LAYOUT, ['ahk'], now, await filesOf(APP)).map((c) => c.name)).toEqual(['VsStudioSplitPanel', 'SnapThirdsLeft'])
  })
})

describe('undefinedCommands', () => {
  it('names each command the layers on keys use that the files leave undefined in a language the person runs', async () => {
    const files = await filesOf({ [SPLIT_AHK]: APP[SPLIT_AHK], [SPLIT_PS1]: NOW[SPLIT_PS1] })
    expect(undefinedCommands(LAYOUT, BOTH, files)).toEqual([split('ahk'), snap('ahk', 'ps')])
    expect(undefinedCommands(LAYOUT, ['ps'], files)).toEqual([snap('ps')])
  })

  it('names a command only a hotkey or a hotstring with the X option runs', async () => {
    const files = await filesOf({ [WINDOWS_AHK]: ahkDefining('SnapThirdsLeft', 'VsStudioSplitPanel') })
    expect(undefinedCommands(HOT_LAYOUT, ['ahk'], files)).toEqual([
      { name: 'SnapThirdsRight', places: [hotkey('^!r'), hotstring(':X:now')], langs: ['ahk'] },
    ])
  })

  it('names none when the files define every command the layers on keys use', async () => {
    expect(undefinedCommands(LAYOUT, ['ahk'], await filesOf(NOW))).toEqual([])
  })
})
