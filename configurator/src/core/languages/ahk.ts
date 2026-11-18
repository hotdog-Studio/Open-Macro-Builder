import { emptyDoc, exampleOf, oneLine, rewriteBody, textOf, type FunctionDoc, type FunctionInfo, type Language, type ParamDoc } from './types'

/** A name and an open paren at the left edge: a definition, or a call at the top of the file. */
const HEAD = /^(\w+)\(/
const PARAM_NAME = /^[&*]?(\w+)/
const NOT_FUNCTIONS = new Set(['if', 'while', 'for', 'loop', 'switch', 'catch', 'until', 'return', 'else'])

/** Splits a parameter list on commas that are not inside a quoted string. A backtick escapes the character after it. */
function splitParams(list: string): string[] {
  const pieces: string[] = []
  let quote = ''
  let escaped = false
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    if (escaped) {
      escaped = false
    } else if (quote) {
      if (ch === '`') escaped = true
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',') {
      pieces.push(list.slice(start, i))
      start = i + 1
    }
  }
  pieces.push(list.slice(start))
  return pieces
}

interface Declared {
  name: string
  optional: boolean
  default: string
}

/** The parameters a definition declares: optional with `:=`, or with a trailing `?` or `*`. */
function declaredParams(list: string): Declared[] {
  const declared: Declared[] = []
  for (const piece of splitParams(list)) {
    const text = piece.trim()
    const match = PARAM_NAME.exec(text)
    if (!match) continue
    const assign = text.indexOf(':=')
    const head = assign === -1 ? text : text.slice(0, assign).trimEnd()
    declared.push({
      name: match[1],
      optional: assign !== -1 || head.endsWith('?') || head.endsWith('*'),
      default: assign === -1 ? '' : text.slice(assign + ':='.length).trim(),
    })
  }
  return declared
}

/** A line that ends a block comment. */
const CLOSES = /\*\/\s*$/

/**
 * The line of the `/**` that opens the block ending on line `end`; -1 when a plain `/*` or the end
 * of another comment comes first (the `*\/` on line `end` then closes no doc block).
 */
function blockStart(lines: string[], end: number): number {
  for (let i = end; i >= 0; i--) {
    // Another comment's end first: a one-line `/** ... */` above is a whole block of its own.
    if (i < end && CLOSES.test(lines[i])) return -1
    if (/^\s*\/\*\*/.test(lines[i])) return i
    if (/^\s*\/\*/.test(lines[i])) return -1
  }
  return -1
}

/** The lines of the `/** ... *\/` block that ends on the line directly above `index`, without their decoration; null when there is none. */
function docBlockAbove(lines: string[], index: number): string[] | null {
  const end = index - 1
  if (end < 0 || !CLOSES.test(lines[end])) return null
  // `x := 1 /* tweak */`: a comment at the end of a line of code, not a doc block.
  if (lines[end].trim().indexOf('/*') > 0) return null
  const start = blockStart(lines, end)
  if (start === -1) return null
  return lines
    .slice(start, index)
    .map((line) => line.replace(/^\s*\/\*\*/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*\s?/, '').trimEnd())
}

/** A tag of a doc block, such as `@param`: the rest of its line, then the lines up to the next tag. */
interface Tag {
  name: string
  lines: string[]
}

// The two patterns below never let two neighbouring parts match the same character, so a run of spaces
// has one way to be read: the text that ends each pattern starts at a non-space character, or is absent.
/** `@name`, then the rest of the line: after one whitespace character (group 2), or from a non-word character (group 3). */
const TAG = /^\s*@(\w+)(?:\s(.*)|([^\w\s].*))?$/
/** `[{Type}] text` */
const RETURNS_TAG = /^(?:\{[^}]*\}\s*)?(\S.*)?$/

/** The lines before the first tag, and the tags. */
function splitTags(block: string[]): { intro: string[]; tags: Tag[] } {
  const intro: string[] = []
  const tags: Tag[] = []
  for (const line of block) {
    const match = TAG.exec(line)
    if (match) tags.push({ name: match[1].toLowerCase(), lines: [match[2] ?? match[3] ?? ''] })
    else (tags.at(-1)?.lines ?? intro).push(line)
  }
  return { intro, tags }
}

