import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo } from '../../test/repo'
import { MemoryFolder } from './folder/memory'
import { copyExampleConfig, inspectFolder, listIconSets } from './repo'

describe('inspectFolder', () => {
  it('uses config.json when there is no local copy', async () => {
    const folder = new MemoryFolder('r', { 'config.json': '{}', 'ahk/main.ahk': '' })
    expect(await inspectFolder(folder)).toEqual({ ok: true, configPath: 'config.json' })
  })

  it('prefers local/config.json', async () => {
    const folder = new MemoryFolder('r', { 'config.json': '{}', 'ahk/main.ahk': '', 'local/config.json': '{}' })
    expect(await inspectFolder(folder)).toEqual({ ok: true, configPath: 'local/config.json' })
  })

  it('accepts a powershell folder instead of ahk', async () => {
    const folder = new MemoryFolder('r', { 'config.json': '{}', 'powershell/main.ps1': '' })
    expect(await inspectFolder(folder)).toEqual({ ok: true, configPath: 'config.json' })
  })

  it('explains a folder that is not the repository', async () => {
    const folder = new MemoryFolder('r', { 'readme.md': 'hi' })
    expect(await inspectFolder(folder)).toEqual({
      ok: false,
      reason: "This folder doesn't look like Open Macro Builder: it needs config.json and an ahk or powershell folder.",
    })
  })

  it('refuses a folder with a config but no script folder', async () => {
    const folder = new MemoryFolder('r', { 'config.json': '{}' })
    expect((await inspectFolder(folder)).ok).toBe(false)
  })
})

describe('copyExampleConfig', () => {
  it('copies the bytes exactly into local/config.json', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x0d, 0x0a, 0x7d])
    const folder = new MemoryFolder('r', { 'config.json': bytes })
    await copyExampleConfig(folder)
    expect(await folder.readBytes('local/config.json')).toEqual(bytes)
  })

  it('rejects when the target exists', async () => {
    const folder = new MemoryFolder('r', { 'config.json': '{}', 'local/config.json': '{"mine":1}' })
    await expect(copyExampleConfig(folder)).rejects.toThrow()
    expect(folder.text('local/config.json')).toBe('{"mine":1}')
  })
})

describe('listIconSets', () => {
  it('lists folders with a layer.png, sorted, without template', async () => {
    const folder = new MemoryFolder('r', {
      'img/media/layer.png': 'x',
      'img/chrome/layer.png': 'x',
      'img/template/macro.png': 'x',
      'img/template/layer.png': 'x',
      'img/empty_1x1.png': 'x',
      'img/nolayer/macro.png': 'x',
    })
    expect(await listIconSets(folder)).toEqual(['chrome', 'media'])
  })

  it('finds the repository icon sets', async () => {
    const sets = await listIconSets(memoryFolderFromRepo(['img']))
    expect(sets).toContain('media')
    expect(sets).not.toContain('template')
  })
})
