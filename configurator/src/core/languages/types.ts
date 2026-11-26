export type LangId = 'ahk' | 'ps'

export interface ParamDoc {
  /** As declared. */
  name: string
  /** The note from the docs on one line; '' when the docs have none. */
  text: string
  /** The type as written, without its outer brackets or braces; '' when none. */
  type: string
  optional: boolean
  /** The default as written; '' when none. */
  default: string
  /** The values of a PowerShell [ValidateSet(...)], unquoted; [] when none. */
  values: string[]
}

export interface FunctionDoc {
  /** 'block': a doc block (AutoHotkey `/** *\/`, PowerShell `<# #>`); 'note': a run of PowerShell `#` lines; 'none'. */
  form: 'block' | 'note' | 'none'
  /** What it does, on one line; '' when the docs do not say. */
  summary: string
  /** One per declared parameter, in declared order. */
  params: ParamDoc[]
  /** On one line; '' when the docs do not say. */
  returns: string
  /** Each as written, its lines kept, blank lines at its ends dropped. */
  examples: string[]
}

export interface FunctionInfo {
  name: string
  /** 1-based line of the definition. */
  line: number
  params: string[]
  /** Always equal to doc.summary. */
  description: string
  usage: string
  doc: FunctionDoc
}

/** The docs of a function that has none: form 'none', a ParamDoc per name with every other field empty. */
export function emptyDoc(params: string[]): FunctionDoc {
  return {
    form: 'none',
    summary: '',
    params: params.map((name) => ({ name, text: '', type: '', optional: false, default: '', values: [] })),
    returns: '',
    examples: [],
  }
}

export interface Language {
  id: LangId
  label: 'AutoHotkey' | 'PowerShell'
  short: 'AHK' | 'PS'
  ext: '.ahk' | '.ps1'
  /** Shared command library, relative to the opened folder. */
  sharedDir: string
  /** The owner's personal commands, relative to the opened folder. */
  personalDir: string
  /** Files under the personal folder that hold no commands (include hubs). */
  ignore: string[]
  /** The folder of functions for commands, relative to the opened folder; null when the language has none. */
  libraryDir: string | null
  /** What starts a comment line. */
  lineComment: '#' | ';'
  findFunctions(text: string): FunctionInfo[]
  /**
   * Renames the parameter of `fn` to `to`: on its definition line and, as a whole word, in its
   * uses from that line up to the next function definition this plug-in finds (or the end of
   * the file). Nothing else changes.
   */
  renameParam(text: string, fn: FunctionInfo, to: string): string
  /** The text of a new command file of the pair: its comment names the file by the last part of the pair, without its folder. */
  starterFile(pair: string): string
  /** A new command with the Macro parameter, without a trailing newline; an empty description leaves out its line. */
  starterCommand(name: string, description: string): string
  /** The include file that must list the command file at `path`; null when the runtime loads every file itself. */
  listedIn(path: string): string | null
  /** Whether the include file's text has a line that loads `path`; always true where listedIn is null. */
  isListed(includeText: string, path: string): boolean
  /**
   * The include file's text with a line that loads `path` (null: the include file does not exist
   * yet). Unchanged when `path` is already listed. Throws when there is no place for the line.
   */
  addListing(includeText: string | null, path: string): string
  /** The include file's text without the lines that load `path`; every other byte stays. */
  removeListing(includeText: string, path: string): string
}

/** A command takes exactly one parameter, named Macro in any case. */
export const isCommand = (f: FunctionInfo): boolean =>
  f.params.length === 1 && f.params[0].toLowerCase() === 'macro'

/**
 * Applies `rewrite` to the lines of `fn`'s body: from its definition line up to, not including, the
 * next function's. `rewrite` gets the line and whether it is the definition line. Line endings stay.
 */
export function rewriteBody(
  text: string,
  fn: FunctionInfo,
  all: FunctionInfo[],
  rewrite: (line: string, isDefinition: boolean) => string,
): string {
  const next = all.find((other) => other.line > fn.line)
  const end = next ? next.line - 1 : Infinity
  return text
    .split('\n')
    .map((line, i) => (i + 1 >= fn.line && i + 1 <= end ? rewrite(line, i + 1 === fn.line) : line))
    .join('\n')
}

/** A description as one line: every whitespace run, line breaks included, becomes one space. */
export const oneLine = (description: string): string => description.replace(/\s+/g, ' ').trim()

/** Lines of a doc block's text on one line. */
export const textOf = (lines: string[]): string => oneLine(lines.join(' '))

/** How many whitespace characters a line starts with. */
const indentOf = (line: string): number => line.length - line.trimStart().length

/**
 * An example of a doc block: the rest of its tag's line, then the lines under it. The first line is
 * trimmed, the blank lines at its ends are dropped, and the indentation its lines share is taken off.
 */
export function exampleOf(tagLines: string[]): string {
  const lines = [tagLines[0].trim(), ...tagLines.slice(1)]
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
  const shared = Math.min(...lines.filter((l) => l.trim() !== '').map(indentOf))
  return lines.map((l) => l.slice(Math.min(shared, indentOf(l)))).join('\n')
}
