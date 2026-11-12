import { rewriteBody, type FunctionInfo, type Language } from './types'

const DEFINITION = /^\s*function\s+([\w-]+)/i
const PARAM_START = /param\s*\(/i

/**
 * Parameter names of the first `param(...)` that starts within the definition
 * line or the next two, never reaching into the following function.
 */
function paramNames(lines: string[], index: number): string[] {
  const window: string[] = [lines[index]]
  for (let i = index + 1; i <= index + 2 && i < lines.length; i++) {
    if (DEFINITION.test(lines[i])) break
    window.push(lines[i])
  }
  const startLine = window.findIndex((l) => PARAM_START.test(l))
  if (startLine === -1) return []
  // Read to the matching close paren, which may be past the three-line window.
  const rest = [lines[index + startLine].slice(lines[index + startLine].search(PARAM_START)), ...lines.slice(index + startLine + 1)]
  const body = rest.join('\n')
  const open = body.indexOf('(')
  let depth = 0
  let quote = ''
  let piece = ''
  const pieces: string[] = []
  for (let i = open; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      piece += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      piece += ch
    } else if (ch === '(') {
      if (depth > 0) piece += ch
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) break
      piece += ch
    } else if (ch === ',' && depth === 1) {
      pieces.push(piece)
      piece = ''
    } else {
      piece += ch
    }
  }
  pieces.push(piece)
  const names: string[] = []
  for (const p of pieces) {
    const match = /\$(\w+)/.exec(p)
    if (match) names.push(match[1])
  }
  return names
}

function findFunctions(text: string): FunctionInfo[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  const found: FunctionInfo[] = []
  lines.forEach((line, i) => {
    const match = DEFINITION.exec(line)
    if (!match) return
    const above = i > 0 ? /^\s*#\s*(.*?)\s*$/.exec(lines[i - 1]) : null
    found.push({ name: match[1], line: i + 1, params: paramNames(lines, i), description: above ? above[1] : '' })
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
  findFunctions,
  renameParam,
  starterFile: (pair) => `# ${pair} commands.\n`,
  // PowerShell loads every file in its command folders: no include file lists them.
  listedIn: () => null,
  addListing: (includeText) => includeText ?? '',
  removeListing: (includeText) => includeText,
}
