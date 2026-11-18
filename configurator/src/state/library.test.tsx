/** @vitest-environment jsdom */
import { act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startCommands } from '../../test/commandsTab'
import { MemoryFolder } from '../core/folder/memory'

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
})
