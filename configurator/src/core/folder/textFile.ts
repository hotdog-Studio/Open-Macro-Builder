import { hashBytes } from './hash'
import type { FolderAccess } from './types'

type Eol = '\n' | '\r\n'

export interface TextFile {
  path: string
  /** Always uses '\n'; `eol` is re-applied on write. */
  text: string
  /** The ending of the file's lines; of a file with both kinds, the one most of its lines have ('\r\n' on a tie). */
  eol: Eol
  /**
   * The text as read (later: as last written), byte-order mark left out, with its own line endings. Present only for a
   * file that has both '\r\n' and a lone '\n': its save then changes only the lines that were edited (keepEndings).
   */
  original?: string
  bom: boolean
  /** Hash of the bytes as read, or null for a file that does not exist yet. */
  version: string | null
}

const BOM = [0xef, 0xbb, 0xbf]

const countOf = (text: string, part: string) => text.split(part).length - 1

/** How a text ends its lines: `eol` is the ending most of them have ('\r\n' on a tie); `breaks` is how many lines end. */
function endingsOf(decoded: string): { eol: Eol; mixed: boolean; breaks: number } {
  const breaks = countOf(decoded, '\n')
  const crlf = countOf(decoded, '\r\n')
  const lone = breaks - crlf
  return { eol: crlf > 0 && crlf >= lone ? '\r\n' : '\n', mixed: crlf > 0 && lone > 0, breaks }
}

export function newTextFile(path: string, text: string): TextFile {
  return { path, text, eol: '\n', bom: false, version: null }
}

export class EncodingError extends Error {
  constructor(readonly path: string) {
    super(`${path} is not UTF-8 text, so the configurator will not edit it.`)
    this.name = 'EncodingError'
  }
}

/**
 * Bytes as a TextFile, read as UTF-8 unless `encoding` names another; null when `fatal` and the bytes
 * are not in that encoding (otherwise they become U+FFFD).
 */
async function decodeTextFile(path: string, raw: Uint8Array, fatal: boolean, encoding = 'utf-8'): Promise<TextFile | null> {
  const bom = BOM.every((byte, i) => raw[i] === byte)
  let decoded: string
  try {
    // Exactly one leading BOM is stripped here; ignoreBOM stops the decoder stripping another.
    decoded = new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(bom ? raw.subarray(BOM.length) : raw)
  } catch {
    return null
  }
  const { eol, mixed } = endingsOf(decoded)
  return {
    path,
    text: decoded.replaceAll('\r\n', '\n'),
    eol,
    ...(mixed && { original: decoded }),
    bom,
    version: await hashBytes(raw),
  }
}

/** Reads a UTF-8 text file; throws EncodingError when the bytes are not valid UTF-8. */
export async function readTextFile(folder: FolderAccess, path: string): Promise<TextFile | null> {
  const raw = await folder.readBytes(path)
  if (raw === null) return null
  const file = await decodeTextFile(path, raw, true)
  if (!file) throw new EncodingError(path)
  return file
}

/**
 * Reads a text file only to look at it, never to write it back: bytes that are not UTF-8 are read
 * in `fallback` (UTF-8, where they become U+FFFD, unless it names another encoding) instead of
 * failing. `utf8` says whether the file was valid UTF-8.
 */
export async function readTextFileLenient(
  folder: FolderAccess,
  path: string,
  fallback = 'utf-8',
): Promise<{ file: TextFile; utf8: boolean } | null> {
  const raw = await folder.readBytes(path)
  return raw === null ? null : decodeLenient(path, raw, fallback)
}

/** Bytes already read, decoded as readTextFileLenient decodes them. */
export async function decodeLenient(path: string, raw: Uint8Array, fallback = 'utf-8'): Promise<{ file: TextFile; utf8: boolean }> {
  const strict = await decodeTextFile(path, raw, true)
  if (strict) return { file: strict, utf8: true }
  // A non-fatal decoder never fails.
  return { file: (await decodeTextFile(path, raw, false, fallback))!, utf8: false }
}

