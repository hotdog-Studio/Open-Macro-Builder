import { ahk } from './ahk'
import { ps } from './ps'
import type { LangId, Language } from './types'

export type { FunctionDoc, FunctionInfo, LangId, Language, ParamDoc } from './types'
export { emptyDoc, isCommand } from './types'
export {
  commandCatalog,
  commandFileAt,
  commandFileNotices,
  commandFilesIn,
  commandFilePath,
  definedNames,
  libraryTitle,
  mergeRescan,
  readCommandFile,
  sameLibrary,
  scanCommands,
  scanLibrary,
  sortCommandFiles,
  withCommandFile,
} from './scan'
export type { CatalogEntry, CommandFile, LibraryFile } from './scan'

export const LANGUAGES: Record<LangId, Language> = { ahk, ps }
export const LANG_IDS: LangId[] = ['ahk', 'ps']
