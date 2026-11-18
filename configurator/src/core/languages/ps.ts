import { emptyDoc, exampleOf, oneLine, rewriteBody, textOf, type FunctionDoc, type FunctionInfo, type Language, type ParamDoc } from './types'

const DEFINITION = /^\s*function\s+([\w-]+)/i
const PARAM_START = /param\s*\(/i

/**
 * The parameters of the first `param(...)` that starts within the definition
 * line or the next two, never reaching into the following function.
 */
function declaredParams(lines: string[], index: number): ParamDoc[] {
  const window: string[] = [lines[index]]
  for (let i = index + 1; i <= index + 2 && i < lines.length; i++) {
    if (DEFINITION.test(lines[i])) break
    window.push(lines[i])
  }
  const startLine = window.findIndex((l) => PARAM_START.test(l))
  if (startLine === -1) return []
  // Read to the matching close paren, which may be past the three-line window, but an
  // unclosed list stops at the line before the next definition.
  const from = index + startLine + 1
  const next = lines.findIndex((l, i) => i >= from && DEFINITION.test(l))
  const rest = [
    lines[index + startLine].slice(lines[index + startLine].search(PARAM_START)),
    ...lines.slice(from, next === -1 ? lines.length : next),
  ]
  const body = rest.join('\n')
  return splitParams(body.slice(body.indexOf('('))).flatMap((piece) => readParam(piece) ?? [])
}

const QUOTES = `'"`
const PAREN: Record<string, number> = { '(': 1, ')': -1 }
const BRACKET: Record<string, number> = { '[': 1, ']': -1 }

/** Where a read of a parameter list is: in a quoted string or not, and how deep in parens and brackets. */
interface ListScan {
  quote: string
  paren: number
  bracket: number
}

/** What a character is to the list: before it (the open paren), its end (the close paren), a comma between two parameters, or text of one. */
type ListPart = 'before' | 'end' | 'split' | 'text'

/** What the character `ch` is to the list, the scan moved on past it. */
function step(scan: ListScan, ch: string): ListPart {
  if (scan.quote) {
    if (ch === scan.quote) scan.quote = ''
    return 'text'
  }
  if (QUOTES.includes(ch)) scan.quote = ch
  const outside = scan.paren === 0
  scan.paren += PAREN[ch] ?? 0
  scan.bracket += BRACKET[ch] ?? 0
  if (outside) return 'before'
  if (scan.paren === 0) return 'end'
  return ch === ',' && scan.paren === 1 && scan.bracket === 0 ? 'split' : 'text'
}

/** The index just past the comment that starts at `i` (`#` to the end of its line, or `<# ... #>`); `i` when none starts there. */
function commentEnd(list: string, i: number): number {
  if (list.startsWith('<#', i)) {
    const close = list.indexOf('#>', i + 2)
    return close === -1 ? list.length : close + 2
  }
  if (list[i] !== '#') return i
  const eol = list.indexOf('\n', i)
  return eol === -1 ? list.length : eol
}

/**
 * The pieces between the commas of a parameter list. `list` starts at its open paren; what comes
 * after the matching close paren is not read. A comma inside quotes, inner parens or brackets
 * splits nothing, and comments are left out of the pieces.
 */
function splitParams(list: string): string[] {
  const pieces: string[] = []
  const scan: ListScan = { quote: '', paren: 0, bracket: 0 }
  let piece = ''
  let i = 0
  while (i < list.length) {
    const after = scan.quote ? i : commentEnd(list, i)
    if (after > i) {
      i = after
      continue
    }
    const part = step(scan, list[i])
    if (part === 'end') break
    if (part === 'split') {
      pieces.push(piece)
      piece = ''
    } else if (part === 'text') {
      piece += list[i]
    }
    i++
  }
  pieces.push(piece)
  return pieces
}

/** The index of the bracket that closes the group `text` starts with; -1 when it never closes. */
function groupEnd(text: string): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (QUOTES.includes(ch)) quote = ch
    depth += BRACKET[ch] ?? 0
    if (depth === 0) return i
  }
  return -1
}

