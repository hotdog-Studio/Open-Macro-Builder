import type { FolderAccess } from './folder/types'
import { LANG_IDS } from './languages'
import type { LangId } from './languages'

export interface Settings {
  languages: LangId[]
}

export const SETTINGS_PATH = 'local/configurator.json'

/** The saved settings; null when the file is missing, is not valid JSON, or names no known language. */
export async function loadSettings(folder: FolderAccess): Promise<Settings | null> {
  const bytes = await folder.readBytes(SETTINGS_PATH)
  if (bytes === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  const listed = (raw as { languages?: unknown } | null)?.languages
  if (!Array.isArray(listed)) return null
  const languages = [...new Set(listed)].filter((l): l is LangId => LANG_IDS.includes(l as LangId))
  return languages.length > 0 ? { languages } : null
}

export async function saveSettings(folder: FolderAccess, s: Settings): Promise<void> {
  await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode(JSON.stringify(s, null, 2) + '\n'))
}
