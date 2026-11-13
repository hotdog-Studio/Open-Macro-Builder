import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmbBridge } from '../src/platform/electron'
import { CHANNELS } from './channels'

// The preload runs once when Electron loads it, so each test imports a fresh copy against fakes.
const electron = vi.hoisted(() => ({
  exposed: [] as Array<[string, unknown]>,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => electron.exposed.push([name, api]) },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
}))

/** Compile-time list: adding a method to OmbBridge fails type checking here until the test knows it. */
const BRIDGE_METHODS: Record<keyof OmbBridge, true> = {
  openFolder: true,
  restoreFolder: true,
  readBytes: true,
  writeBytes: true,
  list: true,
  remove: true,
  watch: true,
  onChanged: true,
  findMacropad: true,
  reloadMacropad: true,
  installedLanguages: true,
  checkSyntax: true,
}

async function loadBridge(): Promise<OmbBridge> {
  vi.resetModules()
  await import('./preload')
  return electron.exposed.at(-1)![1] as OmbBridge
}

beforeEach(() => {
  electron.exposed.length = 0
  electron.invoke.mockReset()
  electron.invoke.mockResolvedValue('answer')
  electron.on.mockReset()
  electron.removeListener.mockReset()
})

describe('preload', () => {
  it('exposes one object, window.omb, and nothing else', async () => {
    await loadBridge()
    expect(electron.exposed).toHaveLength(1)
    expect(electron.exposed[0][0]).toBe('omb')
  })

  it('exposes exactly the functions the page expects, and no ipcRenderer or Node', async () => {
    const bridge = await loadBridge()
    expect(Object.keys(bridge).sort()).toEqual(Object.keys(BRIDGE_METHODS).sort())
    for (const value of Object.values(bridge)) expect(typeof value).toBe('function')
  })

  // Each method must reach the channel the main process answers; a typo would fail only at runtime.
  it.each([
    ['openFolder', CHANNELS.openFolder, []],
    ['restoreFolder', CHANNELS.restoreFolder, []],
    ['readBytes', CHANNELS.readBytes, ['a.txt']],
    ['writeBytes', CHANNELS.writeBytes, ['a.txt', new Uint8Array([1, 2])]],
    ['list', CHANNELS.list, ['sub']],
    ['remove', CHANNELS.remove, ['a.txt']],
    ['watch', CHANNELS.watch, [['a.txt', 'b.txt']]],
    ['findMacropad', CHANNELS.findMacropad, []],
    ['reloadMacropad', CHANNELS.reloadMacropad, []],
    ['installedLanguages', CHANNELS.installedLanguages, []],
    ['checkSyntax', CHANNELS.checkSyntax, ['ahk', 'ahk/main.ahk']],
  ] as const)('%s invokes its own channel with its arguments and returns the answer', async (method, channel, args) => {
    const bridge = (await loadBridge()) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    expect(await bridge[method](...args)).toBe('answer')
    expect(electron.invoke).toHaveBeenCalledTimes(1)
    expect(electron.invoke).toHaveBeenCalledWith(channel, ...args)
  })

  it('uses a different channel for every method', () => {
    const names = Object.values(CHANNELS)
    expect(new Set(names).size).toBe(names.length)
  })

  it('passes a refusal from the main process on to the page', async () => {
    const bridge = await loadBridge()
    electron.invoke.mockRejectedValue(new Error('No folder is open.'))
    await expect(bridge.list('')).rejects.toThrow('No folder is open.')
  })

  describe('onChanged', () => {
    it('listens on the changed channel and hands the page only the path, not the event', async () => {
      const bridge = await loadBridge()
      const cb = vi.fn()
      bridge.onChanged(cb)
      expect(electron.on).toHaveBeenCalledTimes(1)
      const [channel, listener] = electron.on.mock.calls[0]
      expect(channel).toBe(CHANNELS.changed)
      listener({ sender: 'secret ipc event' }, 'config.json')
      expect(cb).toHaveBeenCalledOnce()
      expect(cb).toHaveBeenCalledWith('config.json')
    })

    it('returns a function that removes exactly the listener it added', async () => {
      const bridge = await loadBridge()
      const stop = bridge.onChanged(vi.fn())
      expect(electron.removeListener).not.toHaveBeenCalled()
      stop()
      expect(electron.removeListener).toHaveBeenCalledWith(CHANNELS.changed, electron.on.mock.calls[0][1])
    })

    it('keeps two subscriptions apart', async () => {
      const bridge = await loadBridge()
      const a = vi.fn()
      const b = vi.fn()
      bridge.onChanged(a)
      bridge.onChanged(b)
      const [first, second] = electron.on.mock.calls.map((c) => c[1])
      expect(first).not.toBe(second)
      first({}, 'x')
      expect(a).toHaveBeenCalledWith('x')
      expect(b).not.toHaveBeenCalled()
    })
  })
})
