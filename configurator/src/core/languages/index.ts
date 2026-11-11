import { ahk } from './ahk'
import { ps } from './ps'
import type { LangId, Language } from './types'

export type { FunctionInfo, LangId, Language } from './types'
export { isCommand } from './types'
export {
  commandCatalog,
  commandFileAt,
  commandFileNotices,
  commandFilePath,
  definedNames,
  mergeRescan,
  readCommandFile,
  scanCommands,
  sortCommandFiles,
  withCommandFile,
} from './scan'
export type { CatalogEntry, CommandFile } from './scan'

export const LANGUAGES: Record<LangId, Language> = { ahk, ps }
export const LANG_IDS: LangId[] = ['ahk', 'ps']
