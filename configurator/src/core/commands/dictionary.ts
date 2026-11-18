import { isCommand, LANG_IDS, LANGUAGES, type CommandFile, type FunctionInfo, type LangId, type LibraryFile } from '../languages'

/** Where an entry comes from. The follow-up adds a bundled reference as a second kind. */
export type DictSource = { kind: 'file'; path: string; line: number }

export interface DictGroup {
  /** `shown`, `yours:<pair>`, `shared:<pair>` or `library:<path>`. */
  key: string
  kind: 'shown' | 'yours' | 'shared' | 'library'
  /** A command file's pair name; a library file's title. */
  label: string
  /** `lib/<name>` for a library file; null otherwise. */
  file: string | null
}

export interface DictEntry {
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
  /** In the order names resolve: the shown file, yours, shared, the library. */
  entries: DictEntry[]
  /** Ignores case; the first entry in that order. */
  lookup(name: string): DictEntry | undefined
}

export interface DictInput {
  lang: LangId
  /** The path of the shown file; null when the pair has none in this language. */
  shown: string | null
  commandFiles: CommandFile[]
  libraryFiles: LibraryFile[]
  /** Unsaved text by path. */
  drafts: Record<string, string>
}

export interface ListGroup {
  group: DictGroup
  entries: DictEntry[]
}

export interface ListSections {
  functions: ListGroup[]
  commands: ListGroup[]
}

/** The functions of a command file, from its unsaved text when it has some. */
function functionsOf(file: CommandFile, drafts: Record<string, string>): FunctionInfo[] {
  const draft = drafts[file.file.path]
  return draft === undefined ? file.functions : LANGUAGES[file.lang].findFunctions(draft)
}

/** The summary of the same-named function in the other language's file of the pair, and that language. */
function twinSummary(
  file: CommandFile,
  fn: FunctionInfo,
  commandFiles: CommandFile[],
  drafts: Record<string, string>,
): { summary: string; lang: LangId } | null {
  const lower = fn.name.toLowerCase()
  for (const lang of LANG_IDS) {
    if (lang === file.lang) continue
    const twin = commandFiles.find((f) => f.lang === lang && f.group === file.group && f.pair === file.pair)
    const same = twin && functionsOf(twin, drafts).find((f) => f.name.toLowerCase() === lower)
    if (same && same.doc.summary !== '') return { summary: same.doc.summary, lang }
  }
  return null
}

function commandEntries(input: DictInput, file: CommandFile, shown: boolean): DictEntry[] {
  const group: DictGroup = shown
    ? { key: 'shown', kind: 'shown', label: file.pair, file: null }
    : { key: `${file.group}:${file.pair}`, kind: file.group, label: file.pair, file: null }
  return functionsOf(file, input.drafts).map((fn) => {
    const command = isCommand(fn)
    const twin = command && fn.doc.summary === '' ? twinSummary(file, fn, input.commandFiles, input.drafts) : null
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

function libraryEntries(file: LibraryFile): DictEntry[] {
  const folder = file.path.split('/').slice(-2, -1)[0]
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

export function buildDictionary(input: DictInput): Dictionary {
  const own = input.commandFiles.filter((f) => f.lang === input.lang)
  const isShown = (f: CommandFile) => f.file.path === input.shown
  const ordered = [
    ...own.filter(isShown),
    ...own.filter((f) => !isShown(f) && f.group === 'yours'),
    ...own.filter((f) => !isShown(f) && f.group === 'shared'),
  ]
  const entries = [
    ...ordered.flatMap((f) => commandEntries(input, f, isShown(f))),
    ...input.libraryFiles.filter((f) => f.lang === input.lang).flatMap(libraryEntries),
  ]
  const byName = new Map<string, DictEntry>()
  for (const entry of entries) {
    const lower = entry.fn.name.toLowerCase()
    if (!byName.has(lower)) byName.set(lower, entry)
  }
  return { lang: input.lang, entries, lookup: (name) => byName.get(name.toLowerCase()) }
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
  return {
    functions: groupEntries(dict.entries.filter((e) => !e.command && e.fn.doc.form === 'block')),
    commands: groupEntries(dict.entries.filter((e) => e.command && e.group.kind !== 'shown')),
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
  return { functions: filter(sections.functions), commands: filter(sections.commands) }
}

/** Whether a character can be part of a name: ASCII letters, digits and `_`, plus `-` in PowerShell. */
function isNameChar(ch: string | undefined, lang: LangId): boolean {
  if (ch === undefined) return false
  return /^\w$/.test(ch) || (lang === 'ps' && ch === '-')
}

/** The name covering `column` (0-based) of a line, unless it is a variable or a member. */
export function nameAt(line: string, column: number, lang: LangId): { from: number; to: number; name: string } | null {
  if (!isNameChar(line[column], lang)) return null
  let from = column
  while (isNameChar(line[from - 1], lang)) from--
  let to = column + 1
  while (isNameChar(line[to], lang)) to++
  const before = line[from - 1]
  if (before === '$' || before === '.') return null
  if (lang === 'ps' && line.slice(Math.max(0, from - 2), from) === '::') return null
  return { from, to, name: line.slice(from, to) }
}

/** `<path> · line <n>` */
export function sourceText(source: DictSource): string {
  return `${source.path} · line ${source.line}`
}
