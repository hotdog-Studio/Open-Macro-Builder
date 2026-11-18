/** @vitest-environment jsdom */
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exampleFolder, startCommands } from '../../test/commandsTab'
import { MemoryFolder } from '../core/folder/memory'
import { LANGUAGES } from '../core/languages'

const INPUT = 'powershell/lib/Input.ps1'
const enc = new TextEncoder()

/** Holds `of.list('powershell/lib')` until released; `reached` resolves when a read gets there. */
function holdLibraryList(of: MemoryFolder) {
  let release!: () => void
  let reach!: () => void
  const gate = new Promise<void>((done) => (release = done))
  const reached = new Promise<void>((done) => (reach = done))
  const list = MemoryFolder.prototype.list
  vi.spyOn(MemoryFolder.prototype, 'list').mockImplementation(async function (this: MemoryFolder, dir: string) {
    if (this === of && dir === 'powershell/lib') {
      reach()
      await gate
    }
    return list.call(this, dir)
  })
  return { reached, release }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the library of the opened folder', () => {
  it('holds the library of the opened folder', async () => {
    const { editor } = await startCommands({ library: true })
    expect(editor().libraryFiles.map((f) => f.name)).toContain('Input')
  })

  it('takes up a new library file on the next recheck of the command files, and a change to it on the one after', async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    await folder.writeBytes('powershell/lib/New.ps1', new TextEncoder().encode('function Get-New {\n}\n'))
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles.map((f) => f.name)).toContain('New')
    // The same files, one of them edited: only its bytes tell the two libraries apart.
    await folder.writeBytes('powershell/lib/New.ps1', enc.encode('function Get-Newer {\n}\n'))
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles.find((f) => f.name === 'New')!.functions.map((f) => f.name)).toEqual(['Get-Newer'])
  })

  it('takes up a changed library file on the next recheck', async () => {
    const { folder, app, editor } = await startCommands({ files: { 'powershell/lib/Demo.ps1': 'function Get-Old {\n}\n' } })
    await folder.writeBytes('powershell/lib/Demo.ps1', enc.encode('function Get-New {\n}\n'))
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles.find((f) => f.name === 'Demo')!.functions.map((f) => f.name)).toEqual(['Get-New'])
  })

  it('keeps the same library when nothing in it changed', async () => {
    const { app, editor } = await startCommands({ library: true })
    const before = editor().libraryFiles
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles).toBe(before)
  })

  it('drops a library file removed from the folder', async () => {
    const { folder, app, editor } = await startCommands({ library: true })
    await folder.remove(INPUT)
    await act(() => app().actions.recheckCommands())
    const names = editor().libraryFiles.map((f) => f.name)
    expect(names).not.toContain('Input')
    expect(names).toContain('Window')
  })

  it('keeps the library it holds when a recheck cannot read it', async () => {
    const { app, editor } = await startCommands({ library: true })
    const before = editor().libraryFiles
    const read = MemoryFolder.prototype.readBytes
    vi.spyOn(MemoryFolder.prototype, 'readBytes').mockImplementation(function (this: MemoryFolder, path: string) {
      if (path.startsWith('powershell/lib/')) return Promise.reject(new Error(`${path} is locked`))
      return read.call(this, path)
    })
    await act(() => app().actions.recheckCommands())
    expect(editor().libraryFiles).toBe(before)
  })

  it('never writes a library file', async () => {
    const write = vi.spyOn(MemoryFolder.prototype, 'writeBytes')
    const { folder, app } = await startCommands({ library: true })
    await folder.writeBytes('powershell/lib/New.ps1', enc.encode('function Get-New {\n}\n'))
    await act(() => app().actions.recheckCommands())
    await act(() => app().actions.reloadFromDisk())
    // The one write to the library is the test's own.
    expect(write.mock.calls.filter(([path]) => path.startsWith('powershell/lib/')).map(([path]) => path)).toEqual(['powershell/lib/New.ps1'])
  })

  it('drops a library read of a folder that was replaced while it ran', async () => {
    const next = await exampleFolder({ files: { 'powershell/lib/Next.ps1': 'function Get-Next {\n}\n' } })
    const { folder, app, editor, user } = await startCommands({ library: true, next })
    const hold = holdLibraryList(folder)
    const recheck = app().actions.recheckCommands()
    await hold.reached
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(editor().libraryFiles.map((f) => f.name)).toEqual(['Next']))
    hold.release()
    await act(() => recheck)
    expect(editor().libraryFiles.map((f) => f.name)).toEqual(['Next'])
  })

  it('drops a library read of a folder that was closed while it ran, when another is opened', async () => {
    const next = await exampleFolder({ files: { 'powershell/lib/Next.ps1': 'function Get-Next {\n}\n' } })
    const { folder, app, editor, user } = await startCommands({ library: true, next })
    const hold = holdLibraryList(folder)
    const recheck = app().actions.recheckCommands()
    await hold.reached
    act(() => app().actions.closeFolder())
    expect(app().state.screen).not.toBe('edit')
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(editor().libraryFiles.map((f) => f.name)).toEqual(['Next']))
    hold.release()
    await act(() => recheck)
    expect(editor().libraryFiles.map((f) => f.name)).toEqual(['Next'])
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
