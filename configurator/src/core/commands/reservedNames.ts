/**
 * What a command cannot be called, because AutoHotkey already uses the name. A command has the same
 * name in the AutoHotkey and the PowerShell version, so the name is refused whichever language the
 * file is in. This file imports nothing: the bundled reference (ahkReference.ts) stays a chunk of
 * its own.
 */

/**
 * The words AutoHotkey reserves: "Reserved words" and the declaration keywords and control flow
 * names after it, at https://www.autohotkey.com/docs/v2/Concepts.htm#names (read 2026-11-26).
 * Lower case. A command with one of these names does not load.
 */
export const AHK_RESERVED_WORDS: readonly string[] = [
  'and', 'as', 'break', 'case', 'catch', 'contains', 'continue', 'else', 'false', 'finally', 'for', 'global', 'goto',
  'if', 'in', 'is', 'isset', 'local', 'loop', 'not', 'or', 'return', 'static', 'super', 'switch', 'throw', 'true',
  'try', 'unset', 'until', 'while',
]

/**
 * AutoHotkey's own functions and classes: every function of the alphabetical index at
 * https://www.autohotkey.com/docs/v2/lib/index.htm and every class of
 * https://www.autohotkey.com/docs/v2/ObjList.htm (read 2026-11-26), sorted and in lower case.
 * Directives, `A_` variables, control flow (see AHK_RESERVED_WORDS) and the names of a class's
 * members (`Gui.Button`) are left out. A command with one of these names hides the function for
 * every other command, or does not load.
 */
