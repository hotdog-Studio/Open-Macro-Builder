import { compareText } from '../folder/path'
import { isCommand, LANG_IDS, type CommandFile, type LangId } from '../languages'

/** The AutoHotkey and PowerShell files that share a name, in one group. */
export interface CommandPair {
  /** `${group}:${pair}` */
  key: string
  group: 'yours' | 'shared'
  pair: string
  files: Partial<Record<LangId, CommandFile>>
}


/** Each file pair once: yours first, then by pair name. */
export function commandPairs(files: CommandFile[]): CommandPair[] {
  const pairs = new Map<string, CommandPair>()
  for (const f of files) {
    const key = `${f.group}:${f.pair}`
    let entry = pairs.get(key)
    if (!entry) {
      entry = { key, group: f.group, pair: f.pair, files: {} }
      pairs.set(key, entry)
    }
    entry.files[f.lang] = f
  }
  const order = (p: CommandPair) => (p.group === 'yours' ? 0 : 1)
  return [...pairs.values()].sort((a, b) => order(a) - order(b) || compareText(a.pair, b.pair))
}

/** How many of the file's functions are commands. */
export function commandCount(file: CommandFile): number {
  return file.functions.filter(isCommand).length
}

/** True when the lower-cased command names differ between the languages; a missing file has none. */
export function languagesDiffer(p: CommandPair): boolean {
  const names = LANG_IDS.map((lang) =>
    (p.files[lang]?.functions ?? [])
      .filter(isCommand)
      .map((f) => f.name.toLowerCase())
      .sort(compareText)
      .join('\n'),
  )
  return names.some((n) => n !== names[0])
}