/**
 * One piece of a parameter list: the bracket groups before its `$` (attributes and the type), the
 * name, and the default after `=`. Null when the piece names no parameter.
 */
function readParam(piece: string): ParamDoc | null {
  const groups: string[] = []
  let rest = piece.trimStart()
  while (rest.startsWith('[')) {
    const end = groupEnd(rest)
    if (end === -1) break
    groups.push(rest.slice(1, end))
    rest = rest.slice(end + 1).trimStart()
  }
  const name = /\$(\w+)/.exec(rest)
  if (!name) return null
  const after = rest.slice(name.index + name[0].length).trimStart()
  // A group with a paren is an attribute; the last one without is the type.
  const type = groups.findLast((g) => !g.includes('('))?.trim() ?? ''
  const values = groups
    .filter((g) => /ValidateSet\s*\(/i.test(g))
    .flatMap((g) => [...g.matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]))
  const def = after.startsWith('=') ? after.slice(1).trim() : ''
  return { name: name[1], text: '', type, optional: def !== '' || type.toLowerCase() === 'switch', default: def, values }
}

const isSwitch = (p: ParamDoc) => p.type.toLowerCase() === 'switch'

/** One parameter as it is passed; `named` once a parameter that can be left out came before it. */
function usagePart(p: ParamDoc, named: boolean): string {
  if (isSwitch(p)) return `[-${p.name}]`
  if (p.default !== '') return `[-${p.name} <${p.type === '' ? 'value' : p.type}>]`
  return named ? `-${p.name} <${p.name}>` : `<${p.name}>`
}

/**
 * `Name <A> [-B <string>] [-C] -D <D>`: each parameter as it is passed. PowerShell fills parameters
 * by position in declared order, so one that must be given after one that can be left out is
 * written by name: by position it would land in the one left out.
 */
function usageLine(name: string, params: ParamDoc[]): string {
  let named = false
  const parts = params.map((p) => {
    const part = usagePart(p, named)
    named ||= isSwitch(p) || p.default !== ''
    return part
  })
  return [name, ...parts].join(' ')
}

const NOT_A_NOTE = /^#(?:region|endregion|requires)\b/i

/** Whether a line belongs to a run of notes. A line that closes a block does not. */
function isNote(line: string): boolean {
  const text = line.trim()
  return text.startsWith('#') && !text.startsWith('#>') && !NOT_A_NOTE.test(text)
}

