/**
 * In-memory stand-ins for the parts of FileSystemDirectoryHandle and
 * FileSystemFileHandle that BrowserFolder uses.
 */

export function domError(name: string, message = name): DOMException {
  return new DOMException(message, name)
}

export class FakeFile {
  readonly kind = 'file'
  data: Uint8Array
  constructor(
    readonly name: string,
    data: Uint8Array = new Uint8Array(),
  ) {
    this.data = data
  }

  async getFile() {
    const data = this.data.slice()
    return { arrayBuffer: async () => data.buffer as ArrayBuffer }
  }

  /** Writes go to a swap buffer and replace the file only on close(). */
  async createWritable() {
    let pending = new Uint8Array()
    return {
      write: async (chunk: Uint8Array) => {
        pending = chunk.slice()
      },
      close: async () => {
        this.data = pending
      },
      abort: async () => {},
    }
  }
}

export class FakeDir {
  readonly kind = 'directory'
  readonly children = new Map<string, FakeDir | FakeFile>()
  /** What queryPermission resolves to. */
  permission: PermissionState = 'granted'
  /** What requestPermission resolves to. */
  requested: PermissionState = 'granted'
  /** When set, every directory call on this handle rejects with a DOMException of this name. */
  failWith: string | null = null
  /** When set, queryPermission and requestPermission reject with this name. */
  permissionFailWith: string | null = null

  constructor(readonly name: string) {}

  private check() {
    if (this.failWith) throw domError(this.failWith)
  }

  async queryPermission(): Promise<PermissionState> {
    if (this.permissionFailWith) throw domError(this.permissionFailWith)
    return this.permission
  }

  async requestPermission(): Promise<PermissionState> {
    if (this.permissionFailWith) throw domError(this.permissionFailWith)
    if (this.requested === 'granted') this.permission = 'granted'
    return this.requested
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    this.check()
    const found = this.children.get(name)
    if (found instanceof FakeDir) return found
    if (found) throw domError('TypeMismatchError')
    if (!options?.create) throw domError('NotFoundError')
    const dir = new FakeDir(name)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFile> {
    this.check()
    const found = this.children.get(name)
    if (found instanceof FakeFile) return found
    if (found) throw domError('TypeMismatchError')
    if (!options?.create) throw domError('NotFoundError')
    const file = new FakeFile(name)
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string): Promise<void> {
    this.check()
    if (!this.children.delete(name)) throw domError('NotFoundError')
  }

  async *entries(): AsyncIterableIterator<[string, FakeDir | FakeFile]> {
    this.check()
    for (const entry of this.children) yield entry
  }

  /** Test convenience: creates parent folders and a file. */
  put(path: string, content: string | Uint8Array): FakeFile {
    const parts = path.split('/')
    const fileName = parts.pop()!
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let dir: FakeDir = this
    for (const part of parts) {
      let next = dir.children.get(part)
      if (!(next instanceof FakeDir)) {
        next = new FakeDir(part)
        dir.children.set(part, next)
      }
      dir = next
    }
    const file = new FakeFile(
      fileName,
      typeof content === 'string' ? new TextEncoder().encode(content) : content,
    )
    dir.children.set(fileName, file)
    return file
  }

  /** The type the code under test expects. */
  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle
  }
}

export class FakeStore {
  handle: FileSystemDirectoryHandle | undefined
  cleared = 0
  constructor(handle?: FileSystemDirectoryHandle) {
    this.handle = handle
  }
  async get() {
    return this.handle
  }
  async set(h: FileSystemDirectoryHandle) {
    this.handle = h
  }
  async clear() {
    this.handle = undefined
    this.cleared += 1
  }
}
