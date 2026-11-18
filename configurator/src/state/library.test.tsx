/** @vitest-environment jsdom */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startCommands } from '../../test/commandsTab'
import { MemoryFolder } from '../core/folder/memory'
import { LANGUAGES } from '../core/languages'

const INPUT = 'powershell/lib/Input.ps1'
const enc = new TextEncoder()

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the library of the opened folder', () => {
  it('holds the library of the opened folder', async () => {
    const { editor } = await startCommands({ library: true })
    expect(editor().libraryFiles.map((f) => f.name)).toContain('Input')
  })

  it('takes up a new library file on the next recheck of the command files', async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    await folder.writeBytes('powershell/lib/New.ps1', new TextEncoder().encode('function Get-New {\n}\n'))
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles.map((f) => f.name)).toContain('New')
  })

  it('opens a folder that has no library', async () => {
    const { editor } = await startCommands()
    expect(editor().libraryFiles).toEqual([])
  })

  it('opens a folder whose library cannot be read, without the library', async () => {
    const read = MemoryFolder.prototype.readBytes
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(function (this: MemoryFolder, path: string) {
      if (path.startsWith('powershell/lib/')) return Promise.reject(new Error(`${path} is locked`))
      return read.call(this, path)
    })
    const { editor } = await startCommands({ library: true })
    expect(editor().libraryFiles).toEqual([])
    expect(editor().commandFiles.map((f) => f.file.path)).toContain('powershell/commands/helper.ps1')
  })

  it('keeps the library of the recheck that started last, whichever read ends first', async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    const gates: (() => void)[] = []
    const read = MemoryFolder.prototype.readBytes
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(async function (this: MemoryFolder, path: string) {
      const bytes = await read.call(this, path)
      if (path === INPUT) await new Promise<void>((done) => gates.push(done))
      return bytes
    })
    await folder.writeBytes(INPUT, enc.encode('# Library A\nfunction Get-A {\n}\n'))
    const first = app().actions.recheckCommands()
    await waitFor(() => expect(gates).toHaveLength(1))
    await folder.writeBytes(INPUT, enc.encode('# Library B\nfunction Get-B {\n}\n'))
    const second = app().actions.recheckCommands()
    await waitFor(() => expect(gates).toHaveLength(2))
    gates[1]()
    await act(() => second)
    gates[0]()
    await act(() => first)
    expect(editor().libraryFiles.find((f) => f.name === 'Input')!.title).toBe('Library B')
  })

  it("keeps a newer recheck's library over a reload's that read it earlier", async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    const gates: (() => void)[] = []
    const read = MemoryFolder.prototype.readBytes
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(async function (this: MemoryFolder, path: string) {
      const bytes = await read.call(this, path)
      if (path === INPUT) await new Promise<void>((done) => gates.push(done))
      return bytes
    })
    await folder.writeBytes(INPUT, enc.encode('# Library A\nfunction Get-A {\n}\n'))
    const reload = app().actions.reloadFromDisk()
    await waitFor(() => expect(gates).toHaveLength(1))
    await folder.writeBytes(INPUT, enc.encode('# Library B\nfunction Get-B {\n}\n'))
    const recheck = app().actions.recheckCommands()
    await waitFor(() => expect(gates).toHaveLength(2))
    gates[1]()
    await act(() => recheck)
    expect(editor().libraryFiles.find((f) => f.name === 'Input')!.title).toBe('Library B')
    gates[0]()
    await act(() => reload)
    expect(editor().libraryFiles.find((f) => f.name === 'Input')!.title).toBe('Library B')
  })

  it("takes a recheck's library when a reload that started after it fails", async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    const gates: (() => void)[] = []
    const read = MemoryFolder.prototype.readBytes
    let configLocked = false
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(async function (this: MemoryFolder, path: string) {
      if (configLocked && path.endsWith('config.json')) throw new Error(`${path} is locked`)
      const bytes = await read.call(this, path)
      if (path === INPUT) await new Promise<void>((done) => gates.push(done))
      return bytes
    })
    await folder.writeBytes(INPUT, enc.encode('# Library A\nfunction Get-A {\n}\n'))
    const recheck = app().actions.recheckCommands()
    await waitFor(() => expect(gates).toHaveLength(1))
    configLocked = true
    await act(() => app().actions.reloadFromDisk())
    gates[0]()
    await act(() => recheck)
    expect(editor().libraryFiles.find((f) => f.name === 'Input')!.title).toBe('Library A')
  })

  it('does not read the functions of an unchanged library again on a recheck', async () => {
    const { app } = await startCommands({ library: true })
    const parse = vi.spyOn(LANGUAGES.ps, 'findFunctions')
    await act(() => app().actions.recheckCommands())
    expect(parse.mock.calls.filter(([text]) => text.includes('function Send-Chord'))).toEqual([])
  })

  it('keeps the library on a reload from disk that cannot read it', async () => {
    const { app, editor } = await startCommands({ library: true })
    const before = editor().libraryFiles
    const read = MemoryFolder.prototype.readBytes
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(function (this: MemoryFolder, path: string) {
      if (path === INPUT) return Promise.reject(new Error(`${path} is locked`))
      return read.call(this, path)
    })
    await act(() => app().actions.reloadFromDisk())
    expect(editor().libraryFiles).toEqual(before)
  })

  it('rechecks the library even when the command files cannot be read', async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    await folder.writeBytes('powershell/lib/New.ps1', enc.encode('function Get-New {\n}\n'))
    const read = MemoryFolder.prototype.readBytes
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(function (this: MemoryFolder, path: string) {
      if (path === 'ahk/commands/media.ahk') return Promise.reject(new Error(`${path} is locked`))
      return read.call(this, path)
    })
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles.map((f) => f.name)).toContain('New')
  })
})
