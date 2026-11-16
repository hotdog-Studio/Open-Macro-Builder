import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo } from '../../test/repo'
import { loadStarter } from './starter'

describe('loadStarter', () => {
  it('loads the starter with the bytes of the repository files', async () => {
    const files = await loadStarter()
    const main = files.find((f) => f.path === 'ahk/main.ahk')
    expect(main?.data).toEqual(await memoryFolderFromRepo(['ahk/main.ahk']).readBytes('ahk/main.ahk'))
    expect(files.find((f) => f.path === 'img/blank.png')?.data.length).toBeGreaterThan(0)
    expect(files.some((f) => f.path === 'config.json')).toBe(true)
  })
})
