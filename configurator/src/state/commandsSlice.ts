import { commandPairs, type CommandPair } from '../core/commands/pairs'
import { commandCatalog, mergeRescan, withCommandFile, type CommandFile, type LangId } from '../core/languages'
import type { Settings } from '../core/settings'
import type { TextFile } from '../core/folder/textFile'
import type { EditCore } from './store'

/** The dialog of a command file save that is open, if any. */
export type CommandDialog =
  /** The file changed on disk since it was loaded; nothing was written. */
  | { kind: 'conflict'; path: string }
  /** Overwrite anyway was chosen and waits for its confirmation. */
  | { kind: 'confirm-overwrite'; path: string }

/** What came of the last save of a file. */
export interface AfterSave {
  /** Counts the saves of the file, so a later save is told apart from an earlier one. */
  n: number
}

/** The Commands tab as the reducer keeps it. */
export interface CommandsView {
  /** CommandPair.key shown; null shows the first pair. */
  pair: string | null
  /** The language shown; starts on the first language you run. */
  lang: LangId
  /** Unsaved text by path; a draft equal to the file's text is dropped. */
  drafts: Record<string, string>
  /** Command files whose disk version differs from the one held. */
  outside: Record<string, { version: string | null; dismissed: boolean }>
  /** Where the editor should jump; `n` changes for every jump. */
  jump: { path: string; line: number; n: number } | null
  dialog: CommandDialog | null
  /** The last save of each path, until the next edit of that file. */
  saved: Record<string, AfterSave>
}

export type CommandAction =
  /** Leaves out a field to keep it. */
  | { type: 'commands-show'; pair?: string; lang?: LangId }
  /**
   * The user's text for a file; also hides its last save. `base` is the version of the text the
   * draft was started on (the actions keep it from the draft's first edit).
   */
  | { type: 'draft'; path: string; text: string; base: string | null }
  /** A save wrote `file`. */
  | { type: 'command-saved'; file: CommandFile }
  /** A reload of one file; null when it is gone. */
  | { type: 'command-file'; path: string; file: CommandFile | null }
  /**
   * A recheck of the folder: the command files as the actions merged them (files with unsaved
   * edits keep theirs), and the kept files whose version on disk differs (null: the file is gone).
   */
  | { type: 'command-files'; files: CommandFile[]; changed: { path: string; version: string | null }[] }
  /** Hides the changed-on-disk banner of a file until it changes again. */
  | { type: 'command-dismiss'; path: string }
  | { type: 'command-dialog'; dialog: CommandDialog | null }
  | { type: 'jump'; path: string; line: number }
  /** Shows the Commands tab on one language of a pair and jumps to a line of that file, in one step. */
  | { type: 'open-command'; pair: string; lang: LangId; line: number }

export function initialCommands(settings: Settings): CommandsView {
  return {
    pair: null,
    lang: settings.languages[0] ?? 'ahk',
    drafts: {},
    outside: {},
    jump: null,
    dialog: null,
    saved: {},
  }
}

/**
 * True when an edit leaves nothing to save: its text is the held file's and it was made on the
 * held version. A draft made on an older version stays even when its text matches, so its save
 * is checked against the version it was made on. The actions and the reducer both use this rule.
 */
export function draftDone(held: TextFile, text: string, base: string | null): boolean {
  return text === held.text && base === held.version
}

/** A copy of `record` without `key`. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

/** The command files and their catalog, with the entry for `path` replaced or removed. */
function withFile(state: EditCore, path: string, file: CommandFile | null): Pick<EditCore, 'commandFiles' | 'catalog'> {
  const commandFiles = withCommandFile(state.commandFiles, path, file)
  return { commandFiles, catalog: commandCatalog(commandFiles) }
}

/**
 * The command files after a read of the whole folder (config.json's Reload from disk). `before`
 * is the app's copy when the read started and `now` its copy after it. A file with unsaved edits
 * keeps the entry it was edited on. So does a file the app saved, reloaded, created or removed
 * during the read, because the read may have seen it as it was before. Every other file takes
 * its fresh entry.
 */
