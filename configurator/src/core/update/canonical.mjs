// The bytes a file is fingerprinted by (see fingerprint.ts), in plain JavaScript because two sides
// need the very same function: the page (core) and the build script that makes the starter's index
// (scripts/starter.mjs, in Node). Written like scripts/validate-config-core.mjs, with a .d.mts beside
// it. It uses no Node module and no import, so core may import it and the build may run it.

/**
 * A line of ahk/config.ahk that includes a shared command file. This is the rule ahk.ts has as
 * SHARED_INCLUDE, copied because this file sits below the language files and cannot import them;
 * fingerprint.test.ts fails if the two disagree.
 */
export const SHARED_INCLUDE = /^\s*#Include\s+commands\\/i

const PICTURE = /\.(png|ico)$/i
const CONFIG_AHK = 'ahk/config.ahk'

/** The bytes without the CR of each CRLF. */
function withLfEnds(data) {
  const out = new Uint8Array(data.length)
  let length = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 13 && data[i + 1] === 10) continue
    out[length++] = data[i]
  }
  return out.subarray(0, length)
}

/** The bytes, line by line, without the lines that include a shared command file. */
function withoutSharedIncludes(data) {
  const decoder = new TextDecoder()
  const kept = []
  let length = 0
  let start = 0
  while (start < data.length) {
    const lf = data.indexOf(10, start)
    const next = lf === -1 ? data.length : lf + 1
    const line = data.subarray(start, next)
    if (!SHARED_INCLUDE.test(decoder.decode(line))) {
      kept.push(line)
      length += line.length
    }
    start = next
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const line of kept) {
    out.set(line, at)
    at += line.length
  }
  return out
}

/**
 * What a file is fingerprinted by: its bytes, except that a text file's CRLF line ends count as LF,
 * and ahk/config.ahk leaves out the lines that include a shared command file (the app adds those
 * itself when someone makes a command, so they say nothing about the app's own copy).
 * Pictures are compared as they are. Paths are compared ignoring case.
 */
export function canonicalBytes(path, data) {
  if (PICTURE.test(path)) return data
  const text = withLfEnds(data)
  return path.toLowerCase() === CONFIG_AHK ? withoutSharedIncludes(text) : text
}
