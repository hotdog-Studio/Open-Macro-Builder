import { functionNames } from '../../../../scripts/validate-config-core.mjs'
import { LANGUAGES, type CommandFile, type LangId } from '../languages'

/** What a command name looks like, in both languages. */
export const COMMAND_NAME = /^[A-Za-z_]\w*$/

/**
 * `text` with `block` added at the end, after a blank line. A text that does not end in a
 * newline keeps having none.
 */
export function appendBlock(text: string, block: string): string {
  if (text === '') return `${block}\n`
  return text.endsWith('\n') ? `${text}\n${block}\n` : `${text}\n\n${block}`
}

/**
 * Why `name` cannot be a new command of `lang`, or null when it can: the name must be a valid
 * identifier and no file of the language may define it, ignoring case. A file counts with its
 * draft when it has one. Names are counted as the validator counts them.
 */
export function checkCommandName(
  files: CommandFile[],
  drafts: Record<string, string>,
  lang: LangId,
  name: string,
): string | null {
  if (!COMMAND_NAME.test(name)) return 'A command name starts with a letter or _ and uses only letters, digits and _.'
  const language = LANGUAGES[lang]
  const lower = name.toLowerCase()
  const owner = files.find(
    (f) => f.lang === lang && functionNames(drafts[f.file.path] ?? f.file.text, language.ext).includes(lower),
  )
  return owner ? `${name} is already defined in ${language.label} (${owner.file.path}).` : null
}