/** What the first line of an `@param` says: `[{Type}] name [-] text`. */
interface ParamParts {
  type: string | undefined
  name: string
  text: string
}

/** The `{Type}` the line starts with, and what follows it. */
function splitType(line: string): { type: string | undefined; rest: string } {
  const close = line.indexOf('}')
  if (!line.startsWith('{') || close === -1) return { type: undefined, rest: line }
  return { type: line.slice(1, close), rest: line.slice(close + 1).trimStart() }
}

/** The name at the start of `text`, `[...]` or up to the next whitespace, and what follows it. */
function splitName(text: string): { name: string; rest: string } {
  const close = text.indexOf(']')
  if (text.startsWith('[') && close !== -1) return { name: text.slice(0, close + 1), rest: text.slice(close + 1) }
  const space = text.search(/\s/)
  const end = space === -1 ? text.length : space
  return { name: text.slice(0, end), rest: text.slice(end) }
}

/** `text` without a leading dash that stands alone: followed by whitespace, or by nothing. */
function dropDash(text: string): string {
  if (!text.startsWith('-')) return text
  const after = text.slice(1)
  const trimmed = after.trimStart()
  return after === '' || trimmed !== after ? trimmed : text
}

/** The parts of the first line of an `@param`, already trimmed and free of line breaks (a line with one is no tag); null when it has no name. */
function readParamParts(line: string): ParamParts | null {
  const { type, rest } = splitType(line)
  if (rest === '') return null
  const { name, rest: after } = splitName(rest)
  return { type, name, text: dropDash(after.trimStart()) }
}

/** An `@param` note onto the declared parameter it names, ignoring case; a name that matches none is dropped. */
function readParamTag(tag: Tag, params: ParamDoc[]): void {
  const parts = readParamParts(tag.lines[0].trim())
  if (!parts) return
  const name = parts.name.replace(/^\[/, '').replace(/\]$/, '').split('=')[0].trim().toLowerCase()
  const param = params.find((p) => p.name.toLowerCase() === name)
  if (!param) return
  param.type = parts.type?.trim() ?? ''
  param.text = textOf([parts.text, ...tag.lines.slice(1)])
}

/** The docs in the lines of a doc block, for the parameters a definition declares. */
function readDoc(block: string[], declared: Declared[]): FunctionDoc {
  const { intro, tags } = splitTags(block)
  const doc = emptyDoc(declared.map((d) => d.name))
  doc.form = 'block'
  const summary = [...intro]
  for (const tag of tags) {
    if (tag.name === 'description') summary.push(...tag.lines)
    else if (tag.name === 'param') readParamTag(tag, doc.params)
    else if (tag.name === 'returns' || tag.name === 'return') {
      doc.returns = textOf([RETURNS_TAG.exec(tag.lines[0].trim())?.[1] ?? '', ...tag.lines.slice(1)])
    } else if (tag.name === 'example') {
      const example = exampleOf(tag.lines)
      if (example !== '') doc.examples.push(example)
    }
  }
  doc.summary = textOf(summary)
  return doc
}

/** The index of the quote that closes the string opening at `start`, or the line's length. A backtick escapes the character after it. */
function stringEnd(line: string, start: number): number {
  let i = start + 1
  while (i < line.length && line[i] !== line[start]) i += line[i] === '`' ? 2 : 1
  return Math.min(i, line.length)
}

