import { functionNames } from '../../../../scripts/validate-config-core.mjs'
import { compareText as compare } from '../folder/path'
import type { FolderAccess } from '../folder/types'
import { hashBytes } from '../folder/hash'
import { decodeLenient, readTextFileLenient, type TextFile } from '../folder/textFile'
import { ahk } from './ahk'
import { ps } from './ps'
import { isCommand, type FunctionInfo, type LangId, type Language } from './types'

const ALL: Language[] = [ahk, ps]
const BY_ID: Record<LangId, Language> = { ahk, ps }

/**
 * How a file that is not UTF-8 is shown, only to look at: Windows PowerShell 5.1 reads a script
 * without a byte order mark in the ANSI code page, so a .ps1 saved as ANSI is shown as
 * Windows-1252; the bytes of any other file that are not UTF-8 show as U+FFFD.
 */
const NOT_UTF8: Record<LangId, string> = { ahk: 'utf-8', ps: 'windows-1252' }

export interface CommandFile {
  lang: LangId
  group: 'yours' | 'shared'
  /** Path inside the command folder without the extension; pairs the AHK and PS files. */
  pair: string
  file: TextFile
  functions: FunctionInfo[]
  /**
   * False for a file that is not UTF-8: its text was decoded leniently, so its commands
   * can be listed, but writing it back would damage it. An editor must leave it alone.
   */
  editable: boolean
}

export interface CatalogEntry {
  name: string
  pair: string
  group: 'yours' | 'shared'
  description: string
  in: Partial<Record<LangId, { path: string; line: number }>>
}

async function listFiles(folder: FolderAccess, dir: string, ext: string): Promise<string[]> {
  const entries = await folder.list(dir)
  // Each entry gives its files in place, so the list keeps the folder's order.
  const found = await Promise.all(
    entries.map((entry) => {
      const path = `${dir}/${entry.name}`
      if (entry.kind === 'dir') return listFiles(folder, path, ext)
      return Promise.resolve(entry.name.toLowerCase().endsWith(ext) ? [path] : [])
    }),
  )
  return found.flat()
}

/** Where a command file lives: its language, group and pair name. */
export function commandFileAt(path: string): { lang: LangId; group: 'yours' | 'shared'; pair: string } | null {
  const lower = path.toLowerCase()
  for (const lang of ALL) {
    if (!lower.endsWith(lang.ext) || lang.ignore.some((p) => p.toLowerCase() === lower)) continue
    for (const [group, dir] of [
      ['yours', lang.personalDir],
      ['shared', lang.sharedDir],
    ] as const) {
      const pair = path.slice(dir.length + 1, path.length - lang.ext.length)
      if (path.startsWith(`${dir}/`) && pair !== '') return { lang: lang.id, group, pair }
    }
  }
  return null
}

/** The path of the command file for a language, group and pair name. */
export function commandFilePath(lang: LangId, group: 'yours' | 'shared', pair: string): string {
  const l = BY_ID[lang]
  return `${group === 'yours' ? l.personalDir : l.sharedDir}/${pair}${l.ext}`
}

/**
 * Reads one command file the way scanCommands does. Null when the file is missing or the
 * path is not a command file (an include hub, another extension, outside the four folders).
 */
export async function readCommandFile(folder: FolderAccess, path: string): Promise<CommandFile | null> {
  const at = commandFileAt(path)
  if (!at) return null
  const read = await readTextFileLenient(folder, path, NOT_UTF8[at.lang])
  if (!read) return null
  return {
    lang: at.lang,
    group: at.group,
    pair: at.pair,
    file: read.file,
    functions: BY_ID[at.lang].findFunctions(read.file.text),
    editable: read.utf8,
  }
}

/** Yours before shared, then by pair, then AutoHotkey before PowerShell, then by path. */
export function sortCommandFiles(files: CommandFile[]): CommandFile[] {
  const order = (f: CommandFile) => (f.group === 'yours' ? 0 : 1)
  return [...files].sort(
    (a, b) =>
      order(a) - order(b) ||
      compare(a.pair, b.pair) ||
      ALL.indexOf(BY_ID[a.lang]) - ALL.indexOf(BY_ID[b.lang]) ||
      compare(a.file.path, b.file.path),
  )
}

/** A new list with the entry for `path` replaced, inserted in order, or removed when `next` is null. */
export function withCommandFile(files: CommandFile[], path: string, next: CommandFile | null): CommandFile[] {
  const rest = files.filter((f) => f.file.path !== path)
  return sortCommandFiles(next ? [...rest, next] : rest)
}

/**
 * Combines a fresh scan with the files the editor holds. Paths in `keep` (unsaved edits)
 * keep their held entry; every other path takes its fresh entry, so new files appear and
 * vanished ones go. `changed` lists the kept paths whose version on disk now differs from
 * the held one (null when the file is gone).
 */
