// The outside addresses the page may ask the desktop app to open. The desktop window refuses every
// other address, so this list is the whole of what a link in the page can reach.
export const LINKS = {
  autohotkey: 'https://www.autohotkey.com/download/',
  contributing: 'https://github.com/hotdog-Studio/Open-Macro-Builder/blob/develop/CONTRIBUTING.md',
} as const

const ALLOWED: readonly string[] = Object.values(LINKS)

/** True only for a string that is exactly one of the addresses in LINKS: no parsing, no prefix match. */
export function isAllowedLink(url: string): boolean {
  return ALLOWED.includes(url)
}