/** The index of the paren that closes the one at `open`, outside quoted strings; -1 when the line has none. */
function closingParen(line: string, open: number): number {
  let depth = 0
  let i = open
  while (i < line.length) {
    const ch = line[i]
    if (ch === '"' || ch === "'") {
      i = stringEnd(line, i)
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * Whether a body follows a head's close paren: `{` or `=>` after it on the line, or, with nothing
 * there but a comment, `{` first on the next line that holds code. Anything else makes it a call.
 */
function opensBody(lines: string[], index: number, after: string): boolean {
  if (after.startsWith('{') || after.startsWith('=>')) return true
  if (after !== '' && !after.startsWith(';')) return false
  for (const line of lines.slice(index + 1)) {
    const code = line.trim()
    if (code !== '' && !code.startsWith(';')) return code.startsWith('{')
  }
  return false
}

/** The name and the parameter list of the definition on line `index`; null when the line defines nothing. */
function definitionAt(lines: string[], index: number): { name: string; list: string } | null {
  const line = lines[index]
  const head = HEAD.exec(line)
  if (!head || NOT_FUNCTIONS.has(head[1].toLowerCase())) return null
  const close = closingParen(line, head[1].length)
  if (close === -1 || !opensBody(lines, index, line.slice(close + 1).trim())) return null
  return { name: head[1], list: line.slice(head[0].length, close) }
}

function findFunctions(text: string): FunctionInfo[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  const found: FunctionInfo[] = []
  lines.forEach((_, i) => {
    const match = definitionAt(lines, i)
    if (!match) return
    const declared = declaredParams(match.list)
    const block = docBlockAbove(lines, i)
    const doc = block ? readDoc(block, declared) : emptyDoc(declared.map((d) => d.name))
    doc.params.forEach((param, n) => {
      param.optional = declared[n].optional
      param.default = declared[n].default
    })
    found.push({
      name: match.name,
      line: i + 1,
      params: declared.map((d) => d.name),
      description: doc.summary,
      usage: `${match.name}(${match.list})`,
      doc,
    })
  })
  return found
}

function renameParam(text: string, fn: FunctionInfo, to: string): string {
  const from = fn.params[0]
  if (from === undefined) return text
  const word = new RegExp(String.raw`\b${from}\b`, 'gi')
  const rename = (part: string) => part.replace(word, () => to)
  return rewriteBody(text, fn, findFunctions(text), (line, isDefinition) => {
    if (!isDefinition) return rename(line)
    // The function's own name comes before the parenthesis and stays as it is.
    const open = line.indexOf('(')
    return line.slice(0, open) + rename(line.slice(open))
  })
}

/** The personal include hub, which lists the files under local/ahk. */
const HUB = 'local/ahk/commands.ahk'
const HUB_DIR = 'local/ahk'
/** Lists the shared files under ahk/commands. */
const CONFIG = 'ahk/config.ahk'
const CONFIG_DIR = 'ahk'
const SHARED_DIR = 'ahk/commands'
const HUB_HEADER =
  '#Requires AutoHotkey v2.0\n' +
  '; Your own AutoHotkey commands. ahk\\config.ahk includes this file when it exists. The local folder\n' +
  '; is ignored by git, so nothing here is ever committed.\n'

/** Lines that load a file: `#Include` or `#IncludeAgain`, then the target. */
const INCLUDE = /^\s*#include(?:again)?\s(.*)$/i
const CUSTOM_HEADER = /^\s*;.*\bCustom Commands\b/i
const SECTION_HEADER = /^\s*;\s*\*{4}/
const SHARED_INCLUDE = /^\s*#Include\s+commands\\/i

function listedIn(path: string): string | null {
  if (path.startsWith(`${HUB_DIR}/`) && path.toLowerCase() !== HUB) return HUB
  if (path.startsWith(`${SHARED_DIR}/`)) return CONFIG
  return null
}

/** The text's lines, each with its own line ending (the last may have none). */
function linesOf(text: string): string[] {
  const lines: string[] = []
  let start = 0
  while (start < text.length) {
    const end = text.indexOf('\n', start)
    const next = end === -1 ? text.length : end + 1
    lines.push(text.slice(start, next))
    start = next
  }
  return lines
}

/** The line ending a line closes with, or '' for a last line without one. */
const endOf = (line: string) => {
  if (line.endsWith('\r\n')) return '\r\n'
  return line.endsWith('\n') ? '\n' : ''
}

/** `dir/target` with `.` and `..` worked out, lower-cased. */
function resolve(dir: string, target: string): string {
  const parts = dir.split('/')
  for (const part of target.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return parts.join('/').toLowerCase()
}

/** The file an `#Include` line loads, resolved against `dir` and lower-cased; null for any other line. */
function includeTarget(line: string, dir: string): string | null {
  const match = INCLUDE.exec(line.slice(0, line.length - endOf(line).length))
  if (!match) return null
  let target = match[1]
  // A comment starts at a semicolon after a space or tab.
  const comment = target.search(/[ \t];/)
  if (comment !== -1) target = target.slice(0, comment)
  target = target.trim().replace(/^\*i\s/i, '').trim()
  const quote = target[0]
  if ((quote === '"' || quote === "'") && target.length > 1 && target.endsWith(quote)) target = target.slice(1, -1)
  return resolve(dir, target)
}

const dirOf = (includePath: string) => (includePath === HUB ? HUB_DIR : CONFIG_DIR)

/** `path` below `dir`, with backslashes. */
const below = (dir: string, path: string) => path.slice(dir.length + 1).replaceAll('/', '\\')

/** config.ahk: the line goes after the last shared include of Custom Commands, else right after its header. */
function addSharedInclude(lines: string[], path: string, eol: string): string {
  const line = '#Include commands\\' + below(SHARED_DIR, path)
  const header = lines.findIndex((l) => CUSTOM_HEADER.test(l))
  if (header === -1) throw new Error(`ahk/config.ahk has no Custom Commands section. Add "${line}" there by hand.`)
  let after = header
  for (let i = header + 1; i < lines.length && !SECTION_HEADER.test(lines[i]); i++) {
    if (SHARED_INCLUDE.test(lines[i])) after = i
  }
  const out = [...lines]
  const prev = out[after]
  const prevEnd = endOf(prev)
  if (prevEnd === '') out.splice(after, 1, prev + eol, line)
  else out.splice(after + 1, 0, line + prevEnd)
  return out.join('')
}

/** Whether a line of the include file loads `path`, matched as removeListing matches it. */
function isListed(includeText: string, path: string): boolean {
  const at = listedIn(path)
  if (at === null) return true
  const target = path.toLowerCase()
  return linesOf(includeText).some((l) => includeTarget(l, dirOf(at)) === target)
}

function addListing(includeText: string | null, path: string): string {
  const at = listedIn(path)
  if (at === null) return includeText ?? ''
  if (at === HUB && includeText === null) return `${HUB_HEADER}#Include ${below(HUB_DIR, path)}\n`
  const text = includeText ?? ''
  const lines = linesOf(text)
  if (isListed(text, path)) return text
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  if (at === CONFIG) return addSharedInclude(lines, path, eol)
  // The hub: appended, keeping the file's habit of ending with a newline or not.
  const line = `#Include ${below(HUB_DIR, path)}`
  return text === '' || text.endsWith('\n') ? text + line + eol : text + eol + line
}

function removeListing(includeText: string, path: string): string {
  const at = listedIn(path)
  if (at === null) return includeText
  const target = path.toLowerCase()
  const kept = linesOf(includeText).filter((l) => includeTarget(l, dirOf(at)) !== target)
  // A file without a final newline keeps having none when its last line goes.
  const last = kept.at(-1)
  if (last !== undefined && !includeText.endsWith('\n')) {
    kept[kept.length - 1] = last.slice(0, last.length - endOf(last).length)
  }
  return kept.join('')
}

export const ahk: Language = {
  id: 'ahk',
  label: 'AutoHotkey',
  short: 'AHK',
  ext: '.ahk',
  sharedDir: 'ahk/commands',
  personalDir: 'local/ahk',
  ignore: ['local/ahk/commands.ahk'],
  libraryDir: null,
  lineComment: ';',
  findFunctions,
  renameParam,
  starterFile: (pair) => `#Requires AutoHotkey v2.0\n\n; ${pair} commands.\n`,
  starterCommand(name, description) {
    // A `*/` in the description would close the doc comment early.
    const line = oneLine(description).replaceAll('*/', '* /')
    return (
      '/**\n' +
      (line === '' ? '' : ` * ${line}\n`) +
      ` * @param {Macro} Macro - The macro object.\n */\n${name}(Macro)\n{\n}`
    )
  },
  listedIn,
  isListed,
  addListing,
  removeListing,
}
