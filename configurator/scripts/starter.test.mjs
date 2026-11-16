// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { listStarterFiles, starterPlugin } from './starter.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('listStarterFiles', () => {
  const files = listStarterFiles(repoRoot)

  it('holds what the macropad needs to run', () => {
    for (const path of [
      'config.json',
      'ahk/main.ahk',
      'ahk/config.ahk',
      'powershell/main.ps1',
      'img/icon.ico',
      'img/blank.png',
    ])
      expect(files).toContain(path)
  })

  it('leaves out tests, personal files, image sources and leftovers', () => {
    expect(files.filter((p) => /(^|\/)(tests|local)\//.test(p))).toEqual([])
    expect(files.filter((p) => /\.(xcf|bak|omb-tmp)$/.test(p))).toEqual([])
  })

  it('stays inside the four sources, with forward slashes, sorted', () => {
    expect(files.every((p) => p === 'config.json' || /^(ahk|powershell|img)\//.test(p))).toBe(true)
    expect(files.some((p) => p.includes('\\'))).toBe(false)
    expect(files).toEqual([...files].sort())
  })
})

const roots = []
const aText = 'MsgBox "a"\r\n'

/** A small tree holding files the starter takes and files it must skip. */
function madeUpTree() {
  const root = mkdtempSync(join(tmpdir(), 'omb-starter-'))
  roots.push(root)
  const put = (rel, content = rel) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  put('config.json', '{}')
  put('ahk/a.ahk', aText)
  put('ahk/tests/t.ahk')
  put('ahk/x/local/p.ahk')
  put('img/a.png', Buffer.from([0, 255, 128, 10, 13]))
  put('img/a.xcf')
  put('powershell/b.ps1')
  put('powershell/b.ps1.bak')
  put('powershell/c.omb-tmp')
  put('qmk/q.json')
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('listStarterFiles on a made-up tree', () => {
  it('skips tests/, local/, *.xcf, *.bak and *.omb-tmp at any depth', () => {
    expect(listStarterFiles(madeUpTree())).toEqual(['ahk/a.ahk', 'config.json', 'img/a.png', 'powershell/b.ps1'])
  })
})

describe('starterPlugin', () => {
  it('serves virtual:omb-starter as the files in base64', async () => {
    const plugin = starterPlugin(madeUpTree())
    const id = plugin.resolveId('virtual:omb-starter')
    const files = (await import(`data:text/javascript,${encodeURIComponent(plugin.load(id))}`)).default
    expect(files.map((f) => f.path)).toEqual(['ahk/a.ahk', 'config.json', 'img/a.png', 'powershell/b.ps1'])
    expect(Buffer.from(files[0].base64, 'base64').toString()).toBe(aText)
    expect([...Buffer.from(files[2].base64, 'base64')]).toEqual([0, 255, 128, 10, 13])
  })

  it('leaves other ids alone', () => {
    expect(starterPlugin(madeUpTree()).resolveId('react')).toBeUndefined()
    expect(starterPlugin(madeUpTree()).load('react')).toBeUndefined()
  })
})