/** The lines of a `<# ... #>` block without its `<#` and `#>`. */
function blockText(block: string[]): string[] {
  return block.map((l, n) => {
    const opened = n === 0 ? l.trim().slice('<#'.length) : l
    return n === block.length - 1 ? opened.replace(/#>\s*$/, '') : opened
  })
}

/**
 * The line of the `<#` that opens the block ending on line `end`; -1 when the end of another block
 * comes first (the `#>` on line `end` then closes no help block of its own).
 */
function helpStart(lines: string[], end: number): number {
  for (let i = end; i >= 0; i--) {
    const text = lines[i].trim()
    if (text.startsWith('<#')) return i
    if (i < end && text.endsWith('#>')) return -1
  }
  return -1
}

/**
 * The lines of the docs that end on the line directly above `index`, without their comment marks;
 * null when there are none. A `<# ... #>` block comes first, then a run of `#` lines.
 */
function docsAbove(lines: string[], index: number): { form: 'block' | 'note'; lines: string[] } | null {
  if (index === 0) return null
  const above = lines[index - 1].trim()
  if (above.endsWith('#>')) {
    // `$y = 2 <# tweak #>`: a comment at the end of a line of code, not help.
    if (above.indexOf('<#') > 0) return null
    const start = helpStart(lines, index - 1)
    if (start === -1) return null
    return { form: 'block', lines: blockText(lines.slice(start, index)) }
  }
  let start = index
  while (start > 0 && isNote(lines[start - 1])) start--
  if (start === index) return null
  return { form: 'note', lines: lines.slice(start, index).map((l) => l.trim().replace(/^#+/, '')) }
}

/** A `.KEYWORD` section of a help block: the rest of its line, then the lines up to the next keyword. */
interface Section {
  keyword: string
  lines: string[]
}

const KEYWORD = /^\.([A-Za-z]+)\b/
/** PowerShell's own help keywords; a line starting with any other `.word` is text of its section. */
const HELP_KEYWORDS = new Set([
  'synopsis', 'description', 'parameter', 'example', 'inputs', 'outputs', 'notes', 'link', 'component', 'role',
  'functionality', 'forwardhelptargetname', 'forwardhelpcategory', 'remotehelprunspace', 'externalhelp',
])

function sectionsOf(block: string[]): Section[] {
  const sections: Section[] = []
  for (const line of block) {
    const text = line.trim()
    const match = KEYWORD.exec(text)
    const keyword = match?.[1].toLowerCase() ?? ''
    if (match && HELP_KEYWORDS.has(keyword)) sections.push({ keyword, lines: [text.slice(match[0].length).trim()] })
    else sections.at(-1)?.lines.push(line)
  }
  return sections
}

/** A `.PARAMETER` section onto the declared parameter it names, ignoring case; a name that matches none is dropped. */
function readParamSection(section: Section, params: ParamDoc[]): void {
  const head = section.lines[0].trim()
  const split = head.search(/\s/)
  const name = split === -1 ? head : head.slice(0, split)
  const first = split === -1 ? '' : head.slice(split)
  const param = params.find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (param) param.text = textOf([first, ...section.lines.slice(1)])
}

/** The docs in the lines of a help block, for the parameters a definition declares. */
function readBlock(block: string[], params: ParamDoc[]): FunctionDoc {
  const sections = sectionsOf(block)
  const of = (keyword: string) => sections.filter((s) => s.keyword === keyword)
  of('parameter').forEach((s) => readParamSection(s, params))
  return {
    form: 'block',
    summary: textOf([...of('synopsis'), ...of('description')].flatMap((s) => s.lines)),
    params,
    returns: textOf(of('outputs').flatMap((s) => s.lines)),
    examples: of('example').map((s) => exampleOf(s.lines)).filter((e) => e !== ''),
  }
}

function findFunctions(text: string): FunctionInfo[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  const found: FunctionInfo[] = []
  lines.forEach((line, i) => {
    const match = DEFINITION.exec(line)
    if (!match) return
    const params = declaredParams(lines, i)
    const docs = docsAbove(lines, i)
    let doc: FunctionDoc = { ...emptyDoc([]), params }
    if (docs?.form === 'block') {
      doc = readBlock(docs.lines, params)
    } else if (docs) {
      // A run of marks with no text in it is not a note.
      const summary = textOf(docs.lines)
      if (summary !== '') doc = { ...doc, form: 'note', summary }
    }
    found.push({
      name: match[1],
      line: i + 1,
      params: params.map((p) => p.name),
      description: doc.summary,
      usage: usageLine(match[1], params),
      doc,
    })
  })
  return found
}

function renameParam(text: string, fn: FunctionInfo, to: string): string {
  const from = fn.params[0]
  if (from === undefined) return text
  const variable = new RegExp(String.raw`\$${from}\b`, 'gi')
  return rewriteBody(text, fn, findFunctions(text), (line) => line.replace(variable, () => `$${to}`))
}

export const ps: Language = {
  id: 'ps',
  label: 'PowerShell',
  short: 'PS',
  ext: '.ps1',
  sharedDir: 'powershell/commands',
  personalDir: 'local/powershell/commands',
  ignore: [],
  libraryDir: 'powershell/lib',
  lineComment: '#',
  findFunctions,
  renameParam,
  starterFile: (pair) => `# ${pair} commands.\n`,
  starterCommand(name, description) {
    const line = oneLine(description)
    return (line === '' ? '' : `# ${line}\n`) + `function ${name} {\n    param($Macro)\n}`
  },
  // PowerShell loads every file in its command folders: no include file lists them.
  listedIn: () => null,
  isListed: () => true,
  addListing: (includeText) => includeText ?? '',
  removeListing: (includeText) => includeText,
}
