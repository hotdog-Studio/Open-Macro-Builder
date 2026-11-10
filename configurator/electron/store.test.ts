import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetLastFolder, restoreLastFolder, saveLastFolder } from './store'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omb-store-'))
  file = join(dir, 'userData', 'omb-electron.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('restoreLastFolder', () => {
  it('returns the remembered folder', async () => {
    const folder = join(dir, 'macropad_ahk')
    await mkdir(folder)
    saveLastFolder(file, folder)
    expect(restoreLastFolder(file)).toBe(folder)
  })

  it('reports a remembered folder that was deleted as lost', async () => {
    const folder = join(dir, 'macropad_ahk')
    await mkdir(folder)
    saveLastFolder(file, folder)
    await rm(folder, { recursive: true })
    expect(restoreLastFolder(file)).toEqual({
      lost: 'The folder macropad_ahk is no longer available. Open it again.',
    })
  })

  it('returns null when nothing is remembered', async () => {
    expect(restoreLastFolder(file)).toBeNull()
    await mkdir(join(dir, 'userData'))
    await writeFile(file, 'not json')
    expect(restoreLastFolder(file)).toBeNull()
    await writeFile(file, '{"lastFolder": 3}')
    expect(restoreLastFolder(file)).toBeNull()
  })

  it('forgets the remembered folder', async () => {
    const folder = join(dir, 'macropad_ahk')
    await mkdir(folder)
    saveLastFolder(file, folder)
    forgetLastFolder(file)
    expect(restoreLastFolder(file)).toBeNull()
    expect(() => forgetLastFolder(file)).not.toThrow()
  })
})
