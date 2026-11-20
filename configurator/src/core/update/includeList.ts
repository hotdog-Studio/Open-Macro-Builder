import { ahk, includeTarget, linesOf } from '../languages/ahk'

/** The file that lists the shared AutoHotkey command files, one `#Include` line each. */
export const INCLUDE_FILE = 'ahk/config.ahk'

const COMMANDS_DIR = 'ahk/commands/'

/**
 * `path` with the folder it starts in in lower case, so the language finds it whatever case the folder has;
 * null for a path the file does not list: one outside ahk/commands or without the .ahk extension (any case).
 */
function listable(path: string): string | null {
  const lower = path.toLowerCase()
  if (!lower.startsWith(COMMANDS_DIR) || !lower.endsWith('.ahk')) return null
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

/** Orders paths by the code units of their lower-case form. */
function byLowerCase(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x === y) return 0
  return x < y ? -1 : 1
}

/** The AutoHotkey command files `text` includes, as folder paths ('ahk/commands/...'), lower-cased. */
export function listedCommandFiles(text: string): string[] {
  const files = new Set<string>()
  for (const line of linesOf(text)) {
    const target = includeTarget(line, 'ahk')
    // A command file is an .ahk file: an include of a folder or of any other file is none.
    if (target?.startsWith(COMMANDS_DIR) && target.endsWith('.ahk')) files.add(target)
  }
  return [...files]
}

/**
 * `text` with a line added for each of `added` and removed for each of `removed`; nothing else changes.
 * A path that is not an .ahk file under ahk/commands is ignored on both sides.
 */
export function adjustList(text: string, added: string[], removed: string[]): string {
  let out = text
  for (const path of listablePaths(removed)) out = ahk.removeListing(out, path)
  // Sorted by code unit on the lower-case path, so the same files give the same text whatever order they
  // come in and whatever the machine's locale.
  const sorted = listablePaths(added).sort(byLowerCase)
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
