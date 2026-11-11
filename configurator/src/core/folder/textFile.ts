import { hashBytes } from './hash'
import type { FolderAccess } from './types'

export interface TextFile {
  path: string
  /** Always uses '\n'; `eol` is re-applied on write. */
  text: string
  eol: '\n' | '\r\n'
  bom: boolean
  /** Hash of the bytes as read, or null for a file that does not exist yet. */
  version: string | null
}

const BOM = [0xef, 0xbb, 0xbf]

export function newTextFile(path: string, text: string): TextFile {
  return { path, text, eol: '\n', bom: false, version: null }
}

export class EncodingError extends Error {
  constructor(readonly path: string) {
    super(`${path} is not UTF-8 text, so the configurator will not edit it.`)
    this.name = 'EncodingError'
  }
}

/** UTF-8 bytes as a TextFile; null when `fatal` and the bytes are not UTF-8 (otherwise they become U+FFFD). */
async function decodeTextFile(path: string, raw: Uint8Array, fatal: boolean): Promise<TextFile | null> {
  const bom = BOM.every((byte, i) => raw[i] === byte)
  let decoded: string
  try {
    // Exactly one leading BOM is stripped here; ignoreBOM stops the decoder stripping another.
    decoded = new TextDecoder('utf-8', { fatal, ignoreBOM: true }).decode(bom ? raw.subarray(BOM.length) : raw)
  } catch {
    return null
  }
  return {
    path,
    text: decoded.replaceAll('\r\n', '\n'),
    eol: decoded.includes('\r\n') ? '\r\n' : '\n',
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
 * Reads a text file only to look at it, never to write it back: bytes that are not UTF-8
 * become U+FFFD instead of failing. `utf8` says whether the file was valid UTF-8.
 */
export async function readTextFileLenient(
  folder: FolderAccess,
  path: string,
): Promise<{ file: TextFile; utf8: boolean } | null> {
  const raw = await folder.readBytes(path)
  if (raw === null) return null
  const strict = await decodeTextFile(path, raw, true)
  if (strict) return { file: strict, utf8: true }
  // A non-fatal decoder never fails.
  return { file: (await decodeTextFile(path, raw, false))!, utf8: false }
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
  const lf = file.text.replaceAll('\r\n', '\n')
  const body = new TextEncoder().encode(file.eol === '\r\n' ? lf.replaceAll('\n', '\r\n') : lf)
  const data = new Uint8Array((file.bom ? BOM.length : 0) + body.length)
  if (file.bom) data.set(BOM)
  data.set(body, file.bom ? BOM.length : 0)
  await folder.writeBytes(file.path, data)
  return { ...file, version: await hashBytes(data) }
}
