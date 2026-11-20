import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SHARED_INCLUDE as ahkSharedInclude } from '../languages/ahk'
import { SHARED_INCLUDE as canonicalSharedInclude } from './canonical.mjs'
import { canonicalBytes, fingerprint } from './fingerprint'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe('fingerprint', () => {
  it('gives a file the same fingerprint whatever its line ends', async () => {
    expect(await fingerprint('ahk/main.ahk', bytes('a\r\nb\r\n'))).toBe(await fingerprint('ahk/main.ahk', bytes('a\nb\n')))
  })

  it('compares a picture by its bytes', async () => {
    expect(await fingerprint('img/a.png', Uint8Array.of(13, 10))).not.toBe(await fingerprint('img/a.png', Uint8Array.of(10)))
    expect(await fingerprint('img/icon.ico', Uint8Array.of(13, 10))).not.toBe(await fingerprint('img/icon.ico', Uint8Array.of(10)))
  })

  it('treats the extension of a picture in any case as a picture', async () => {
    expect(await fingerprint('img/A.PNG', Uint8Array.of(13, 10))).not.toBe(await fingerprint('img/A.PNG', Uint8Array.of(10)))
  })

  it('leaves the shared include lines of ahk/config.ahk out, in any case and with either line end', async () => {
    const withList = '; head\r\n#Include commands\\helper.ahk\r\n#include Commands\\custom\\mine.ahk\r\n#Include lib\\json.ahk\r\n'
    expect(await fingerprint('ahk/config.ahk', bytes(withList))).toBe(await fingerprint('AHK/Config.ahk', bytes('; head\n#Include lib\\json.ahk\n')))
  })

  it('keeps such lines in any other file', async () => {
    expect(await fingerprint('ahk/main.ahk', bytes('#Include commands\\x.ahk\n'))).not.toBe(await fingerprint('ahk/main.ahk', bytes('')))
  })

  it('gives a fingerprint as 64 lower-case hex digits', async () => {
    expect(await fingerprint('config.json', bytes('{}'))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('canonicalBytes', () => {
  it('turns each CRLF into LF and leaves a lone CR and the other bytes as they are', () => {
    expect(text(canonicalBytes('ahk/main.ahk', bytes('a\r\nb\rc\r\n\r\nd')))).toBe('a\nb\rc\n\nd')
  })

  it('leaves out a last include line that has no line end, and keeps the line before it', () => {
    expect(text(canonicalBytes('ahk/config.ahk', bytes('x\r\n#Include commands\\a.ahk')))).toBe('x\n')
  })

  it('leaves the bytes of a kept line alone when they are not valid text', () => {
    expect([...canonicalBytes('ahk/config.ahk', Uint8Array.of(0xff, 0xfe, 10))]).toEqual([0xff, 0xfe, 10])
  })

  it('does not change the data it is given', () => {
    const data = bytes('a\r\n#Include commands\\a.ahk\r\n')
    canonicalBytes('ahk/config.ahk', data)
    expect(text(data)).toBe('a\r\n#Include commands\\a.ahk\r\n')
  })
})

describe('the shared include rule', () => {
  const real = readFileSync(new URL('../../../../ahk/config.ahk', import.meta.url), 'utf8')
  const lines = [
    ...real.split(/\r?\n/),
    String.raw`#Include commands\x.ahk`,
    String.raw`  #INCLUDE   COMMANDS\x.ahk`,
    String.raw`	#include commands\custom\x.ahk`,
    '#Include commands/x.ahk',
    String.raw`#Include commandsx\x.ahk`,
    String.raw`#IncludeAgain commands\x.ahk`,
    String.raw`#Include *i commands\x.ahk`,
    String.raw`; #Include commands\x.ahk`,
    String.raw`#Include lib\json.ahk`,
    '',
  ]

  it('is the same in the app and in the fingerprint', () => {
    expect(lines.length).toBeGreaterThan(20)
    for (const line of lines) expect([line, canonicalSharedInclude.test(line)]).toEqual([line, ahkSharedInclude.test(line)])
  })

  it('finds the include lines of the real ahk/config.ahk', () => {
    expect(lines.filter((l) => canonicalSharedInclude.test(l)).length).toBeGreaterThan(5)
  })
})
