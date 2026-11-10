import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PathError } from '../src/core/folder/path'
import { NodeFolder } from './nodeFolder'
import { watchFiles } from './watch'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let root: string
let stop: (() => void) | null

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omb-watch-'))
  stop = null
})

afterEach(async () => {
  stop?.()
  await rm(root, { recursive: true, force: true })
})

describe('watchFiles', () => {
  it('reports a changed file once after the debounce', async () => {
    await writeFile(join(root, 'config.json'), '{}')
    const changed: string[] = []
    stop = watchFiles(root, ['config.json'], (rel) => changed.push(rel))
    await delay(100)
    await writeFile(join(root, 'config.json'), '{"a":1}')
    await delay(20)
    await writeFile(join(root, 'config.json'), '{"a":2}')
    await delay(700)
    expect(changed).toEqual(['config.json'])
  })

  it('reports a nested file replaced by an atomic save, and ignores other files', async () => {
    await mkdir(join(root, 'local'))
    await writeFile(join(root, 'local', 'config.json'), '{}')
    const changed: string[] = []
    stop = watchFiles(root, ['local/config.json'], (rel) => changed.push(rel), 50)
    await delay(100)
    await writeFile(join(root, 'local', 'other.json'), '{}')
    await delay(300)
    expect(changed).toEqual([])
    await new NodeFolder(root).writeBytes('local/config.json', new TextEncoder().encode('{"b":1}'))
    await delay(400)
    expect(changed).toEqual(['local/config.json'])
  })

  it('stops reporting once stopped', async () => {
    await writeFile(join(root, 'config.json'), '{}')
    const changed: string[] = []
    const stopNow = watchFiles(root, ['config.json'], (rel) => changed.push(rel), 50)
    await delay(100)
    stopNow()
    await writeFile(join(root, 'config.json'), '{"a":1}')
    await delay(300)
    expect(changed).toEqual([])
  })

  it('skips files whose folder is missing and refuses paths outside the folder', () => {
    stop = watchFiles(root, ['nowhere/config.json'], () => {})
    expect(() => watchFiles(root, ['../config.json'], () => {})).toThrow(PathError)
  })
})
