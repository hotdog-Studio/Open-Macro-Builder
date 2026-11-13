import { compareText } from './folder/path'
import type { FolderAccess } from './folder/types'

export type RepoInfo = { ok: true; configPath: 'local/config.json' | 'config.json' } | { ok: false; reason: string }

const EXAMPLE_CONFIG = 'config.json'
const PERSONAL_CONFIG = 'local/config.json'

/** Is this folder an Open Macro Builder repository, and which config file does it edit. */
export async function inspectFolder(folder: FolderAccess): Promise<RepoInfo> {
  const root = await folder.list('')
  const has = (name: string, kind: 'file' | 'dir') => root.some((e) => e.name === name && e.kind === kind)
  if (!has('config.json', 'file') || !(has('ahk', 'dir') || has('powershell', 'dir'))) {
    return {
      ok: false,
      reason:
        "This folder doesn't look like Open Macro Builder: it needs config.json and an ahk or powershell folder.",
    }
  }
  const personal = await folder.readBytes(PERSONAL_CONFIG)
  return { ok: true, configPath: personal ? PERSONAL_CONFIG : EXAMPLE_CONFIG }
}

/** Copies config.json to local/config.json, byte for byte. Throws when the copy already exists. */
export async function copyExampleConfig(folder: FolderAccess): Promise<void> {
  if ((await folder.readBytes(PERSONAL_CONFIG)) !== null) {
    throw new Error(`${PERSONAL_CONFIG} already exists, so it was not replaced.`)
  }
  const example = await folder.readBytes(EXAMPLE_CONFIG)
  if (example === null) throw new Error(`${EXAMPLE_CONFIG} is missing.`)
  await folder.writeBytes(PERSONAL_CONFIG, example)
}

/** The icon sets a layer can use: img/<name> folders with a layer.png, sorted, without the template. */
export async function listIconSets(folder: FolderAccess): Promise<string[]> {
  const dirs = (await folder.list('img')).filter((e) => e.kind === 'dir' && e.name !== 'template')
  const hasLayer = await Promise.all(
    dirs.map(async (d) => (await folder.list(`img/${d.name}`)).some((e) => e.kind === 'file' && e.name === 'layer.png')),
  )
  return dirs
    .filter((_, i) => hasLayer[i])
    .map((d) => d.name)
    .sort(compareText)
}
