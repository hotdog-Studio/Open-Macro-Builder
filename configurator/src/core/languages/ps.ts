import { oneLine, rewriteBody, type FunctionInfo, type Language } from './types'

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
  return splitParams(body.slice(body.indexOf('('))).flatMap((piece) => {
    const match = /\$(\w+)/.exec(piece)
    return match ? [match[1]] : []
  })
}

const QUOTES = `'"`
const PAREN: Record<string, number> = { '(': 1, ')': -1 }

/**
 * The pieces between the commas of a parameter list. `list` starts at its open paren; what comes
 * after the matching close paren is not read. A comma inside quotes or inner parens splits nothing.
 */
function splitParams(list: string): string[] {
  const pieces: string[] = []
  let depth = 0
  let quote = ''
  let piece = ''
  for (const ch of list) {
    if (quote) {
      piece += ch
      if (ch === quote) quote = ''
      continue
    }
    if (QUOTES.includes(ch)) quote = ch
    const outside = depth === 0
    depth += PAREN[ch] ?? 0
    // The paren that closes the list.
    if (depth === 0) break
    if (ch === ',' && depth === 1) {
      pieces.push(piece)
      piece = ''
    } else if (!outside) {
      // Everything but the paren that opens the list.
      piece += ch
    }
  }
  pieces.push(piece)
  return pieces
}

function findFunctions(text: string): FunctionInfo[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  const found: FunctionInfo[] = []
  lines.forEach((line, i) => {
    const match = DEFINITION.exec(line)
    if (!match) return
    const above = i > 0 ? lines[i - 1].trim() : ''
    const description = above.startsWith('#') ? above.slice(1).trim() : ''
    found.push({ name: match[1], line: i + 1, params: paramNames(lines, i), description })
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
