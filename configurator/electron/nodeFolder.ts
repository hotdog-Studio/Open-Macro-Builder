import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { PathError, byName, normalizePath } from '../src/core/folder/path'
import type { DirEntry, FolderAccess } from '../src/core/folder/types'

const TEMP_SUFFIX = '.omb-tmp'

function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined
}

/** A missing entry, or a file where a folder was expected (or the reverse). */
function isMissing(e: unknown): boolean {
  const code = errorCode(e)
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

/** Windows refuses a rename while another program (a virus scanner, an editor) briefly holds the target. */
function isBusy(e: unknown): boolean {
  const code = errorCode(e)
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * The absolute path of `rel` inside `root`. Throws PathError for anything that
 * normalizePath rejects or that would still land outside the folder.
 */
export function resolveInside(root: string, rel: string): string {
  const abs = resolve(root, normalizePath(rel))
  const fromRoot = relative(root, abs)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new PathError(`Path must stay inside the opened folder: "${rel}"`)
  }
  return abs
}

/** FolderAccess over Node's fs, confined to one folder. */
export class NodeFolder implements FolderAccess {
  readonly root: string
  readonly name: string

  constructor(root: string) {
    this.root = resolve(root)
    this.name = basename(this.root)
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const abs = resolveInside(this.root, path)
    try {
      const buffer = await readFile(abs)
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const abs = resolveInside(this.root, path)
    await mkdir(dirname(abs), { recursive: true })
    // Write the whole file beside the target, then swap it in, so a failed
    // write never leaves a half-written config behind.
    const temp = abs + TEMP_SUFFIX
    try {
      await writeFile(temp, data)
      await this.replace(temp, abs)
    } catch (e) {
      await rm(temp, { force: true }).catch(() => {})
      throw e
    }
  }

  private async replace(temp: string, target: string, attempt = 1): Promise<void> {
    try {
      await rename(temp, target)
    } catch (e) {
      if (!isBusy(e) || attempt >= 5) throw e
      await pause(50 * attempt)
      await this.replace(temp, target, attempt + 1)
    }
  }

  async list(dir: string): Promise<DirEntry[]> {
    // '' is the folder root; every other path is normalised.
    const abs = dir === '' ? this.root : resolveInside(this.root, dir)
    let dirents
    try {
      dirents = await readdir(abs, { withFileTypes: true })
    } catch (e) {
      if (isMissing(e)) return []
      throw e
    }
    return dirents.map((d): DirEntry => ({ name: d.name, kind: d.isDirectory() ? 'dir' : 'file' })).sort(byName)
  }

  async remove(path: string): Promise<void> {
    const abs = resolveInside(this.root, path)
    try {
      await unlink(abs)
    } catch (e) {
      if (!isMissing(e)) throw e
    }
  }
}
