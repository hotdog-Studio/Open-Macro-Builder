const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_LENGTH = 100

function hasForbiddenCharacter(name: string): boolean {
  for (const ch of name) {
    if (String.raw`\/:*?"<>|`.includes(ch) || (ch.codePointAt(0) ?? 0) < 0x20) return true
  }
  return false
}

/** Why a new folder cannot have this name on Windows (and so anywhere), or null when it can. */
export function folderNameError(name: string): string | null {
  if (name.trim() === '') return 'Give the folder a name.'
  if (hasForbiddenCharacter(name)) return String.raw`A folder name cannot contain \ / : * ? " < > |`
  if (name.startsWith(' ') || name.endsWith(' ') || name.endsWith('.')) {
    return 'A folder name cannot start with a space or end with a dot or a space.'
  }
  if (RESERVED.test(name.split('.')[0])) return `"${name}" is a name Windows reserves.`
  if (name.length > MAX_LENGTH) return 'That name is too long.'
  return null
}
