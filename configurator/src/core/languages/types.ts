export type LangId = 'ahk' | 'ps'

export interface FunctionInfo {
  name: string
  /** 1-based line of the definition. */
  line: number
  params: string[]
  description: string
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
  findFunctions(text: string): FunctionInfo[]
  /**
   * Renames the parameter of `fn` to `to`: on its definition line and, as a whole word, in its
   * uses from that line up to the next function definition this plug-in finds (or the end of
   * the file). Nothing else changes.
   */
  renameParam(text: string, fn: FunctionInfo, to: string): string
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
