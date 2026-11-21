import { isCommand, LANG_IDS, LANGUAGES, type CommandFile, type FunctionInfo, type LangId, type LibraryFile } from '../languages'
import type { Reference, ReferenceEntry } from './reference'

/**
 * Where an entry comes from: a file of the folder, at a line; or a bundled reference of the
 * language's own functions, with the address of the function's page and what the PowerShell
 * version uses in its place (null when it says nothing).
 */
export type DictSource =
  | { kind: 'file'; path: string; line: number }
  | { kind: 'reference'; page: string; powershell: string | null }

export interface DictGroup {
  /** `shown:<group>:<pair>`, `yours:<pair>`, `shared:<pair>`, `library:<path>` or `reference:<heading>`. */
  key: string
  kind: 'shown' | 'yours' | 'shared' | 'library' | 'reference'
  /**
   * A command file's pair name, with ` · yours` or ` · shared` when a pair of the other group has
   * the same name; a library file's title; a reference group's heading.
   */
  label: string
  /** `lib/<name>` for a library file; null otherwise. */
  file: string | null
}

export interface DictEntry {
  /**
   * Names the entry among every entry of every build: its source, its name ignoring case, and how
   * many entries of that source and name come before it. A line moved by an edit keeps it.
   */
  id: string
  fn: FunctionInfo
  lang: LangId
  command: boolean
  /** Its own summary, else its twin's, else ''. */
  summary: string
  /** The language of the twin the summary is from; null when it is its own or empty. */
  borrowed: LangId | null
  source: DictSource
  group: DictGroup
}

export interface Dictionary {
  lang: LangId
  /** In the order names resolve: the shown file, yours, shared, the library, the reference. */
  entries: DictEntry[]
  /** Ignores case; the first entry in that order. */
  lookup(name: string): DictEntry | undefined
  /** Ignores case; the first entry of that name defined in the file at `path`. Never a reference entry. */
  lookupIn(path: string, name: string): DictEntry | undefined
}

export interface DictInput {
  lang: LangId
  /** The path of the shown file; null when the pair has none in this language. */
  shown: string | null
  commandFiles: CommandFile[]
  libraryFiles: LibraryFile[]
  /** Unsaved text by path. */
  drafts: Record<string, string>
  /** A bundled reference of a language's own functions; used when it is of `lang`. None when left out. */
  reference?: Reference
}

export interface ListGroup {
  group: DictGroup
  entries: DictEntry[]
}

export interface ListSections {
  functions: ListGroup[]
  commands: ListGroup[]
  /** The groups of the bundled reference, in its order. */
  reference: ListGroup[]
}

/** Reads the functions of a text in a language. */
type Parse = (lang: LangId, text: string) => FunctionInfo[]

/** A parse that reads each text once per language, for as long as the cache is kept. */
export interface ParseCache {
  parse: Parse
  /** Forgets every text but the unsaved texts in `drafts`, the only texts a build parses. */
  keep(drafts: Record<string, string>): void
}

export function parseCache(): ParseCache {
  const cache = new Map<string, FunctionInfo[]>()
  const textOf = (key: string) => key.slice(key.indexOf('\0') + 1)
  return {
    parse(lang, text) {
      const key = `${lang}\0${text}`
      let found = cache.get(key)
      if (!found) {
        found = LANGUAGES[lang].findFunctions(text)
        cache.set(key, found)
      }
      return found
    },
    keep(drafts) {
      const texts = new Set(Object.values(drafts))
      for (const key of cache.keys()) if (!texts.has(textOf(key))) cache.delete(key)
    },
  }
}

/** The functions of a command file, from its unsaved text when it has some. */
function functionsOf(file: CommandFile, drafts: Record<string, string>, parse: Parse): FunctionInfo[] {
  const draft = drafts[file.file.path]
  return draft === undefined ? file.functions : parse(file.lang, draft)
}