export function mergeRescan(
  held: CommandFile[],
  fresh: CommandFile[],
  keep: ReadonlySet<string>,
): { files: CommandFile[]; changed: { path: string; version: string | null }[] } {
  const heldByPath = new Map(held.map((f) => [f.file.path, f]))
  const freshByPath = new Map(fresh.map((f) => [f.file.path, f]))
  const files: CommandFile[] = []
  const changed: { path: string; version: string | null }[] = []
  for (const f of fresh) files.push((keep.has(f.file.path) && heldByPath.get(f.file.path)) || f)
  for (const path of keep) {
    const mine = heldByPath.get(path)
    if (!mine) continue
    const version = freshByPath.get(path)?.file.version ?? null
    if (!freshByPath.has(path)) files.push(mine)
    if (version !== mine.file.version) changed.push({ path, version })
  }
  return { files: sortCommandFiles(files), changed }
}

/**
 * Reads every command file of the opened folder: the owner's personal files first
 * ('yours', skipping include hubs), then the shared library. A file that is not UTF-8
 * is still scanned (command names are ASCII), but marked not editable.
 */
export async function scanCommands(folder: FolderAccess): Promise<CommandFile[]> {
  const dirs = ALL.flatMap((lang) => [lang.personalDir, lang.sharedDir].map((dir) => ({ dir, ext: lang.ext })))
  const paths = (await Promise.all(dirs.map(({ dir, ext }) => listFiles(folder, dir, ext)))).flat()
  const files = await Promise.all(paths.map((path) => readCommandFile(folder, path)))
  return sortCommandFiles(files.filter((file) => file !== null))
}

/** A load notice for each command file that is not UTF-8. */
export function commandFileNotices(files: CommandFile[]): string[] {
  return files
    .filter((f) => !f.editable)
    .map((f) => `${f.file.path} is not UTF-8 text; its commands are listed, but the configurator will not edit it.`)
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
      entry.in[cf.lang] ??= { path: cf.file.path, line: fn.line }
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

/** One file of a language's library folder: functions that commands call. */
export interface LibraryFile {
  lang: LangId
  /** 'powershell/lib/Input.ps1' */
  path: string
  /** The file name without its extension: 'Input'. */
  name: string
  title: string
  /** The TextFile's. */
  version: string | null
  functions: FunctionInfo[]
}

/**
 * First lines that open a script or a region instead of describing the file. A `<#` line does not
 * start with the PowerShell mark, so it needs no check.
 */
const NOT_A_TITLE = /^#(?:requires|region|endregion)\b/i

/** The file's first line without its comment mark when that line is a comment; else `name`. */
export function libraryTitle(lang: LangId, text: string, name: string): string {
  const mark = BY_ID[lang].lineComment
  const first = text.split('\n', 1)[0].trim()
  if (!first.startsWith(mark) || NOT_A_TITLE.test(first)) return name
  let from = 0
  while (first[from] === mark) from++
  return first.slice(from).trim() || name
}

/** One library file; `held` itself when its bytes are the ones it was read from, so nothing is decoded or parsed again. */
async function readLibraryFile(
  folder: FolderAccess,
  lang: Language,
  path: string,
  held: LibraryFile | undefined,
): Promise<LibraryFile | null> {
  const raw = await folder.readBytes(path)
  if (raw === null) return null
  if (held?.version === (await hashBytes(raw))) return held
  const read = await decodeLenient(path, raw, NOT_UTF8[lang.id])
  const name = path.slice(path.lastIndexOf('/') + 1, path.length - lang.ext.length)
  return {
    lang: lang.id,
    path,
    name,
    title: libraryTitle(lang.id, read.file.text, name),
    version: read.file.version,
    functions: lang.findFunctions(read.file.text),
  }
}

/**
 * The files directly in each language's library folder, by name. Never throws for a missing folder.
 * A file of `held` (the library as last read) whose bytes did not change is given back as it is.
 */
export async function scanLibrary(folder: FolderAccess, held: LibraryFile[] = []): Promise<LibraryFile[]> {
  const heldByPath = new Map(held.map((f) => [f.path, f]))
  const found = await Promise.all(
    ALL.map(async (lang) => {
      if (lang.libraryDir === null) return []
      const dir = lang.libraryDir
      const entries = await folder.list(dir)
      const paths = entries
        .filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith(lang.ext))
        .map((e) => `${dir}/${e.name}`)
      return Promise.all(paths.map((path) => readLibraryFile(folder, lang, path, heldByPath.get(path))))
    }),
  )
  return found
    .flat()
    .filter((file) => file !== null)
    .sort((a, b) => compare(a.name, b.name))
}

/** True when both lists hold the same paths and versions in the same order. */
export function sameLibrary(a: LibraryFile[], b: LibraryFile[]): boolean {
  return a.length === b.length && a.every((f, i) => f.path === b[i].path && f.version === b[i].version)
}
