// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { fingerprint } from '../src/core/update/fingerprint'
import { listStarterFiles, starterIndex, starterPlugin, starterVersion } from './starter.mjs'

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

describe('starterIndex', () => {
  it('has exactly the starter paths, each with its fingerprint', () => {
    const index = starterIndex(madeUpTree(), '1.0.6')
    expect(index.version).toBe('1.0.6')
    expect(Object.keys(index.files)).toEqual(['ahk/a.ahk', 'config.json', 'img/a.png', 'powershell/b.ps1'])
    for (const hash of Object.values(index.files)) expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives a CRLF text file the fingerprint the page gives the same file with LF', async () => {
    // The build hashes with node:crypto, the page with hashBytes (Web Crypto): they have to agree.
    const index = starterIndex(madeUpTree(), '1.0.6')
    expect(index.files['ahk/a.ahk']).toBe(await fingerprint('ahk/a.ahk', new TextEncoder().encode('MsgBox "a"\n')))
  })

  it('gives a picture the fingerprint of its bytes', async () => {
    const index = starterIndex(madeUpTree(), '1.0.6')
    expect(index.files['img/a.png']).toBe(await fingerprint('img/a.png', Uint8Array.of(0, 255, 128, 10, 13)))
  })

  it('leaves the include lines of the real ahk/config.ahk out of its fingerprint', async () => {
    const lines = readFileSync(join(repoRoot, 'ahk/config.ahk'), 'utf8').split(/\r?\n/)
    const kept = lines.filter((line) => !/^\s*#Include\s+commands\\/i.test(line)).join('\n')
    expect(lines.length).toBeGreaterThan(kept.split('\n').length)
    expect(starterIndex(repoRoot, '1.0.6').files['ahk/config.ahk']).toBe(await fingerprint('ahk/config.ahk', new TextEncoder().encode(kept)))
  })
})

describe('starterVersion', () => {
  it.each([
    ['the version the build is given', { APP_VERSION: '1.0.6' }, '1.0.0', '1.0.6'],
    ['a development build, with no version', {}, '1.0.0', '1.0.0-dev'],
    ['an empty version, which the Dockerfile gives when the build argument is unset', { APP_VERSION: '' }, '1.0.0', '1.0.0-dev'],
    ['a version of only spaces', { APP_VERSION: '  ' }, '1.0.0', '1.0.0-dev'],
    ['the first two numbers of the package version', {}, '2.7.31', '2.7.0-dev'],
    ['a package version that is not three numbers', {}, 'nonsense', '0.0.0-dev'],
  ])('is %s', (_name, env, packageVersion, expected) => {
    expect(starterVersion(env, packageVersion)).toBe(expected)
  })
})

describe('starterPlugin and the index', () => {
  const served = async (plugin, id) =>
    (await import(`data:text/javascript,${encodeURIComponent(plugin.load(plugin.resolveId(id)))}`)).default

  it('serves virtual:omb-starter-index as the version and the fingerprints, without the files', async () => {
    const root = madeUpTree()
    const plugin = starterPlugin(root, { env: { APP_VERSION: '1.0.6' }, packageVersion: '1.0.0' })
    const index = await served(plugin, 'virtual:omb-starter-index')
    expect(index).toEqual(starterIndex(root, '1.0.6'))
    expect(JSON.stringify(index)).not.toContain('base64')
  })

  it('reads the package version from configurator/package.json when it is not given', async () => {
    const root = madeUpTree()
    mkdirSync(join(root, 'configurator'))
    writeFileSync(join(root, 'configurator/package.json'), '{"version":"3.4.5"}')
    const index = await served(starterPlugin(root, { env: {} }), 'virtual:omb-starter-index')
    expect(index.version).toBe('3.4.0-dev')
  })
})
