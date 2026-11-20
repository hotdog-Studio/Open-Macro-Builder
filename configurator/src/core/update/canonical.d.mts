/** A line of ahk/config.ahk that includes a shared command file (`#Include commands\...`, any case). */
export const SHARED_INCLUDE: RegExp

/**
 * The bytes a file is fingerprinted by: CRLF read as LF in every file but a picture (.png, .ico), and
 * for ahk/config.ahk without the lines that include a shared command file. Paths compare ignoring case.
 * For a picture the result is the very array given, not a copy; for any other path it is a new one.
 * Do not change the result in place.
 */
export function canonicalBytes(path: string, data: Uint8Array): Uint8Array
