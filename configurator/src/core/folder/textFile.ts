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

export async function readTextFile(folder: FolderAccess, path: string): Promise<TextFile | null> {
  const raw = await folder.readBytes(path)
  if (raw === null) return null
  const bom = BOM.every((byte, i) => raw[i] === byte)
  const decoded = new TextDecoder().decode(bom ? raw.subarray(BOM.length) : raw)
  return {
    path,
    text: decoded.replace(/\r\n/g, '\n'),
    eol: decoded.includes('\r\n') ? '\r\n' : '\n',
    bom,
    version: await hashBytes(raw),
  }
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
  const lf = file.text.replace(/\r\n/g, '\n')
  const body = new TextEncoder().encode(file.eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf)
  const data = new Uint8Array((file.bom ? BOM.length : 0) + body.length)
  if (file.bom) data.set(BOM)
  data.set(body, file.bom ? BOM.length : 0)
  await folder.writeBytes(file.path, data)
  return { ...file, version: await hashBytes(data) }
}
