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
}
