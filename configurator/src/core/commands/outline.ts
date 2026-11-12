import { isCommand, LANG_IDS, LANGUAGES, type LangId } from '../languages'

export interface OutlineEntry {
  name: string
  in: Partial<Record<LangId, { line: number; description: string }>>
}

/** The texts of one file pair; a language without a file has none. */
export type PairTexts = Partial<Record<LangId, string>>

/** A same-named function that is not a command because of its parameter. */
export interface ParamMismatch {
  lang: LangId
  name: string
  line: number
  param: string
}

/**
 * The commands of each language's text. Names match ignoring case and the first spelling wins.
 * Entries follow the lines of the first language that has them; names only in later languages
 * come after, by their lines.
 */
export function pairOutline(texts: PairTexts): OutlineEntry[] {
  const entries = new Map<string, OutlineEntry>()
  for (const lang of LANG_IDS) {
    const text = texts[lang]
    if (text === undefined) continue
    for (const fn of LANGUAGES[lang].findFunctions(text)) {
      if (!isCommand(fn)) continue
      const id = fn.name.toLowerCase()
      let entry = entries.get(id)
      if (!entry) {
        entry = { name: fn.name, in: {} }
        entries.set(id, entry)
      }
      entry.in[lang] ??= { line: fn.line, description: fn.description }
    }
  }
  return [...entries.values()]
}

/**
 * For each outline name missing in a language whose text is given: the function of that name
 * there with exactly one parameter that is not Macro.
 */
export function paramMismatches(texts: PairTexts): ParamMismatch[] {
  const found: ParamMismatch[] = []
  for (const entry of pairOutline(texts)) {
    for (const lang of LANG_IDS) {
      const text = texts[lang]
      if (text === undefined || entry.in[lang]) continue
      const lower = entry.name.toLowerCase()
      const fn = LANGUAGES[lang]
        .findFunctions(text)
        .find((f) => f.name.toLowerCase() === lower && f.params.length === 1 && !isCommand(f))
      if (fn) found.push({ lang, name: entry.name, line: fn.line, param: fn.params[0] })
    }
  }
  return found
}
