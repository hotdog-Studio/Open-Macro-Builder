import { readReference, type Reference } from './reference'
import autohotkey from './reference/autohotkey.ahk?raw'

/**
 * AutoHotkey's own functions, as `reference/autohotkey.ahk` describes them. The page imports this module
 * only on demand (`loadAhkReference` in `state/ahkReference.ts`), so the file and its parse are a chunk of
 * their own, fetched when the Commands tab first shows; a test keeps every static import away from it.
 */
export const AHK_REFERENCE: Reference = { lang: 'ahk', entries: readReference(autohotkey) }
