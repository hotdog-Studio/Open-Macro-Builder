import { commandFilePath, LANGUAGES, type CommandFile, type LangId } from '../languages'

const NAME = /^[A-Za-z0-9_-]+$/

/** Where a new command file goes: yours under local/, shared next to the shared command sets. */
export function newFilePath(lang: LangId, group: 'yours' | 'shared', name: string): string {
  return commandFilePath(lang, group, group === 'shared' ? `custom/${name}` : name)
}

/**
 * Why a new file of that name cannot be made, or null when it can. A name is refused as taken only
 * when every chosen language has its file: with some of them missing, New file makes just those (a
 * first try that failed for one language can be tried again).
 */
export function checkNewFile(
  files: CommandFile[],
  name: string,
  group: 'yours' | 'shared',
  langs: LangId[],
): string | null {
  if (name.trim() === '') return 'Enter a name.'
  if (!NAME.test(name)) return 'Use letters, digits, _ and - only.'
  if (langs.length === 0) return 'Choose at least one language.'
  const paths = langs.map((lang) => newFilePath(lang, group, name))
  // An include hub sits among the command files but is not one: its name is taken whatever else is chosen.
  const hub = paths.find((path, i) => LANGUAGES[langs[i]].ignore.includes(path.toLowerCase()))
  if (hub !== undefined) return `${hub} already exists.`
  const held = new Set(files.map((f) => f.file.path.toLowerCase()))
  return paths.every((path) => held.has(path.toLowerCase())) ? `${paths[0]} already exists.` : null
}
