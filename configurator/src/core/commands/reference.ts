import { LANGUAGES, type FunctionInfo, type LangId } from '../languages'

/** The headings of the reference's groups, in the order the list shows them. */
export const REFERENCE_GROUPS = [
  'Keys and mouse',
  'Windows',
  'Programs and files',
  'Text',
  'The clipboard',
  'Screen, pixels and images',
  'Sound',
  'Waiting and timing',
  'Messages and dialogs',
  'Other',
] as const

/** Where AutoHotkey v2's documentation starts; every entry's page is under it. */
export const AHK_DOCS = 'https://www.autohotkey.com/docs/v2/'

/** One function of a bundled reference: its docs, and what the tags of its doc block add to them. */
export interface ReferenceEntry {
  fn: FunctionInfo
  /** `@group`: the heading it is listed under; '' when the block names none. */
  group: string
  /** `@see`: the address of its page in the language's own documentation; '' when the block names none. */
  page: string
  /** `@powershell`: what the PowerShell version uses in its place; null when the block names nothing. */
  powershell: string | null
}

/** A bundled reference of one language's own functions: a second source of dictionary entries, behind the folder's. */
export interface Reference {
  lang: LangId
  entries: ReferenceEntry[]
}

/** The tags the reference adds to a doc block. */
const TAGS = new Set(['group', 'see', 'powershell'])
/** The line that opens a doc block. */
const OPENS = /^\s*\/\*\*/

/** The name and the text of a line of a doc block that is one of TAGS, `* @name text`; null for any other line. */
function tagOf(line: string): [string, string] | null {
  const body = line.trim().replace(/^\*/, '').trim()
  const space = body.search(/\s/)
  if (!body.startsWith('@') || space === -1) return null
  const name = body.slice(1, space)
  return TAGS.has(name) ? [name, body.slice(space).trim()] : null
}

/** The `@group`, `@see` and `@powershell` tags of the doc block ending on the line above 1-based line `line`; the first of each counts. */
function tagsAbove(lines: string[], line: number): Map<string, string> {
  const tags = new Map<string, string>()
  // The block is read upwards, so a later tag of a name is replaced by an earlier one.
  for (let i = line - 2; i >= 0; i--) {
    const tag = tagOf(lines[i])
    if (tag) tags.set(...tag)
    if (OPENS.test(lines[i])) break
  }
  return tags
}

/** Where a group comes in the list: its place in REFERENCE_GROUPS, and after them all for a heading not there. */
const groupOrder = (group: string): number => {
  const at = (REFERENCE_GROUPS as readonly string[]).indexOf(group)
  return at === -1 ? REFERENCE_GROUPS.length : at
}

/**
 * The entries of an AutoHotkey declarations file: each function with a doc block, read by the parser
 * that reads command files, with its tags. Ordered by group as REFERENCE_GROUPS lists them, and in the
 * file's order within a group.
 */
export function readReference(text: string): ReferenceEntry[] {
  const lines = text.split('\n')
  const entries = LANGUAGES.ahk
    .findFunctions(text)
    .filter((fn) => fn.doc.form === 'block')
    .map((fn) => {
      const tags = tagsAbove(lines, fn.line)
      return { fn, group: tags.get('group') ?? '', page: tags.get('see') ?? '', powershell: tags.get('powershell') ?? null }
    })
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => groupOrder(a.entry.group) - groupOrder(b.entry.group) || a.i - b.i)
    .map(({ entry }) => entry)
}
