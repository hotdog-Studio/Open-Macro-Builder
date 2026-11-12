import { rewriteBody, type FunctionInfo, type Language } from './types'

const DEFINITION = /^(\w+)\(([^)]*)\)\s*\{?\s*$/
const PARAM_NAME = /^[&*]?(\w+)/
const NOT_FUNCTIONS = new Set(['if', 'while', 'for', 'loop', 'switch', 'catch', 'until', 'return', 'else'])

/** Splits a parameter list on commas that are not inside a quoted string. */
function splitParams(list: string): string[] {
  const pieces: string[] = []
  let quote = ''
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    if (quote) {
      if (ch === quote) quote = ''
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

function paramNames(list: string): string[] {
  const names: string[] = []
  for (const piece of splitParams(list)) {
    const match = PARAM_NAME.exec(piece.trim())
    if (match) names.push(match[1])
  }
  return names
}

/** The text of the `/** ... *\/` block that ends on the line directly above `index`. */
function descriptionAbove(lines: string[], index: number): string {
  if (index === 0 || !/\*\/\s*$/.test(lines[index - 1])) return ''
  let start = index - 1
  while (start >= 0 && !/^\s*\/\*\*/.test(lines[start])) {
    if (/^\s*\/\*(?!\*)/.test(lines[start])) return ''
    start--
  }
  if (start < 0) return ''
  const parts: string[] = []
  for (let i = start; i < index; i++) {
    const text = lines[i]
      .replace(/^\s*\/\*\*/, '')
      .replace(/\*\/\s*$/, '')
      .replace(/^\s*\*\s?/, '')
      .trim()
    if (text === '') continue
    if (text.startsWith('@description ')) parts.push(text.slice('@description '.length).trim())
    else if (!text.startsWith('@')) parts.push(text)
  }
  return parts.join(' ')
}

function findFunctions(text: string): FunctionInfo[] {
  const lines = text.split('\n')
  const found: FunctionInfo[] = []
  lines.forEach((raw, i) => {
    const match = DEFINITION.exec(raw.replace(/\r$/, ''))
    if (!match || NOT_FUNCTIONS.has(match[1].toLowerCase())) return
    found.push({
      name: match[1],
      line: i + 1,
      params: paramNames(match[2]),
      description: descriptionAbove(lines, i),
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
  const header = lines.findIndex((l) => CUSTOM_HEADER.test(l))
  if (header === -1) {
    throw new Error(String.raw`ahk/config.ahk has no Custom Commands section. Add "#Include commands\…" there by hand.`)
  }
  let after = header
  for (let i = header + 1; i < lines.length && !SECTION_HEADER.test(lines[i]); i++) {
    if (SHARED_INCLUDE.test(lines[i])) after = i
  }
  const line = '#Include commands\\' + below(SHARED_DIR, path)
  const out = [...lines]
  const prev = out[after]
  const prevEnd = endOf(prev)
  if (prevEnd === '') out.splice(after, 1, prev + eol, line)
  else out.splice(after + 1, 0, line + prevEnd)
  return out.join('')
}

function addListing(includeText: string | null, path: string): string {
  const at = listedIn(path)
  if (at === null) return includeText ?? ''
  if (at === HUB && includeText === null) return `${HUB_HEADER}#Include ${below(HUB_DIR, path)}\n`
  const text = includeText ?? ''
  const lines = linesOf(text)
  const target = path.toLowerCase()
  if (lines.some((l) => includeTarget(l, dirOf(at)) === target)) return text
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
  findFunctions,
  renameParam,
  starterFile: (pair) => `#Requires AutoHotkey v2.0\n\n; ${pair} commands.\n`,
  listedIn,
  addListing,
  removeListing,
}
