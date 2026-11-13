import type { StreamParser, StringStream } from '@codemirror/language'

export interface AhkState {
  /** Inside a /* ... *\/ comment that began on an earlier line. */
  inBlock: boolean
}

const KEYWORDS = new Set(
  (
    'if else loop while for in until return break continue try catch finally throw ' +
    'global local static class extends switch case default not and or is new'
  ).split(' '),
)

/** Reads a block comment to its end, or to the end of the line when it goes on past it. */
function blockComment(stream: StringStream, state: AhkState): 'comment' {
  if (stream.skipTo('*/')) {
    stream.match('*/')
    state.inBlock = false
  } else {
    stream.skipToEnd()
    state.inBlock = true
  }
  return 'comment'
}

/** A semicolon starts a comment at the start of a line or after whitespace. */
function atLineComment(stream: StringStream): boolean {
  if (stream.peek() !== ';') return false
  return stream.sol() || /\s/.test(stream.string.charAt(stream.pos - 1))
}

/** Reads a string to its closing quote; a backtick escapes the character after it. */
function quoted(stream: StringStream, quote: string): 'string' {
  stream.next()
  let ch: string | void
  while ((ch = stream.next()) != null) {
    if (ch === '`') stream.next()
    else if (ch === quote) break
  }
  return 'string'
}

/** A small AutoHotkey tokenizer: enough colour to read a command file, not a full grammar. */
export const ahkMode: StreamParser<AhkState> = {
  name: 'autohotkey',
  startState: () => ({ inBlock: false }),
  token(stream, state) {
    if (state.inBlock) return blockComment(stream, state)
    if (stream.eatSpace()) return null
    if (stream.match('/*')) return blockComment(stream, state)

    if (atLineComment(stream)) {
      stream.skipToEnd()
      return 'comment'
    }

    const quote = stream.peek()
    if (quote === '"' || quote === "'") return quoted(stream, quote)

    if (stream.match(/^#[A-Za-z_]\w*/)) return 'meta'
    if (stream.match(/^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)/)) return 'number'

    if (stream.match(/^[A-Za-z_]\w*/)) {
      return KEYWORDS.has(stream.current().toLowerCase()) ? 'keyword' : null
    }

    stream.next()
    return null
  },
  languageData: { commentTokens: { line: ';', block: { open: '/*', close: '*/' } } },
}
