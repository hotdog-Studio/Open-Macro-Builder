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
}

/** A command takes exactly one parameter, named Macro in any case. */
export const isCommand = (f: FunctionInfo): boolean =>
  f.params.length === 1 && f.params[0].toLowerCase() === 'macro'
