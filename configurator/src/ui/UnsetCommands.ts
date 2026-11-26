import { LANGUAGES, type LangId } from '../core/languages'
import type { NamedCommand } from '../core/update/lostCommands'

/**
 * The language a command is missing from, when the person runs more than one and only one of them misses it:
 * ` in the PowerShell version`. Empty otherwise.
 */
function languageNote(command: NamedCommand, languages: readonly LangId[]): string {
  if (languages.length < 2 || command.langs.length !== 1) return ''
  return ` in the ${LANGUAGES[command.langs[0]].label} version`
}

/** A command, where it is missing when that is one language of several, and where the layout runs it. */
export function commandLine(command: NamedCommand, languages: readonly LangId[]): string {
  const places = command.places.map((place) => place.name).join(', ')
  return `${command.name}${languageNote(command, languages)} (${places})`
}

/** What to take out of the layout, by where it runs the commands: keys in the Macros tab, hotkeys and hotstrings in the file. */
export function remedy(commands: readonly NamedCommand[]): string {
  const kinds = new Set(commands.flatMap((command) => command.places.map((place) => place.kind)))
  const parts: string[] = []
  if (kinds.has('key')) parts.push('clear those keys in the Macros tab')
  if (kinds.has('hotkey') || kinds.has('hotstring')) parts.push('take those hotkeys and hotstrings out of the layout file')
  return parts.join(' and ')
}
