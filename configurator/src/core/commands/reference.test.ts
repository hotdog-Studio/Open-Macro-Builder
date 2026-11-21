import { readdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo, readRepoText } from '../../../test/repo'
import { LANGUAGES, scanCommands } from '../languages'
import { AHK_REFERENCE } from './ahkReference'
import { AHK_DOCS, REFERENCE_GROUPS, type ReferenceEntry } from './reference'
import TEXT from './reference/autohotkey.ahk?raw'

// The bundled AutoHotkey reference, reference/autohotkey.ahk, held to the standard of the project's
// own docs, and to what the scripts and powershell/docs/ahk-builtins.md say.

const entries = AHK_REFERENCE.entries
const byName = new Map(entries.map((e) => [e.fn.name.toLowerCase(), e]))
const entryOf = (name: string): ReferenceEntry | undefined => byName.get(name.toLowerCase())
const PAGE = /^https:\/\/www\.autohotkey\.com\/docs\/v2\/lib\/\w+\.htm(?:#\w+)?$/

/**
 * AutoHotkey v2's built-in functions, from the function index of its documentation (2.0.19), with
 * the ones it lists under another name's row (SendText, LTrim, WinWaitNotActive...) and the classes
 * that are called like functions (Gui, Menu, Map). Control flow (If, Loop, Return...) is left out.
 */
const BUILT_INS = `
Abs ACos Array ASin ATan BlockInput Buffer CallbackCreate CallbackFree CaretGetPos Ceil Chr Click ClipboardAll
ClipWait ComCall ComObjActive ComObjArray ComObjConnect ComObject ComObjFlags ComObjFromPtr ComObjGet ComObjQuery
ComObjType ComObjValue ComValue ControlAddItem ControlChooseIndex ControlChooseString ControlClick ControlDeleteItem
ControlFindItem ControlFocus ControlGetChecked ControlGetChoice ControlGetClassNN ControlGetEnabled ControlGetExStyle
ControlGetFocus ControlGetHwnd ControlGetIndex ControlGetItems ControlGetPos ControlGetStyle ControlGetText
ControlGetVisible ControlHide ControlHideDropDown ControlMove ControlSend ControlSendText ControlSetChecked
ControlSetEnabled ControlSetExStyle ControlSetStyle ControlSetText ControlShow ControlShowDropDown CoordMode Cos
Critical DateAdd DateDiff DetectHiddenText DetectHiddenWindows DirCopy DirCreate DirDelete DirExist DirMove DirSelect
DllCall Download DriveEject DriveGetCapacity DriveGetFileSystem DriveGetLabel DriveGetList DriveGetSerial
DriveGetSpaceFree DriveGetStatus DriveGetStatusCD DriveGetType DriveLock DriveRetract DriveSetLabel DriveUnlock Edit
EditGetCurrentCol EditGetCurrentLine EditGetLine EditGetLineCount EditGetSelectedText EditPaste EnvGet EnvSet Exit
ExitApp Exp FileAppend FileCopy FileCreateShortcut FileDelete FileEncoding FileExist FileGetAttrib FileGetShortcut
FileGetSize FileGetTime FileGetVersion FileInstall FileMove FileOpen FileRead FileRecycle FileRecycleEmpty FileSelect
FileSetAttrib FileSetTime Float Floor Format FormatTime GetKeyName GetKeySC GetKeyState GetKeyVK GetMethod
GroupActivate GroupAdd GroupClose GroupDeactivate Gui GuiCtrlFromHwnd GuiFromHwnd HasBase HasMethod HasProp HotIf
Hotkey Hotstring IL_Add IL_Create IL_Destroy ImageSearch IniDelete IniRead IniWrite InputBox InputHook
InstallKeybdHook InstallMouseHook InStr Integer IsLabel IsObject IsSet KeyHistory KeyWait ListHotkeys ListLines
ListVars ListViewGetContent Ln LoadPicture Log LTrim Map Max Menu MenuBar MenuFromHandle MenuSelect Min Mod
MonitorGet MonitorGetCount MonitorGetName MonitorGetPrimary MonitorGetWorkArea MouseClick MouseClickDrag MouseGetPos
MouseMove MsgBox Number NumGet NumPut ObjAddRef ObjBindMethod Object ObjGetBase ObjGetCapacity ObjOwnPropCount
ObjSetBase ObjSetCapacity OnClipboardChange OnError OnExit OnMessage Ord OutputDebug Pause Persistent PixelGetColor
PixelSearch PostMessage ProcessClose ProcessExist ProcessGetName ProcessGetParent ProcessGetPath ProcessSetPriority
ProcessWait ProcessWaitClose Random RegCreateKey RegDelete RegDeleteKey RegExMatch RegExReplace RegRead RegWrite
Reload Round RTrim Run RunAs RunWait Send SendEvent SendInput SendLevel SendMessage SendMode SendPlay SendText
SetCapsLockState SetControlDelay SetDefaultMouseSpeed SetKeyDelay SetMouseDelay SetNumLockState SetRegView
SetScrollLockState SetStoreCapsLockMode SetTimer SetTitleMatchMode SetWinDelay SetWorkingDir Shutdown Sin Sleep Sort
SoundBeep SoundGetInterface SoundGetMute SoundGetName SoundGetVolume SoundPlay SoundSetMute SoundSetVolume SplitPath
Sqrt StatusBarGetText StatusBarWait StrCompare StrGet String StrLen StrLower StrPtr StrPut StrReplace StrSplit
StrTitle StrUpper SubStr Suspend SysGet SysGetIPAddresses Tan Thread ToolTip TraySetIcon TrayTip Trim Type
VarSetStrCapacity VerCompare WinActivate WinActivateBottom WinActive WinClose WinExist WinGetClass WinGetClientPos
WinGetControls WinGetControlsHwnd WinGetCount WinGetExStyle WinGetID WinGetIDLast WinGetList WinGetMinMax WinGetPID
WinGetPos WinGetProcessName WinGetProcessPath WinGetStyle WinGetText WinGetTitle WinGetTransColor WinGetTransparent
WinHide WinKill WinMaximize WinMinimize WinMinimizeAll WinMove WinMoveBottom WinMoveTop WinRedraw WinRestore
WinSetAlwaysOnTop WinSetEnabled WinSetExStyle WinSetRegion WinSetStyle WinSetTitle WinSetTransColor WinSetTransparent
WinShow WinWait WinWaitActive WinWaitClose WinWaitNotActive
`
const builtIns = new Map(BUILT_INS.trim().split(/\s+/).map((name) => [name.toLowerCase(), name]))

/** The functions ahk-builtins.md names that have no entry, and why. */
const NO_ENTRY: Record<string, string> = {
  Hotkey: 'The macropad sets up its keys itself, from the layout the configurator saves (ahk/config.ahk); a command does not add keys.',
  Hotstring: 'The macropad sets up its hotstrings itself, from the layout the configurator saves (ahk/config.ahk).',
  OnMessage: "Hooks a Windows message for the whole script; the engine uses it for the macropad's own window (ahk/main.ahk).",
  Critical: "Changes how the whole script lets one thread interrupt another, which is the engine's business, not a command's.",
  Thread: "Changes how the whole script lets one thread interrupt another, which is the engine's business, not a command's.",
  IL_Create: "Makes a list of pictures for a Gui's ListView or TreeView; it belongs to building a window, which Gui's page covers.",
  IL_Destroy: "Frees a list of pictures made by IL_Create; it belongs to building a window, which Gui's page covers.",
  Input: 'AutoHotkey v1 only: v2 has no function of that name. InputHook, which has an entry, does its job.',
  SendPlay: 'Deprecated: AutoHotkey says it may do nothing at all on Windows 11, or with User Account Control on.',
  SendLevel: "Decides whether one script's keys can fire another's hotkeys; the macropad's keys are set up by the engine.",
  KeyHistory: 'A debugging window of the last keys pressed, for writing the engine, not for a command.',
  Shutdown:
    'Hidden by the Shutdown command of ahk/commands/power.ahk, which AutoHotkey calls in its place, so the scripts cannot reach it. ' +
    'Use the Restart and Shutdown commands, or Run "shutdown /r /t 0".',
}

/** Every .ahk file of the repository's ahk folder but its tests, as paths from the repository's root. */
function sharedAhkFiles(): string[] {
  const ahk = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../ahk')
  return readdirSync(ahk, { recursive: true, encoding: 'utf8' })
    .map((p) => `ahk/${p.split(sep).join('/')}`)
    .filter((p) => p.endsWith('.ahk') && !p.startsWith('ahk/tests/'))
}

/** A row of the table in ahk-builtins.md: the AutoHotkey names, what the PowerShell version uses, and the kind. */
interface MapRow {
  names: string[]
  powershell: string
  kind: string
}

/** The rows of the table, with directives and A_ variables left out of the names (the reference has neither). */
function builtinMap(): MapRow[] {
  return readRepoText('powershell/docs/ahk-builtins.md')
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const [, ahk, powershell, kind] = line.split('|').map((cell) => cell.trim())
      const names = [...ahk.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((n) => !n.startsWith('#') && !n.startsWith('A_'))
      return { names, powershell, kind }
    })
}

