import { LANGUAGES, type LangId } from '../core/languages'
import type { Platform } from '../platform/types'

/**
 * Finding and reloading the running macropad (Electron only), shared by config.json's after-save
 * dialog and a command file's status line, so both find, reload and report the same way.
 */
export interface MacropadActions {
  /** The running macropad's language; null when none runs, the platform cannot tell, or the lookup failed. */
  find(): Promise<LangId | null>
  /**
   * Restarts the running macropad and resolves to the note saying what happened. null, with nothing
   * done, when the platform cannot reload or a reload is already running.
   */
  reload(): Promise<string | null>
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createMacropadActions(platform: Platform): MacropadActions {
  let reloading = false
  return {
    async find() {
      if (!platform.findMacropad) return null
      try {
        return await platform.findMacropad()
      } catch {
        return null // Not finding it only means no Reload button; the save itself succeeded.
      }
    },

    async reload() {
      if (reloading || !platform.reloadMacropad) return null
      reloading = true
      try {
        const lang = await platform.reloadMacropad()
        return lang ? `Reloaded the ${LANGUAGES[lang].label} macropad.` : 'No running macropad was found to reload.'
      } catch (e) {
        return `The macropad was not reloaded: ${messageOf(e)}`
      } finally {
        reloading = false
      }
    },
  }
}
