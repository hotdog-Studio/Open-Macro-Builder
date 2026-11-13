import { describe, expect, it } from 'vitest'
import { FakeDir, FakeStore, domError } from '../../test/fakeHandles'
import { BrowserFolder, createBrowserPlatform } from './browser'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

describe('BrowserFolder', () => {
  it('writes and reads nested files through directory handles', async () => {
    const root = new FakeDir('omb')
    const folder = new BrowserFolder(root.asHandle())
    expect(folder.name).toBe('omb')
    await folder.writeBytes('a/b/c.txt', bytes('hi'))
    expect(text(await folder.readBytes('a/b/c.txt'))).toBe('hi')
    await folder.writeBytes('a/b/c.txt', bytes('again'))
    expect(text(await folder.readBytes('a\\b\\c.txt'))).toBe('again')
    expect(await folder.list('a')).toEqual([{ name: 'b', kind: 'dir' }])
    expect(await folder.list('a/b')).toEqual([{ name: 'c.txt', kind: 'file' }])
    expect(await folder.list('')).toEqual([{ name: 'a', kind: 'dir' }])
  })

  it('reads a missing file as null and lists a missing folder as []', async () => {
    const folder = new BrowserFolder(new FakeDir('omb').asHandle())
    expect(await folder.readBytes('missing.txt')).toBeNull()
    expect(await folder.readBytes('no/such/file.txt')).toBeNull()
    expect(await folder.list('nope')).toEqual([])
  })

  it('reads a path that crosses a file as missing', async () => {
    const root = new FakeDir('omb')
    root.put('a', 'x')
    const folder = new BrowserFolder(root.asHandle())
    expect(await folder.readBytes('a/b.txt')).toBeNull()
    expect(await folder.list('a/b')).toEqual([])
  })

  it('lists entries sorted by name', async () => {
    const root = new FakeDir('omb')
    root.put('b.txt', '')
    root.put('a/x.txt', '')
    const folder = new BrowserFolder(root.asHandle())
    expect(await folder.list('')).toEqual([
      { name: 'a', kind: 'dir' },
      { name: 'b.txt', kind: 'file' },
    ])
  })

  it('removes a file, and resolves when it is missing', async () => {
    const root = new FakeDir('omb')
    root.put('a/b.txt', 'x')
    const folder = new BrowserFolder(root.asHandle())
    await folder.remove('a/b.txt')
    expect(await folder.readBytes('a/b.txt')).toBeNull()
    await expect(folder.remove('a/b.txt')).resolves.toBeUndefined()
    await expect(folder.remove('no/such/file.txt')).resolves.toBeUndefined()
  })

  it('normalises paths and rejects unsafe ones like MemoryFolder', async () => {
    const root = new FakeDir('omb')
    root.put('a/b.txt', 'x')
    const folder = new BrowserFolder(root.asHandle())
    expect(await folder.readBytes('a\\.\\b.txt')).not.toBeNull()
    await expect(folder.readBytes('../b.txt')).rejects.toThrow()
    await expect(folder.writeBytes('', bytes('x'))).rejects.toThrow()
    await expect(folder.list('/abs')).rejects.toThrow()
    await expect(folder.remove('C:/x')).rejects.toThrow()
  })

  it('lets other errors through', async () => {
    const root = new FakeDir('omb')
    root.failWith = 'NotAllowedError'
    const folder = new BrowserFolder(root.asHandle())
    await expect(folder.readBytes('x.txt')).rejects.toThrow()
  })

  it('lets an error from a parent folder through when reading, listing or writing below it', async () => {
    const root = new FakeDir('omb')
    root.put('a/x.txt', 'x')
    root.failWith = 'NotAllowedError'
    const folder = new BrowserFolder(root.asHandle())
    await expect(folder.readBytes('a/x.txt')).rejects.toMatchObject({ name: 'NotAllowedError' })
    await expect(folder.list('a')).rejects.toMatchObject({ name: 'NotAllowedError' })
    await expect(folder.remove('a/x.txt')).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('does not hide a failed remove as a missing file', async () => {
    const root = new FakeDir('omb')
    root.put('x.txt', 'x')
    root.failWith = 'NotAllowedError'
    await expect(new BrowserFolder(root.asHandle()).remove('x.txt')).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('leaves a file unchanged when the write fails before close', async () => {
    const root = new FakeDir('omb')
    const file = root.put('x.txt', 'old')
    file.createWritable = async () => ({
      write: async () => {
        throw domError('QuotaExceededError')
      },
      close: async () => {
        throw new Error('close must not be reached')
      },
      abort: async () => {},
    })
    const folder = new BrowserFolder(root.asHandle())
    await expect(folder.writeBytes('x.txt', bytes('new'))).rejects.toThrow()
    expect(text(file.data)).toBe('old')
  })
})

function platformWith(opts: { handle?: FakeDir; pick?: () => Promise<FileSystemDirectoryHandle> } = {}) {
  const store = new FakeStore(opts.handle?.asHandle())
  const platform = createBrowserPlatform({
    pick: opts.pick ?? (async () => new FakeDir('picked').asHandle()),
    store,
  })
  return { platform, store }
}

describe('createBrowserPlatform', () => {
  it('is the browser platform', () => {
    expect(platformWith().platform.kind).toBe('browser')
  })

  describe('restoreFolder', () => {
    it('returns null when nothing is remembered', async () => {
      expect(await platformWith().platform.restoreFolder()).toBeNull()
    })

    it('restoreFolder treats a failing store as nothing remembered', async () => {
      const platform = createBrowserPlatform({
        pick: async () => new FakeDir('x').asHandle(),
        store: {
          get: async () => {
            throw new Error('IndexedDB blocked')
          },
          set: async () => {},
          clear: async () => {},
        },
      })
      expect(await platform.restoreFolder()).toBeNull()
    })

    it('returns the folder when permission is granted', async () => {
      const dir = new FakeDir('omb')
      dir.put('config.json', '{}')
      const result = await platformWith({ handle: dir }).platform.restoreFolder()
      expect(result).toMatchObject({ folder: { name: 'omb' } })
      const folder = (result as { folder: BrowserFolder }).folder
      expect(text(await folder.readBytes('config.json'))).toBe('{}')
    })

    it('asks for a click when permission is "prompt"', async () => {
      const dir = new FakeDir('omb')
      dir.permission = 'prompt'
      const { platform, store } = platformWith({ handle: dir })
      expect(await platform.restoreFolder()).toEqual({ needsPermission: 'omb' })
      expect(store.cleared).toBe(0)
    })

    it('says the folder is lost when the handle throws NotFoundError', async () => {
      const dir = new FakeDir('omb')
      dir.permissionFailWith = 'NotFoundError'
      const { platform, store } = platformWith({ handle: dir })
      expect(await platform.restoreFolder()).toEqual({
        lost: 'The folder omb is no longer available. Open it again.',
      })
      expect(store.cleared).toBe(1)
      expect(store.handle).toBeUndefined()
    })

    it('lets a permission check that fails for another reason through', async () => {
      const dir = new FakeDir('omb')
      dir.permissionFailWith = 'SecurityError'
      await expect(platformWith({ handle: dir }).platform.restoreFolder()).rejects.toMatchObject({ name: 'SecurityError' })
    })

    it('says the folder is lost when it cannot be listed', async () => {
      const dir = new FakeDir('omb')
      dir.failWith = 'NotFoundError'
      const { platform, store } = platformWith({ handle: dir })
      expect(await platform.restoreFolder()).toEqual({
        lost: 'The folder omb is no longer available. Open it again.',
      })
      expect(store.cleared).toBe(1)
    })
  })

  describe('grantPermission', () => {
    it('returns the folder once permission is granted from a click', async () => {
      const dir = new FakeDir('omb')
      dir.permission = 'prompt'
      const { platform } = platformWith({ handle: dir })
      await platform.restoreFolder()
      const result = await platform.grantPermission!()
      expect(result).toMatchObject({ folder: { name: 'omb' } })
    })

    it('grantPermission returns null when the user declines', async () => {
      const dir = new FakeDir('omb')
      dir.permission = 'prompt'
      dir.requested = 'denied'
      const { platform, store } = platformWith({ handle: dir })
      expect(await platform.grantPermission!()).toBeNull()
      expect(store.cleared).toBe(0)
    })

    it('grantPermission reports a folder that disappeared', async () => {
      const dir = new FakeDir('omb')
      dir.permission = 'prompt'
      dir.failWith = 'NotFoundError'
      const { platform, store } = platformWith({ handle: dir })
      expect(await platform.grantPermission!()).toEqual({
        lost: 'The folder omb is no longer available. Open it again.',
      })
      expect(store.cleared).toBe(1)
    })

    it('grantPermission reports a folder whose permission request finds it gone', async () => {
      const dir = new FakeDir('omb')
      dir.permission = 'prompt'
      dir.permissionFailWith = 'NotFoundError'
      const { platform, store } = platformWith({ handle: dir })
      expect(await platform.grantPermission!()).toEqual({
        lost: 'The folder omb is no longer available. Open it again.',
      })
      expect(store.cleared).toBe(1)
    })

    it('lets a permission request that fails for another reason through', async () => {
      const dir = new FakeDir('omb')
      dir.permission = 'prompt'
      dir.permissionFailWith = 'SecurityError'
      const { platform, store } = platformWith({ handle: dir })
      await expect(platform.grantPermission!()).rejects.toMatchObject({ name: 'SecurityError' })
      expect(store.cleared).toBe(0)
    })

    it('finds the remembered folder in the store when restoreFolder did not run first', async () => {
      const dir = new FakeDir('omb')
      dir.put('config.json', '{}')
      dir.permission = 'prompt'
      const result = await platformWith({ handle: dir }).platform.grantPermission!()
      expect(result).toMatchObject({ folder: { name: 'omb' } })
    })

    it('returns null when nothing is remembered', async () => {
      expect(await platformWith().platform.grantPermission!()).toBeNull()
    })
  })

  describe('openFolder', () => {
    it('returns the picked folder and remembers it', async () => {
      const picked = new FakeDir('chosen')
      const { platform, store } = platformWith({ pick: async () => picked.asHandle() })
      const folder = await platform.openFolder()
      expect(folder?.name).toBe('chosen')
      expect(store.handle).toBe(picked.asHandle())
    })

    it('resolves null when the picker is cancelled', async () => {
      const { platform, store } = platformWith({
        pick: async () => {
          throw domError('AbortError')
        },
      })
      expect(await platform.openFolder()).toBeNull()
      expect(store.handle).toBeUndefined()
    })

    it('lets other picker errors through', async () => {
      const { platform } = platformWith({
        pick: async () => {
          throw domError('SecurityError')
        },
      })
      await expect(platform.openFolder()).rejects.toThrow()
    })

    it('lets a picker that throws something other than an error through', async () => {
      const { platform, store } = platformWith({
        pick: () => Promise.reject('boom'),
      })
      await expect(platform.openFolder()).rejects.toBe('boom')
      expect(store.handle).toBeUndefined()
    })

    it('still opens the folder when it cannot be remembered', async () => {
      const platform = createBrowserPlatform({
        pick: async () => new FakeDir('chosen').asHandle(),
        store: {
          get: async () => undefined,
          set: async () => {
            throw new Error('IndexedDB unavailable')
          },
          clear: async () => {},
        },
      })
      expect((await platform.openFolder())?.name).toBe('chosen')
    })
  })
})
