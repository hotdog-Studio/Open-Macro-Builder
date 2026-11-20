import { ahk, includeTarget } from '../languages/ahk'

/** The file that lists the shared AutoHotkey command files, one `#Include` line each. */
export const INCLUDE_FILE = 'ahk/config.ahk'

const COMMANDS_DIR = 'ahk/commands/'

/** `path` with the folder it starts in in lower case, so the language finds it whatever case the folder has; null for a path the file does not list. */
function listable(path: string): string | null {
  if (!path.toLowerCase().startsWith(COMMANDS_DIR)) return null
  return COMMANDS_DIR + path.slice(COMMANDS_DIR.length)
}

/** The paths the file lists, normalised, without repeats and in order. */
function listablePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    const normal = listable(path)
    if (normal === null || seen.has(normal.toLowerCase())) continue
    seen.add(normal.toLowerCase())
    out.push(normal)
  }
  return out
}

/** The AutoHotkey command files `text` includes, as folder paths ('ahk/commands/...'), lower-cased. */
export function listedCommandFiles(text: string): string[] {
  const files = new Set<string>()
  // Each line keeps its own line end: the language reads a line as it finds it.
  for (const line of text.split(/(?<=\n)/)) {
    const target = includeTarget(line, 'ahk')
    if (target?.startsWith(COMMANDS_DIR)) files.add(target)
  }
  return [...files]
}

/** `text` with a line added for each of `added` and removed for each of `removed`; nothing else changes. */
export function adjustList(text: string, added: string[], removed: string[]): string {
  let out = text
  for (const path of listablePaths(removed)) out = ahk.removeListing(out, path)
  // Sorted, so the same files give the same text whatever order they come in.
  const sorted = listablePaths(added).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  for (const path of sorted) out = ahk.addListing(out, path)
  return out
}

/** `appText` with the lines of `deleted` taken out and a line for each of `own` put in. */
export function listFor(appText: string, deleted: string[], own: string[]): string {
  return adjustList(appText, own, deleted)
}

/** Whether `text` lists exactly `present` (AutoHotkey command files in the folder), ignoring case and order. */
export function listsExactly(text: string, present: string[]): boolean {
  const listed = new Set(listedCommandFiles(text))
  const wanted = new Set(present.map((path) => path.toLowerCase()))
  return listed.size === wanted.size && [...wanted].every((path) => listed.has(path))
}
