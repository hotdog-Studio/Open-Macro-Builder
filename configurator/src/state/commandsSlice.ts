import { commandCatalog, mergeRescan, withCommandFile, type CommandFile, type LangId } from '../core/languages'
import type { Settings } from '../core/settings'
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
  /** The user's text for a file; also hides its last save. */
  | { type: 'draft'; path: string; text: string }
  /** A save wrote `file`. */
  | { type: 'command-saved'; file: CommandFile }
  /** A reload of one file; null when it is gone. */
  | { type: 'command-file'; path: string; file: CommandFile | null }
  | { type: 'command-dialog'; dialog: CommandDialog | null }
  | { type: 'jump'; path: string; line: number }

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
 * The command files after Reload from disk of config.json: files with unsaved edits keep
 * the entry they were edited on, every other file takes the fresh one.
 */
export function mergeReloaded(held: CommandFile[], fresh: CommandFile[], draftPaths: string[]): CommandFile[] {
  return mergeRescan(held, fresh, new Set(draftPaths)).files
}

export function commandsReducer(state: EditCore, action: CommandAction): EditCore {
  const c = state.commands
  switch (action.type) {
    case 'commands-show': {
      const pair = action.pair ?? c.pair
      const lang = action.lang ?? c.lang
      // A jump belongs to the file it was made for; another file must not take it up later.
      const jump = pair === c.pair && lang === c.lang ? c.jump : null
      return { ...state, commands: { ...c, pair, lang, jump } }
    }
    case 'draft': {
      const file = state.commandFiles.find((f) => f.file.path === action.path)
      // A file that is gone or not UTF-8 is never edited.
      if (!file?.editable) return state
      const drafts =
        action.text === file.file.text ? without(c.drafts, action.path) : { ...c.drafts, [action.path]: action.text }
      return { ...state, commands: { ...c, drafts, saved: without(c.saved, action.path) } }
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
        },
      }
    case 'command-dialog':
      return { ...state, commands: { ...c, dialog: action.dialog } }
    case 'jump':
      return { ...state, commands: { ...c, jump: { path: action.path, line: action.line, n: (c.jump?.n ?? 0) + 1 } } }
  }
}