export const AHK_BUILTINS: readonly string[] = [
  'abs', 'acos', 'any', 'array', 'asin', 'atan', 'blockinput', 'boundfunc', 'buffer', 'callbackcreate', 'callbackfree',
  'caretgetpos', 'ceil', 'chr', 'class', 'click', 'clipboardall', 'clipwait', 'closure', 'comcall', 'comobjactive',
  'comobjarray', 'comobjconnect', 'comobject', 'comobjflags', 'comobjfromptr', 'comobjget', 'comobjquery',
  'comobjtype', 'comobjvalue', 'comvalue', 'comvalueref', 'controladditem', 'controlchooseindex',
  'controlchoosestring', 'controlclick', 'controldeleteitem', 'controlfinditem', 'controlfocus', 'controlgetchecked',
  'controlgetchoice', 'controlgetclassnn', 'controlgetenabled', 'controlgetexstyle', 'controlgetfocus',
  'controlgethwnd', 'controlgetindex', 'controlgetitems', 'controlgetpos', 'controlgetstyle', 'controlgettext',
  'controlgetvisible', 'controlhide', 'controlhidedropdown', 'controlmove', 'controlsend', 'controlsendtext',
  'controlsetchecked', 'controlsetenabled', 'controlsetexstyle', 'controlsetstyle', 'controlsettext', 'controlshow',
  'controlshowdropdown', 'coordmode', 'cos', 'critical', 'dateadd', 'datediff', 'detecthiddentext',
  'detecthiddenwindows', 'dircopy', 'dircreate', 'dirdelete', 'direxist', 'dirmove', 'dirselect', 'dllcall',
  'download', 'driveeject', 'drivegetcapacity', 'drivegetfilesystem', 'drivegetlabel', 'drivegetlist',
  'drivegetserial', 'drivegetspacefree', 'drivegetstatus', 'drivegetstatuscd', 'drivegettype', 'drivelock',
  'driveretract', 'drivesetlabel', 'driveunlock', 'edit', 'editgetcurrentcol', 'editgetcurrentline', 'editgetline',
  'editgetlinecount', 'editgetselectedtext', 'editpaste', 'enumerator', 'envget', 'envset', 'error', 'exit', 'exitapp',
  'exp', 'file', 'fileappend', 'filecopy', 'filecreateshortcut', 'filedelete', 'fileencoding', 'fileexist',
  'filegetattrib', 'filegetshortcut', 'filegetsize', 'filegettime', 'filegetversion', 'fileinstall', 'filemove',
  'fileopen', 'fileread', 'filerecycle', 'filerecycleempty', 'fileselect', 'filesetattrib', 'filesettime', 'float',
  'floor', 'format', 'formattime', 'func', 'getkeyname', 'getkeysc', 'getkeystate', 'getkeyvk', 'getmethod',
  'groupactivate', 'groupadd', 'groupclose', 'groupdeactivate', 'gui', 'guictrlfromhwnd', 'guifromhwnd', 'hasbase',
  'hasmethod', 'hasprop', 'hotif', 'hotifwinactive', 'hotifwinexist', 'hotifwinnotactive', 'hotifwinnotexist',
  'hotkey', 'hotstring', 'il_add', 'il_create', 'il_destroy', 'imagesearch', 'indexerror', 'inidelete', 'iniread',
  'iniwrite', 'inputbox', 'inputhook', 'installkeybdhook', 'installmousehook', 'instr', 'integer', 'islabel',
  'isobject', 'issetref', 'keyhistory', 'keywait', 'listhotkeys', 'listlines', 'listvars', 'listviewgetcontent', 'ln',
  'loadpicture', 'log', 'ltrim', 'map', 'max', 'membererror', 'memoryerror', 'menu', 'menubar', 'menufromhandle',
  'menuselect', 'methoderror', 'min', 'mod', 'monitorget', 'monitorgetcount', 'monitorgetname', 'monitorgetprimary',
  'monitorgetworkarea', 'mouseclick', 'mouseclickdrag', 'mousegetpos', 'mousemove', 'msgbox', 'number', 'numget',
  'numput', 'objaddref', 'objbindmethod', 'object', 'objfromptr', 'objfromptraddref', 'objgetbase', 'objgetcapacity',
  'objhasownprop', 'objownpropcount', 'objownprops', 'objptr', 'objptraddref', 'objrelease', 'objsetbase',
  'objsetcapacity', 'onclipboardchange', 'onerror', 'onexit', 'onmessage', 'ord', 'oserror', 'outputdebug', 'pause',
  'persistent', 'pixelgetcolor', 'pixelsearch', 'postmessage', 'primitive', 'processclose', 'processexist',
  'processgetname', 'processgetparent', 'processgetpath', 'processsetpriority', 'processwait', 'processwaitclose',
  'propertyerror', 'random', 'regcreatekey', 'regdelete', 'regdeletekey', 'regexmatch', 'regexmatchinfo',
  'regexreplace', 'regread', 'regwrite', 'reload', 'round', 'rtrim', 'run', 'runas', 'runwait', 'send', 'sendevent',
  'sendinput', 'sendlevel', 'sendmessage', 'sendmode', 'sendplay', 'sendtext', 'setcapslockstate', 'setcontroldelay',
  'setdefaultmousespeed', 'setkeydelay', 'setmousedelay', 'setnumlockstate', 'setregview', 'setscrolllockstate',
  'setstorecapslockmode', 'settimer', 'settitlematchmode', 'setwindelay', 'setworkingdir', 'shutdown', 'sin', 'sleep',
  'sort', 'soundbeep', 'soundgetinterface', 'soundgetmute', 'soundgetname', 'soundgetvolume', 'soundplay',
  'soundsetmute', 'soundsetvolume', 'splitpath', 'sqrt', 'statusbargettext', 'statusbarwait', 'strcompare', 'strget',
  'string', 'strlen', 'strlower', 'strptr', 'strput', 'strreplace', 'strsplit', 'strtitle', 'strupper', 'substr',
  'suspend', 'sysget', 'sysgetipaddresses', 'tan', 'targeterror', 'thread', 'timeouterror', 'tooltip', 'trayseticon',
  'traytip', 'trim', 'type', 'typeerror', 'unseterror', 'unsetitemerror', 'valueerror', 'varref', 'varsetstrcapacity',
  'vercompare', 'winactivate', 'winactivatebottom', 'winactive', 'winclose', 'winexist', 'wingetclass',
  'wingetclientpos', 'wingetcontrols', 'wingetcontrolshwnd', 'wingetcount', 'wingetexstyle', 'wingetid',
  'wingetidlast', 'wingetlist', 'wingetminmax', 'wingetpid', 'wingetpos', 'wingetprocessname', 'wingetprocesspath',
  'wingetstyle', 'wingettext', 'wingettitle', 'wingettranscolor', 'wingettransparent', 'winhide', 'winkill',
  'winmaximize', 'winminimize', 'winminimizeall', 'winminimizeallundo', 'winmove', 'winmovebottom', 'winmovetop',
  'winredraw', 'winrestore', 'winsetalwaysontop', 'winsetenabled', 'winsetexstyle', 'winsetregion', 'winsetstyle',
  'winsettitle', 'winsettranscolor', 'winsettransparent', 'winshow', 'winwait', 'winwaitactive', 'winwaitclose',
  'winwaitnotactive', 'zerodivisionerror',
]

const WORDS = new Set(AHK_RESERVED_WORDS)
const BUILTINS = new Set(AHK_BUILTINS)

/**
 * Why AutoHotkey already uses `name`, ignoring case: 'word' for a reserved word, 'builtin' for one
 * of its own functions or classes, null when the name is free.
 */
export function reservedAs(name: string): 'word' | 'builtin' | null {
  const lower = name.toLowerCase()
  if (WORDS.has(lower)) return 'word'
  return BUILTINS.has(lower) ? 'builtin' : null
}
