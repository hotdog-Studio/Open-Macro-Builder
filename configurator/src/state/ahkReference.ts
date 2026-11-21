import type { Reference } from '../core/commands/reference'

/**
 * The bundled reference of AutoHotkey's own functions. Imported on demand, as the starter is, so it is a
 * chunk of its own that the page fetches when the Commands tab first shows, not with the page itself.
 */
export async function loadAhkReference(): Promise<Reference> {
  const { AHK_REFERENCE } = await import('../core/commands/ahkReference')
  return AHK_REFERENCE
}
