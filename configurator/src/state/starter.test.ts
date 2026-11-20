import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo } from '../../test/repo'
import { fingerprint } from '../core/update/fingerprint'
import { loadStarter, loadStarterIndex } from './starter'

describe('loadStarter', () => {
  it('loads the starter with the bytes of the repository files', async () => {
    const files = await loadStarter()
    const main = files.find((f) => f.path === 'ahk/main.ahk')
    expect(main?.data).toEqual(await memoryFolderFromRepo(['ahk/main.ahk']).readBytes('ahk/main.ahk'))
    expect(files.find((f) => f.path === 'img/blank.png')?.data.length).toBeGreaterThan(0)
    expect(files.some((f) => f.path === 'config.json')).toBe(true)
  })
})

describe('loadStarterIndex', () => {
  it('has a version and the fingerprint of each file the starter carries', async () => {
    const [index, files] = await Promise.all([loadStarterIndex(), loadStarter()])
    expect(index.version).toMatch(/^\d+\.\d+\.\d+(-dev)?$/)
    expect(Object.keys(index.files)).toEqual(files.map((f) => f.path))
  })

  it('has the fingerprints the page works out from the same bytes', async () => {
    const [index, files] = await Promise.all([loadStarterIndex(), loadStarter()])
    const worked = await Promise.all(files.map(async ({ path, data }) => [path, await fingerprint(path, data)]))
    expect(index.files).toEqual(Object.fromEntries(worked))
  })
})