export async function currentVersion(folder: FolderAccess, path: string): Promise<string | null> {
  const raw = await folder.readBytes(path)
  return raw === null ? null : hashBytes(raw)
}

export class ConflictError extends Error {
  constructor(readonly path: string) {
    super(`"${path}" changed on disk since it was loaded`)
    this.name = 'ConflictError'
  }
}

/**
 * `text` written with the line endings of `original`, which has both kinds: the lines the two share at the start,
 * and then at the end, keep the ending they had, and every line between them gets `eol`. A text that does not end
 * in a new line keeps having none.
 *
 * `text` is taken to end its lines with '\n', as a TextFile's does (and `original` is compared as if it did too). A
 * '\r\n' in it (pasted into the editor) counts as '\n', as encodeTextFile has always counted it, so no '\r' is
 * doubled or lost; a lone '\r' is part of its line.
 */
export function keepEndings(original: string, text: string, eol: Eol): string {
  const was = original.replaceAll('\r\n', '\n').split('\n')
  const now = text.replaceAll('\r\n', '\n').split('\n')
  // The n-th '\n' of the original ends its n-th line, and a '\r' before it is part of that ending.
  const ended = [...original.matchAll(/\r?\n/g)].map(([ending]) => ending as Eol)
  const most = Math.min(was.length, now.length)
  let head = 0
  while (head < most && was[head] === now[head]) head++
  // Never into the head, or a line that repeats would be shared from both ends.
  let tail = 0
  while (tail < most - head && was.at(-1 - tail) === now.at(-1 - tail)) tail++
  return now
    .map((line, i) => {
      if (i === now.length - 1) return line
      // The original's last line has no ending: a line that follows it in the new text gets `eol`.
      if (i < head) return line + (ended[i] ?? eol)
      return line + (i >= now.length - tail ? ended[was.length - now.length + i] : eol)
    })
    .join('')
}

/** The text of the file as it is written, byte-order mark left out. */
function encodedText(file: TextFile): string {
  const lf = file.text.replaceAll('\r\n', '\n')
  if (file.original !== undefined) return keepEndings(file.original, lf, file.eol)
  return file.eol === '\r\n' ? lf.replaceAll('\n', '\r\n') : lf
}

function withBom(file: TextFile, written: string): Uint8Array {
  const body = new TextEncoder().encode(written)
  const data = new Uint8Array((file.bom ? BOM.length : 0) + body.length)
  if (file.bom) data.set(BOM)
  data.set(body, file.bom ? BOM.length : 0)
  return data
}

/** The bytes of the file: its text with its original line endings and byte-order mark. */
export function encodeTextFile(file: TextFile): Uint8Array {
  return withBom(file, encodedText(file))
}

/**
 * The file as it is once `written` is on disk, for the next save to compare with: its `original` is that text while
 * the file has both kinds of ending, and none once it has one (a text without a line ending keeps the file's `eol`).
 */
function afterWrite(file: TextFile, written: string): TextFile {
  if (file.original === undefined) return file
  const plain = { ...file }
  delete plain.original
  const { eol, mixed, breaks } = endingsOf(written)
  if (mixed) return { ...plain, eol, original: written }
  return breaks === 0 ? plain : { ...plain, eol }
}

/**
 * Writes the file with its original line endings and byte-order mark. Throws
 * ConflictError when the bytes on disk are not the ones that were loaded
 * (a null version means the file must not exist yet), unless `force` is set.
 */
export async function writeTextFile(
  folder: FolderAccess,
  file: TextFile,
  opts: { force?: boolean } = {},
): Promise<TextFile> {
  if (!opts.force && (await currentVersion(folder, file.path)) !== file.version) {
    throw new ConflictError(file.path)
  }
  const written = encodedText(file)
  const data = withBom(file, written)
  await folder.writeBytes(file.path, data)
  return { ...afterWrite(file, written), version: await hashBytes(data) }
}
