import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo, readRepoText } from '../../../test/repo'
import { definedNames, scanCommands } from '../languages'
import type { LangId } from '../languages'
import { listIconSets } from '../repo'
import type { Workspace } from './model'
import { renameKey, updateLayer } from './ops'
import { parseConfig } from './parse'
import { checkWorkspace } from './validate'

const example = () => parseConfig(readRepoText('config.json'), 'config.json')

async function repoContext(languages: LangId[]) {
  const folder = memoryFolderFromRepo(['img', 'ahk/commands', 'powershell/commands'])
  const files = await scanCommands(folder)
  return {
    iconSets: new Set(await listIconSets(folder)),
    defined: { ahk: definedNames(files, 'ahk'), ps: definedNames(files, 'ps') },
    languages,
  }
}

const ctx = (languages: LangId[], ahk: string[], ps: string[]) => ({
  iconSets: new Set(['media', 'chrome']),
  defined: { ahk: new Set(ahk), ps: new Set(ps) },
  languages,
})

/** A small pad whose only macro runs `action`. */
function withAction(action: string): Workspace {
  const config = {
    fn: { key: 'ScrollLock' },
    keys: [{ key: 'F13' }, { key: 'F14' }],
    layers: [{ title: 'Media', icon: 'media', macros: [{ action, name: 'X' }] }],
  }
  return parseConfig(JSON.stringify(config), 'config.json')
}

describe('checkWorkspace', () => {
  it('passes the example config', async () => {
    expect(checkWorkspace(example(), await repoContext(['ahk', 'ps']))).toEqual({ errors: [], warnings: [] })
    expect(checkWorkspace(example(), await repoContext(['ahk']))).toEqual({ errors: [], warnings: [] })
  })

  it('makes an action missing from a language I run an error, and does not repeat it', () => {
    const r = checkWorkspace(withAction('OnlyPs'), ctx(['ahk'], [], ['onlyps']))
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('ahk/commands')
    expect(r.warnings).toEqual([])
  })

  it('makes an action missing from a language I do not run a warning', () => {
    const r = checkWorkspace(withAction('OnlyAhk'), ctx(['ahk'], ['onlyahk'], []))
    expect(r.errors).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('powershell/commands')
  })

  it('does not warn about structure twice', () => {
    const ws = withAction('Anything')
    const r = checkWorkspace({ ...ws, fn: { ...ws.fn, key: '' } }, ctx(['ahk'], ['anything'], ['anything']))
    expect(r.errors.filter((e) => e.includes('needs a "key" name'))).toHaveLength(1)
    expect(r.warnings).toEqual([])
  })

  it('blocks a key name used twice, ignoring case, naming the later spelling', async () => {
    const r = checkWorkspace(renameKey(example(), 'k2', 'f13'), await repoContext(['ahk', 'ps']))
    expect(r.errors).toEqual(['Key name "f13" is used twice.'])
  })

  it('blocks a key sharing the Fn key name', async () => {
    const r = checkWorkspace(renameKey(example(), 'k3', 'scrolllock'), await repoContext(['ahk', 'ps']))
    expect(r.errors).toEqual(['Key name "scrolllock" is used twice.'])
  })

  it('reports a layer icon that is not in img/', async () => {
    const ws = example()
    const layerId = ws.slots[ws.keys[0].id].id
    const r = checkWorkspace(updateLayer(ws, layerId, { icon: 'nope' }), await repoContext(['ahk', 'ps']))
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('nope')
    expect(r.warnings).toEqual([])
  })
})