/** The lines of an AutoHotkey file without its comments, and with every quoted string emptied. */
function codeLines(text: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (inBlock || line.startsWith('/*')) {
      inBlock = !line.includes('*/')
      continue
    }
    out.push(raw.replaceAll(/"(?:[^"`]|`.)*"|'(?:[^'`]|`.)*'/g, '""').replace(/(?:^|\s);.*$/, ''))
  }
  return out
}

/**
 * The built-ins a text of AutoHotkey code names, lower-cased: every name of BUILT_INS outside comments and
 * strings and not after a dot (a member such as obj.Send). Stricter than looking for calls, as a call can
 * take any form (`else Send "x"`, `try Run "x"`, `{ WinClose "A" }`).
 */
function builtInsIn(text: string): string[] {
  const names: string[] = []
  for (const line of codeLines(text)) {
    for (const m of line.matchAll(/\w+/g)) {
      const name = m[0].toLowerCase()
      if (line[m.index - 1] !== '.' && builtIns.has(name)) names.push(name)
    }
  }
  return names
}

describe('the AutoHotkey reference', () => {
  it('reads every function of the file, each with its doc block', () => {
    const definitions = TEXT.match(/^\w+\(/gm) ?? []
    expect(entries.length).toBeGreaterThan(100)
    expect(entries).toHaveLength(definitions.length)
  })

  it('gives every entry a summary, an example, a note for each parameter and its page', () => {
    const bad = entries.filter(
      (e) => e.fn.doc.summary === '' || e.fn.doc.examples.length === 0 || e.fn.doc.params.some((p) => p.text === '') || !PAGE.test(e.page),
    )
    expect(bad.map((e) => e.fn.name)).toEqual([])
    expect(entries.every((e) => e.page.startsWith(AHK_DOCS))).toBe(true)
  })

  it('names every function once, ignoring case', () => {
    expect(byName.size).toBe(entries.length)
  })

  it('puts every entry in one of the groups, and every group holds some', () => {
    // One tag per entry, so no entry has two and none has none.
    expect(TEXT.match(/^\s*\*\s*@group\s/gm)).toHaveLength(entries.length)
    expect(entries.filter((e) => !(REFERENCE_GROUPS as readonly string[]).includes(e.group)).map((e) => e.fn.name)).toEqual([])
    expect(new Set(entries.map((e) => e.group))).toEqual(new Set(REFERENCE_GROUPS))
  })

  it('describes only built-ins, under their own names', () => {
    expect(entries.filter((e) => builtIns.get(e.fn.name.toLowerCase()) !== e.fn.name).map((e) => e.fn.name)).toEqual([])
  })

  it('has an entry for every built-in the shared AutoHotkey command files call', async () => {
    const files = (await scanCommands(memoryFolderFromRepo(['ahk/commands']))).filter((f) => f.lang === 'ahk')
    // A function the folder defines (power.ahk has a Shutdown command) is called instead of the built-in.
    const defined = new Set(files.flatMap((f) => f.functions.map((fn) => fn.name.toLowerCase())))
    const named = [...new Set(files.flatMap((f) => builtInsIn(f.file.text)))].filter((n) => !defined.has(n))
    expect(named.length).toBeGreaterThan(30)
    expect(named.filter((n) => !entryOf(n)).map((n) => builtIns.get(n))).toEqual([])
  })

  it('calls in its examples only built-ins that have an entry', () => {
    const named = new Set(entries.flatMap((e) => e.fn.doc.examples.flatMap(builtInsIn)))
    expect(named.size).toBeGreaterThan(50)
    expect([...named].filter((n) => !entryOf(n)).map((n) => builtIns.get(n))).toEqual([])
  })

  it('has no entry for a built-in that a function of the shared scripts hides', () => {
    // AutoHotkey calls a script's function in place of a built-in of the same name, so the scripts never reach that built-in.
    const files = sharedAhkFiles()
    expect(files).toContain('ahk/commands/power.ahk')
    expect(files).toContain('ahk/lib/io.ahk')
    const defined = files.flatMap((p) => LANGUAGES.ahk.findFunctions(readRepoText(p)).map((fn) => fn.name))
    expect(defined).toContain('Shutdown')
    expect(defined.filter((name) => entryOf(name))).toEqual([])
  })

  it('has an entry for every function ahk-builtins.md names, or says why not', () => {
    const named = builtinMap().flatMap((row) => row.names)
    expect(named.length).toBeGreaterThan(100)
    expect(named.filter((n) => !entryOf(n) && !(n in NO_ENTRY))).toEqual([])
    // The list of reasons stays true: each is a name of the table, and has no entry.
    expect(Object.keys(NO_ENTRY).filter((n) => !named.includes(n) || entryOf(n))).toEqual([])
  })

  it('names what the PowerShell version uses as ahk-builtins.md says, and nothing for what it lacks', () => {
    const rows = builtinMap()
    const rowOf = new Map(rows.flatMap((row) => row.names.map((n) => [n.toLowerCase(), row] as const)))
    const wrong = entries.filter((e) => {
      const row = rowOf.get(e.fn.name.toLowerCase())
      if (!row || row.kind === 'not ported') return e.powershell !== null
      if (e.powershell === null) return row.kind === 'port'
      return e.powershell.split(', ').some((part) => !row.powershell.includes(part))
    })
    expect(wrong.map((e) => [e.fn.name, e.powershell])).toEqual([])
  })

  it('gives Send the fullest entry: its symbols, key names, holding keys, raw text and repeats', () => {
    const send = entryOf('Send')!
    expect(send.group).toBe('Keys and mouse')
    expect(Math.max(...entries.map((e) => e.fn.doc.examples.length))).toBe(send.fn.doc.examples.length)
    const text = [send.fn.doc.summary, ...send.fn.doc.params.map((p) => p.text), ...send.fn.doc.examples].join('\n')
    for (const part of ['^', '!', '+', '#', '<', '>', '{Enter}', '{Tab}', '{Esc}', ' down}', ' up}', '{Raw}', '{Text}', '{Left 3}']) {
      expect(text).toContain(part)
    }
  })
})