/** The summary of the same-named function in the other language's file of the pair, and that language. */
function twinSummary(
  file: CommandFile,
  fn: FunctionInfo,
  input: DictInput,
  parse: Parse,
): { summary: string; lang: LangId } | null {
  const lower = fn.name.toLowerCase()
  for (const lang of LANG_IDS) {
    if (lang === file.lang) continue
    const twin = input.commandFiles.find((f) => f.lang === lang && f.group === file.group && f.pair === file.pair)
    const same = twin && functionsOf(twin, input.drafts, parse).find((f) => f.name.toLowerCase() === lower)
    if (same && same.doc.summary !== '') return { summary: same.doc.summary, lang }
  }
  return null
}

/** An entry before buildDictionary gives it its id. */
type Unnamed = Omit<DictEntry, 'id'>

function commandEntries(input: DictInput, file: CommandFile, shown: boolean, label: string, parse: Parse): Unnamed[] {
  // The shown group is keyed by its file, so the state a list keeps for it stays with that file.
  const group: DictGroup = shown
    ? { key: `shown:${file.group}:${file.pair}`, kind: 'shown', label, file: null }
    : { key: `${file.group}:${file.pair}`, kind: file.group, label, file: null }
  return functionsOf(file, input.drafts, parse).map((fn) => {
    const command = isCommand(fn)
    const twin = command && fn.doc.summary === '' ? twinSummary(file, fn, input, parse) : null
    return {
      fn,
      lang: file.lang,
      command,
      summary: twin ? twin.summary : fn.doc.summary,
      borrowed: twin ? twin.lang : null,
      source: { kind: 'file', path: file.file.path, line: fn.line },
      group,
    }
  })
}

function libraryEntries(file: LibraryFile): Unnamed[] {
  const folder = file.path.split('/').at(-2)
  const group: DictGroup = {
    key: `library:${file.path}`,
    kind: 'library',
    label: file.title,
    file: `${folder}/${file.name}`,
  }
  return file.functions.map((fn) => ({
    fn,
    lang: file.lang,
    command: false,
    summary: fn.doc.summary,
    borrowed: null,
    source: { kind: 'file', path: file.path, line: fn.line },
    group,
  }))
}

function referenceEntry(lang: LangId, { fn, group, page, powershell }: ReferenceEntry): Unnamed {
  return {
    fn,
    lang,
    command: false,
    summary: fn.doc.summary,
    borrowed: null,
    source: { kind: 'reference', page, powershell },
    group: { key: `reference:${group}`, kind: 'reference', label: group, file: null },
  }
}

/** What names a source in an id: a file by its path; the reference by itself, as a name is in it once. */
const sourceKey = (source: DictSource) => (source.kind === 'file' ? `file:${source.path}` : 'reference')