export function mergeAfterRead(
  before: CommandFile[],
  now: CommandFile[],
  fresh: CommandFile[],
  draftPaths: string[],
): CommandFile[] {
  const was = new Map(before.map((f) => [f.file.path, f]))
  const is = new Map(now.map((f) => [f.file.path, f]))
  const touched = [...new Set([...was.keys(), ...is.keys()])].filter((path) => was.get(path) !== is.get(path))
  const gone = new Set(touched.filter((path) => !is.has(path)))
  const kept = fresh.filter((f) => !gone.has(f.file.path))
  return mergeRescan(now, kept, new Set([...draftPaths, ...touched])).files
}

/** The pair the tab shows: the chosen one, else the first. */
export function shownPair(pairs: CommandPair[], key: string | null): CommandPair | undefined {
  return pairs.find((p) => p.key === key) ?? pairs[0]
}

/** The path of the file the tab shows, if the chosen language has one. */
function shownPath(files: CommandFile[], key: string | null, lang: LangId): string | undefined {
  return shownPair(commandPairs(files), key)?.files[lang]?.file.path
}

export function commandsReducer(state: EditCore, action: CommandAction): EditCore {
  const c = state.commands
  switch (action.type) {
    case 'commands-show': {
      const pair = action.pair ?? c.pair
      const lang = action.lang ?? c.lang
      // A jump belongs to the file it was made for; another file must not take it up later.
      const same = shownPath(state.commandFiles, pair, lang) === shownPath(state.commandFiles, c.pair, c.lang)
      const jump = same ? c.jump : null
      return { ...state, commands: { ...c, pair, lang, jump } }
    }
    case 'draft': {
      const file = state.commandFiles.find((f) => f.file.path === action.path)
      // A file that is gone or not UTF-8 is never edited.
      if (!file?.editable) return state
      const done = draftDone(file.file, action.text, action.base)
      const drafts = done ? without(c.drafts, action.path) : { ...c.drafts, [action.path]: action.text }
      // An edit made on an older version than the one held (it raced a quiet replace): the file
      // differs from what the edit was made on, so it is marked changed on disk.
      const version = file.file.version
      const stale = !done && action.base !== version && c.outside[action.path]?.version !== version
      const outside = stale ? { ...c.outside, [action.path]: { version, dismissed: false } } : c.outside
      return { ...state, commands: { ...c, drafts, outside, saved: without(c.saved, action.path) } }
    }
    case 'command-saved': {
      const path = action.file.file.path
      // The user may have typed during the write: only a draft equal to what was written is done.
      const drafts = c.drafts[path] === action.file.file.text ? without(c.drafts, path) : c.drafts
      return {
        ...state,
        ...withFile(state, path, action.file),
        commands: {
          ...c,
          drafts,
          // The disk now holds what the app wrote.
          outside: without(c.outside, path),
          saved: { ...c.saved, [path]: { n: (c.saved[path]?.n ?? 0) + 1 } },
        },
      }
    }
    case 'command-file':
      return {
        ...state,
        ...withFile(state, action.path, action.file),
        commands: {
          ...c,
          drafts: without(c.drafts, action.path),
          outside: without(c.outside, action.path),
          dialog: c.dialog?.path === action.path ? null : c.dialog,
          // A file that is gone no longer has a last save to report.
          saved: action.file ? c.saved : without(c.saved, action.path),
        },
      }
    case 'command-files': {
      // Only the files that still differ keep an entry; the same outside version again keeps its banner as it is.
      const outside: CommandsView['outside'] = {}
      for (const { path, version } of action.changed) {
        const was = c.outside[path]
        outside[path] = was?.version === version ? was : { version, dismissed: false }
      }
      return {
        ...state,
        commandFiles: action.files,
        catalog: commandCatalog(action.files),
        commands: { ...c, outside },
      }
    }
    case 'command-dismiss': {
      const was = c.outside[action.path]
      if (!was) return state
      return { ...state, commands: { ...c, outside: { ...c.outside, [action.path]: { ...was, dismissed: true } } } }
    }
    case 'command-dialog':
      return { ...state, commands: { ...c, dialog: action.dialog } }
    case 'jump':
      return { ...state, commands: { ...c, jump: { path: action.path, line: action.line, n: (c.jump?.n ?? 0) + 1 } } }
    case 'open-command': {
      const path = shownPath(state.commandFiles, action.pair, action.lang)
      const jump = path === undefined ? null : { path, line: action.line, n: (c.jump?.n ?? 0) + 1 }
      return { ...state, tab: 'commands', commands: { ...c, pair: action.pair, lang: action.lang, jump } }
    }
  }
}
