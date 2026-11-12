import { describe, expect, it } from 'vitest'
import { MemoryFolder } from '../core/folder/memory'
import { PathError } from '../core/folder/path'
import { createElectronPlatform, type OmbBridge } from './electron'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

/** A bridge over a MemoryFolder that records what the platform asked of it. */
function fakeBridge(opts: { open?: string | null; restore?: string | null | { lost: string } } = {}) {
  const disk = new MemoryFolder('macropad_ahk', { 'config.json': '{}' })
  const calls: string[] = []
  const watched: string[][] = []
  const listeners = new Set<(rel: string) => void>()
  const bridge: OmbBridge = {
    openFolder: async () => opts.open ?? null,
    restoreFolder: async () => opts.restore ?? null,
    readBytes: async (rel) => {
      calls.push(`read ${rel}`)
      return disk.readBytes(rel)
    },
    writeBytes: async (rel, data) => {
      calls.push(`write ${rel}`)
      return disk.writeBytes(rel, data)
    },
    list: async (rel) => {
      calls.push(`list ${rel}`)
      return disk.list(rel)
    },
    remove: async (rel) => {
      calls.push(`remove ${rel}`)
      return disk.remove(rel)
    },
    watch: async (rels) => {
      watched.push(rels)
    },
    onChanged: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    findMacropad: async () => null,
    reloadMacropad: async () => null,
    installedLanguages: async () => [],
    checkSyntax: async (lang, rel) => {
      calls.push(`check ${lang} ${rel}`)
      return { ok: false, problems: [{ path: rel, line: 3, message: 'Missing "}"' }] }
    },
  }
  const emit = (rel: string) => listeners.forEach((cb) => cb(rel))
  return { bridge, disk, calls, watched, listeners, emit }
}

describe('createElectronPlatform', () => {
  it('maps restoreFolder results, including lost', async () => {
    const lost = 'The folder macropad_ahk is no longer available. Open it again.'
    expect(await createElectronPlatform(fakeBridge({ restore: { lost } }).bridge).restoreFolder()).toEqual({ lost })
    expect(await createElectronPlatform(fakeBridge({ restore: null }).bridge).restoreFolder()).toBeNull()
    const restored = await createElectronPlatform(fakeBridge({ restore: 'macropad_ahk' }).bridge).restoreFolder()
    expect(restored && 'folder' in restored && restored.folder.name).toBe('macropad_ahk')
  })

  it('opens a folder, or null when the user cancels', async () => {
    const platform = createElectronPlatform(fakeBridge({ open: 'macropad_ahk' }).bridge)
    expect(platform.kind).toBe('electron')
    expect((await platform.openFolder())?.name).toBe('macropad_ahk')
    expect(await createElectronPlatform(fakeBridge({ open: null }).bridge).openFolder()).toBeNull()
  })

  it('sends folder calls through the bridge with normalised paths', async () => {
    const { bridge, disk, calls } = fakeBridge({ open: 'macropad_ahk' })
    const folder = (await createElectronPlatform(bridge).openFolder())!
    expect(text(await folder.readBytes('config.json'))).toBe('{}')
    await folder.writeBytes('local\\config.json', bytes('{"a":1}'))
    expect(disk.text('local/config.json')).toBe('{"a":1}')
    expect(await folder.list('')).toEqual([
      { name: 'config.json', kind: 'file' },
      { name: 'local', kind: 'dir' },
    ])
    await folder.remove('./local/config.json')
    expect(calls).toEqual(['read config.json', 'write local/config.json', 'list ', 'remove local/config.json'])
  })

  it('refuses paths outside the folder without asking the main process', async () => {
    const { bridge, calls } = fakeBridge({ open: 'macropad_ahk' })
    const folder = (await createElectronPlatform(bridge).openFolder())!
    await expect(folder.readBytes('../x')).rejects.toBeInstanceOf(PathError)
    await expect(folder.writeBytes('C:/x', bytes('x'))).rejects.toBeInstanceOf(PathError)
    await expect(folder.list('..')).rejects.toBeInstanceOf(PathError)
    await expect(folder.remove('/x')).rejects.toBeInstanceOf(PathError)
    expect(calls).toEqual([])
  })

  it('watches files and stops watching', async () => {
    const { bridge, watched, listeners, emit } = fakeBridge()
    const platform = createElectronPlatform(bridge)
    const changed: string[] = []
    const stop = platform.watch!(['local/config.json'], (rel) => changed.push(rel))
    expect(watched).toEqual([['local/config.json']])
    emit('local/config.json')
    emit('config.json')
    expect(changed).toEqual(['local/config.json'])
    stop()
    expect(listeners.size).toBe(0)
    expect(watched).toEqual([['local/config.json'], []])
    emit('local/config.json')
    expect(changed).toEqual(['local/config.json'])
  })

  it('does not clear a newer watch when an older one stops late', () => {
    const { bridge, watched } = fakeBridge()
    const platform = createElectronPlatform(bridge)
    const stopOld = platform.watch!(['config.json'], () => {})
    platform.watch!(['local/config.json'], () => {})
    stopOld()
    expect(watched).toEqual([['config.json'], ['local/config.json']])
  })

  it('asks the bridge about the macropad and installed languages', async () => {
    const platform = createElectronPlatform(fakeBridge().bridge)
    expect(await platform.findMacropad!()).toBeNull()
    expect(await platform.reloadMacropad!()).toBeNull()
    expect(await platform.installedLanguages!()).toEqual([])
  })

  it('checkSyntax goes through the bridge', async () => {
    const { bridge, calls } = fakeBridge()
    const platform = createElectronPlatform(bridge)
    expect(await platform.checkSyntax!('ps', 'local\\powershell\\commands\\mine.ps1')).toEqual({
      ok: false,
      problems: [{ path: 'local/powershell/commands/mine.ps1', line: 3, message: 'Missing "}"' }],
    })
    expect(calls).toEqual(['check ps local/powershell/commands/mine.ps1'])
    // A path outside the folder never reaches the main process.
    await expect(platform.checkSyntax!('ahk', '../x.ahk')).rejects.toBeInstanceOf(PathError)
    expect(calls).toHaveLength(1)
  })
})