/** The entries with their ids: the second entry of a name in one source is numbered 1, and so on. */
function withIds(entries: Unnamed[]): DictEntry[] {
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    const base = `${sourceKey(entry.source)}\0${entry.fn.name.toLowerCase()}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { ...entry, id: `${base}\0${n}` }
  })
}

/** A command file group's heading: its pair name, with its group when the other group has a pair of that name. */
function groupLabels(files: CommandFile[]): (file: CommandFile) => string {
  const groups = new Map<string, Set<string>>()
  for (const f of files) {
    const pair = f.pair.toLowerCase()
    groups.set(pair, (groups.get(pair) ?? new Set()).add(f.group))
  }
  return (f) => (groups.get(f.pair.toLowerCase())!.size > 1 ? `${f.pair} · ${f.group}` : f.pair)
}

/** The entries of the input's reference, when it is of the input's language. */
function referenceEntries({ lang, reference }: DictInput): Unnamed[] {
  return reference?.lang === lang ? reference.entries.map((entry) => referenceEntry(lang, entry)) : []
}

/**
 * The dictionary for one language. `cache` parses the drafts: one kept across builds reads a text
 * only once however often the dictionary is built again; by default a draft is parsed once per build.
 */
export function buildDictionary(input: DictInput, cache: ParseCache = parseCache()): Dictionary {
  const own = input.commandFiles.filter((f) => f.lang === input.lang)
  const isShown = (f: CommandFile) => f.file.path === input.shown
  const ordered = [
    ...own.filter(isShown),
    ...own.filter((f) => !isShown(f) && f.group === 'yours'),
    ...own.filter((f) => !isShown(f) && f.group === 'shared'),
  ]
  const label = groupLabels(own)
  const entries = withIds([
    ...ordered.flatMap((f) => commandEntries(input, f, isShown(f), label(f), cache.parse)),
    ...input.libraryFiles.filter((f) => f.lang === input.lang).flatMap(libraryEntries),
    ...referenceEntries(input),
  ])
  const byName = new Map<string, DictEntry>()
  for (const entry of entries) {
    const lower = entry.fn.name.toLowerCase()
    if (!byName.has(lower)) byName.set(lower, entry)
  }
  const lookupIn = (path: string, name: string) => {
    const lower = name.toLowerCase()
    return entries.find((e) => e.source.kind === 'file' && e.source.path === path && e.fn.name.toLowerCase() === lower)
  }
  return { lang: input.lang, entries, lookup: (name) => byName.get(name.toLowerCase()), lookupIn }
}

/** Entries into groups, in the order of the entries; a group without entries does not appear. */
function groupEntries(entries: DictEntry[]): ListGroup[] {
  const groups = new Map<string, ListGroup>()
  for (const entry of entries) {
    const found = groups.get(entry.group.key)
    if (found) found.entries.push(entry)
    else groups.set(entry.group.key, { group: entry.group, entries: [entry] })
  }
  return [...groups.values()]
}

export function listSections(dict: Dictionary): ListSections {
  const own = dict.entries.filter((e) => e.group.kind !== 'reference')
  return {
    functions: groupEntries(own.filter((e) => !e.command && e.fn.doc.form === 'block')),
    commands: groupEntries(own.filter((e) => e.command && e.group.kind !== 'shown')),
    reference: groupEntries(dict.entries.filter((e) => e.group.kind === 'reference')),
  }
}

/** Keeps the entries whose name or summary contains `query` as plain text, ignoring case; drops empty groups. */
export function filterSections(sections: ListSections, query: string): ListSections {
  const needle = query.trim().toLowerCase()
  if (needle === '') return sections
  const keep = (e: DictEntry) => e.fn.name.toLowerCase().includes(needle) || e.summary.toLowerCase().includes(needle)
  const filter = (groups: ListGroup[]) =>
    groups
      .map((g) => ({ group: g.group, entries: g.entries.filter(keep) }))
      .filter((g) => g.entries.length > 0)
  return { functions: filter(sections.functions), commands: filter(sections.commands), reference: filter(sections.reference) }
}

/** Whether a character can be part of a name: ASCII letters, digits and `_`, plus `-` in PowerShell. */
function isNameChar(ch: string | undefined, lang: LangId): boolean {
  if (ch === undefined) return false
  return /^\w$/.test(ch) || (lang === 'ps' && ch === '-')
}

/**
 * Whether the PowerShell name that starts at `from` is a parameter or a variable, not a call:
 * `-Name`, `@Splat`, `${Name}`, or `$scope:Name` (`$env:Path`, `$script:Count`).
 */
function isPsVariable(line: string, from: number, name: string): boolean {
  if (name.startsWith('-')) return true
  const before = line[from - 1]
  if (before === '@') return true
  if (before === '{') return line[from - 2] === '$'
  if (before !== ':') return false
  let i = from - 2
  while (isNameChar(line[i], 'ahk')) i--
  return line[i] === '$'
}

/** The name covering `column` (0-based) of a line, unless it is a variable, a parameter or a member. */
export function nameAt(line: string, column: number, lang: LangId): { from: number; to: number; name: string } | null {
  if (!isNameChar(line[column], lang)) return null
  let from = column
  while (isNameChar(line[from - 1], lang)) from--
  let to = column + 1
  while (isNameChar(line[to], lang)) to++
  const name = line.slice(from, to)
  const before = line[from - 1]
  if (before === '$' || before === '.') return null
  if (lang === 'ps' && (line.slice(Math.max(0, from - 2), from) === '::' || isPsVariable(line, from, name))) return null
  return { from, to, name }
}

/** `<path> · line <n>` for a file; the page's address for the reference. */
export function sourceText(source: DictSource): string {
  return source.kind === 'file' ? `${source.path} · line ${source.line}` : source.page
}
