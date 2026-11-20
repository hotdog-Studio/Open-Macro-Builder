import type { DirEntry, FolderAccess } from '../src/core/folder/types'

/** One call made to a GuardedFolder. */
export interface FolderCall {
  op: 'readBytes' | 'writeBytes' | 'list' | 'remove'
  path: string
}

/** Whether a folder path is the root's local folder or under it, compared ignoring case. */
function underLocal(path: string): boolean {
  const lower = path.toLowerCase()
  return lower === 'local' || lower.startsWith('local/')
}

/**
 * A FolderAccess around another that catches what a test must never see done: any call on a path
 * under local/ (any case), and a readBytes of a path `mayRead` refuses (say, a path no version ever
 * had). Such a call rejects, as a real folder's failure does, and is kept in `refused`, so code that
 * swallowed the rejection is still caught. Every call, allowed or not, is kept in `calls` in order.
 * A test can also make an allowed call fail, as a full disk would, with `fails`.
 */
export class GuardedFolder implements FolderAccess {
  readonly calls: FolderCall[] = []
  readonly refused: FolderCall[] = []
  /** When set, an allowed call it picks (given every call so far, this one last) rejects with `failure`. */
  fails: ((call: FolderCall, calls: readonly FolderCall[]) => boolean) | null = null
  /** What a call that `fails` picks rejects with. */
  failure: unknown = new Error('The folder failed.')

  constructor(
    private readonly inner: FolderAccess,
    private readonly mayRead: (path: string) => boolean,
  ) {}

  get name(): string {
    return this.inner.name
  }

  readBytes(path: string): Promise<Uint8Array | null> {
    return this.guard({ op: 'readBytes', path }, this.mayRead(path), () => this.inner.readBytes(path))
  }

  writeBytes(path: string, data: Uint8Array): Promise<void> {
    return this.guard({ op: 'writeBytes', path }, true, () => this.inner.writeBytes(path, data))
  }

  list(dir: string): Promise<DirEntry[]> {
    return this.guard({ op: 'list', path: dir }, true, () => this.inner.list(dir))
  }

  remove(path: string): Promise<void> {
    return this.guard({ op: 'remove', path }, true, () => this.inner.remove(path))
  }

  private guard<T>(call: FolderCall, allowed: boolean, run: () => Promise<T>): Promise<T> {
    this.calls.push(call)
    if (!allowed || underLocal(call.path)) {
      this.refused.push(call)
      return Promise.reject(new Error(`${call.op} of "${call.path}" is not allowed here`))
    }
    return this.fails?.(call, this.calls) ? Promise.reject(this.failure) : run()
  }
}
