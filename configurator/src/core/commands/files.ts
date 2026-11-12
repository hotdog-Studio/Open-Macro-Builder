import { commandFilePath, LANGUAGES, type CommandFile, type LangId } from '../languages'

const NAME = /^[A-Za-z0-9_-]+$/

/** Where a new command file goes: yours under local/, shared next to the shared command sets. */
export function newFilePath(lang: LangId, group: 'yours' | 'shared', name: string): string {
  return commandFilePath(lang, group, group === 'shared' ? `custom/${name}` : name)
}

/** Why a new file of that name cannot be made, or null when it can. */
export function checkNewFile(
  files: CommandFile[],
  name: string,
  group: 'yours' | 'shared',
  langs: LangId[],
): string | null {
  if (name.trim() === '') return 'Enter a name.'
  if (!NAME.test(name)) return 'Use letters, digits, _ and - only.'
  if (langs.length === 0) return 'Choose at least one language.'
  const held = new Set(files.map((f) => f.file.path.toLowerCase()))
  for (const lang of langs) {
    const path = newFilePath(lang, group, name)
    // An include hub sits among the command files but is not one: its name is taken too.
    const lower = path.toLowerCase()
    if (held.has(lower) || LANGUAGES[lang].ignore.includes(lower)) return `${path} already exists.`
  }
  return null
}
