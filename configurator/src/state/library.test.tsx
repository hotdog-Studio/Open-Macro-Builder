/** @vitest-environment jsdom */
import { act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { startCommands } from '../../test/commandsTab'

afterEach(cleanup)

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
})
