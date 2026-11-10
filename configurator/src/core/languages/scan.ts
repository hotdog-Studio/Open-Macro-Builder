import { functionNames } from '../../../../scripts/validate-config-core.mjs'
import type { FolderAccess } from '../folder/types'
import { readTextFile, type TextFile } from '../folder/textFile'
import { ahk } from './ahk'
import { ps } from './ps'
import { isCommand, type FunctionInfo, type LangId, type Language } from './types'

const ALL: Language[] = [ahk, ps]
const BY_ID: Record<LangId, Language> = { ahk, ps }

export interface CommandFile {
  lang: LangId
  group: 'yours' | 'shared'
  /** Path inside the command folder without the extension; pairs the AHK and PS files. */
  pair: string
  file: TextFile
  functions: FunctionInfo[]
}

export interface CatalogEntry {
  name: string
  pair: string
  group: 'yours' | 'shared'
  description: string
  in: Partial<Record<LangId, { path: string; line: number }>>
}

async function listFiles(folder: FolderAccess, dir: string, ext: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await folder.list(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir') out.push(...(await listFiles(folder, path, ext)))
    else if (entry.name.toLowerCase().endsWith(ext)) out.push(path)
  }
  return out
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Reads every command file of the opened folder: the owner's personal files first
 * ('yours', skipping include hubs), then the shared library. Throws EncodingError
 * for a command file that is not UTF-8.
 */
export async function scanCommands(folder: FolderAccess): Promise<CommandFile[]> {
  const found: CommandFile[] = []
  for (const lang of ALL) {
    for (const [group, dir] of [
      ['yours', lang.personalDir],
      ['shared', lang.sharedDir],
    ] as const) {
      const ignored = new Set(lang.ignore.map((p) => p.toLowerCase()))
      for (const path of await listFiles(folder, dir, lang.ext)) {
        if (ignored.has(path.toLowerCase())) continue
        const file = await readTextFile(folder, path)
        if (!file) continue
        found.push({
          lang: lang.id,
          group,
          pair: path.slice(dir.length + 1, path.length - lang.ext.length),
          file,
          functions: lang.findFunctions(file.text),
        })
      }
    }
  }
  const order = (f: CommandFile) => (f.group === 'yours' ? 0 : 1)
  return found.sort(
    (a, b) =>
      order(a) - order(b) ||
      compare(a.pair, b.pair) ||
      ALL.indexOf(BY_ID[a.lang]) - ALL.indexOf(BY_ID[b.lang]) ||
      compare(a.file.path, b.file.path),
  )
}

/**
 * One entry per command name (ignoring case) within a file pair, with where each
 * language defines it. Yours first, then by pair, then file order.
 */
export function commandCatalog(files: CommandFile[]): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>()
  for (const cf of files) {
    for (const fn of cf.functions) {
      if (!isCommand(fn)) continue
      const key = `${cf.group}\0${cf.pair}\0${fn.name.toLowerCase()}`
      let entry = entries.get(key)
      if (!entry) {
        entry = { name: fn.name, pair: cf.pair, group: cf.group, description: '', in: {} }
        entries.set(key, entry)
      }
      if (!entry.in[cf.lang]) entry.in[cf.lang] = { path: cf.file.path, line: fn.line }
      if (entry.description === '') entry.description = fn.description
    }
  }
  return [...entries.values()]
}

/** Lower-cased names of every function in the files of one language, counted like the validator. */
export function definedNames(files: CommandFile[], lang: LangId): Set<string> {
  const names = new Set<string>()
  for (const cf of files) {
    if (cf.lang !== lang) continue
    for (const name of functionNames(cf.file.text, BY_ID[lang].ext)) names.add(name)
  }
  return names
}
