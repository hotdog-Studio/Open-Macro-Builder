import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ahk } from '../languages/ahk'
import { fingerprint } from './fingerprint'
import { INCLUDE_FILE, adjustList, listFor, listedCommandFiles, listsExactly } from './includeList'

const real = readFileSync(new URL('../../../../ahk/config.ahk', import.meta.url), 'utf8')
const bytes = (s: string) => new TextEncoder().encode(s)
const crlf = (s: string) => s.replaceAll('\n', '\r\n')

const SSH = String.raw`#Include commands\custom\ssh.ahk`
const MINE = String.raw`#Include commands\custom\mine.ahk`
const CHROME = String.raw`#Include commands\custom\chrome.ahk`

const REAL_FILES = [
  'ahk/commands/helper.ahk',
  'ahk/commands/media.ahk',
  'ahk/commands/power.ahk',
  'ahk/commands/windows.ahk',
  'ahk/commands/custom/chrome.ahk',
  'ahk/commands/custom/ssh.ahk',
  'ahk/commands/custom/examples.ahk',
  'ahk/commands/custom/vscode.ahk',
  'ahk/commands/custom/vsstudio.ahk',
  'ahk/commands/custom/automation.ahk',
]

/** A small include file: a Libraries section, a core one and Custom Commands. */
const SMALL = [
  '; ****** Libraries ******',
  String.raw`#Include lib\json.ahk`,
  '',
  '; ****** Custom Commands ******',
  '; Generic command sets.',
  CHROME,
  SSH,
  String.raw`#Include *i ..\local\ahk\commands.ahk`,
  '',
  '; ****** Macro Definitions ******',
  'Main() {',
  '}',
].join('\n')

describe('INCLUDE_FILE', () => {
  it('is the file the language lists the shared command files in', () => {
    expect(ahk.listedIn('ahk/commands/x.ahk')).toBe(INCLUDE_FILE)
  })
})

describe('listedCommandFiles', () => {
  it('gives the command files the real ahk/config.ahk includes, as lower-case folder paths', () => {
    expect(listedCommandFiles(real)).toEqual(REAL_FILES)
  })

  it('leaves out the libraries, the personal hub and the lines of any other kind', () => {
    expect(listedCommandFiles(SMALL)).toEqual(['ahk/commands/custom/chrome.ahk', 'ahk/commands/custom/ssh.ahk'])
  })

  it('reads an include in any case, with either line end, with a comment after it, once however often it is listed', () => {
    const text = String.raw`#include Commands\Custom\Mine.AHK ; mine` + '\r\n' + CHROME + '\r\n' + CHROME
    expect(listedCommandFiles(text)).toEqual(['ahk/commands/custom/mine.ahk', 'ahk/commands/custom/chrome.ahk'])
  })

  it('gives nothing for a text with no include', () => {
    expect(listedCommandFiles('')).toEqual([])
  })
})

describe('listFor', () => {
  const edited = () => listFor(real, ['ahk/commands/custom/ssh.ahk'], ['ahk/commands/custom/mine.ahk'])

  it('takes out the line of a deleted file and puts one in for each of the person\'s own', () => {
    const text = edited()
    expect(text).not.toContain(String.raw`commands\custom\ssh.ahk`)
    expect(text).toContain(MINE)
  })

  it('puts the line into the Custom Commands section, after the last shared include there', () => {
    const lines = edited().split('\n')
    const mine = lines.indexOf(MINE)
    expect(lines.slice(0, mine).findLastIndex((l) => l.includes('Custom Commands'))).toBeGreaterThan(-1)
    expect(lines[mine - 1]).toBe(String.raw`#Include commands\custom\automation.ahk`)
    expect(lines[mine + 1]).toMatch(/^; Your own commands/)
  })

  it('leaves the fingerprint of the file as it was, since the list is no part of it', async () => {
    expect(await fingerprint(INCLUDE_FILE, bytes(edited()))).toBe(await fingerprint(INCLUDE_FILE, bytes(real)))
  })

  it('lists the files that are there after it', () => {
    expect(listedCommandFiles(edited())).toEqual([
      ...REAL_FILES.filter((p) => p !== 'ahk/commands/custom/ssh.ahk'),
      'ahk/commands/custom/mine.ahk',
    ])
  })

  it('takes out the line of a deleted core file too', () => {
    expect(listedCommandFiles(listFor(real, ['ahk/commands/media.ahk'], []))).toEqual(
      REAL_FILES.filter((p) => p !== 'ahk/commands/media.ahk'),
    )
  })

  it('gives the same text for the same files in another order', () => {
    const own = ['ahk/commands/custom/b.ahk', 'ahk/commands/custom/a.ahk', 'ahk/commands/custom/c.ahk']
    const deleted = ['ahk/commands/custom/vscode.ahk', 'ahk/commands/custom/ssh.ahk']
    const text = listFor(real, deleted, own)
    expect(listFor(real, [...deleted].reverse(), [...own].reverse())).toBe(text)
    expect(listFor(real, deleted, [own[1], own[2], own[0]])).toBe(text)
    expect(text.indexOf('custom\\a.ahk')).toBeLessThan(text.indexOf('custom\\b.ahk'))
    expect(text.indexOf('custom\\b.ahk')).toBeLessThan(text.indexOf('custom\\c.ahk'))
  })

  it('changes nothing when there is nothing to delete or add', () => {
    expect(listFor(real, [], [])).toBe(real)
  })

  it('does not list a file twice that is listed already', () => {
    expect(listFor(real, [], ['ahk/commands/custom/chrome.ahk'])).toBe(real)
  })

  it('reads a path in any case', () => {
    const text = listFor(SMALL, ['AHK/Commands/Custom/SSH.ahk'], ['AHK/Commands/custom/Mine.ahk'])
    expect(listedCommandFiles(text)).toEqual(['ahk/commands/custom/chrome.ahk', 'ahk/commands/custom/mine.ahk'])
  })

  it('leaves paths that are not command files alone', () => {
    expect(listFor(SMALL, ['local/ahk/mine.ahk', 'ahk/lib/json.ahk'], ['local/ahk/mine.ahk', 'ahk/main.ahk'])).toBe(SMALL)
  })

  it('throws what addListing throws when the file has no Custom Commands section', () => {
    const text = '#Requires AutoHotkey v2.0\n#Include lib\\json.ahk\n'
    let expected = ''
    try {
      ahk.addListing(text, 'ahk/commands/custom/mine.ahk')
    } catch (error) {
      expected = (error as Error).message
    }
    expect(expected).toContain('no Custom Commands section')
    expect(() => listFor(text, [], ['ahk/commands/custom/mine.ahk'])).toThrow(new Error(expected))
  })

  it('does not throw for a file with no such section when nothing is to be added', () => {
    const text = String.raw`#Include commands\helper.ahk` + '\n'
    expect(listFor(text, ['ahk/commands/helper.ahk'], [])).toBe('')
  })
})

describe('adjustList', () => {
  it('keeps every other line byte for byte, in a CRLF file', () => {
    const text = crlf(real)
    const expected = crlf(
      real.replace(SSH + '\n', '').replace('#Include commands\\custom\\automation.ahk\n', (all) => all + MINE + '\n'),
    )
    expect(adjustList(text, ['ahk/commands/custom/mine.ahk'], ['ahk/commands/custom/ssh.ahk'])).toBe(expected)
  })

  it('keeps a file without a final newline without one', () => {
    expect(adjustList(SMALL, [], [])).toBe(SMALL)
    const ending = String.raw`#Include commands\custom\ssh.ahk`
    const text = `; ****** Custom Commands ******\n${ending}`
    expect(adjustList(text, ['ahk/commands/custom/mine.ahk'], [])).toBe(`; ****** Custom Commands ******\n${ending}\n${MINE}`)
    expect(adjustList(text, [], ['ahk/commands/custom/ssh.ahk'])).toBe('; ****** Custom Commands ******')
  })

  it('adds files in sorted order whatever the order given', () => {
    const one = adjustList(SMALL, ['ahk/commands/custom/z.ahk', 'ahk/commands/custom/y.ahk'], [])
    expect(adjustList(SMALL, ['ahk/commands/custom/y.ahk', 'ahk/commands/custom/z.ahk'], [])).toBe(one)
    expect(listedCommandFiles(one).slice(-2)).toEqual(['ahk/commands/custom/y.ahk', 'ahk/commands/custom/z.ahk'])
  })

  it('takes out a line wherever it is and leaves the other files\' lines', () => {
    const text = adjustList(real, [], ['ahk/commands/power.ahk', 'ahk/commands/custom/chrome.ahk'])
    expect(listedCommandFiles(text)).toEqual(
      REAL_FILES.filter((p) => p !== 'ahk/commands/power.ahk' && p !== 'ahk/commands/custom/chrome.ahk'),
    )
  })
})

describe('listsExactly', () => {
  it('is true for the files the real file includes', () => {
    expect(listsExactly(real, REAL_FILES)).toBe(true)
  })

  it('is true after listFor, for the files then present', () => {
    const present = [...REAL_FILES.filter((p) => p !== 'ahk/commands/custom/ssh.ahk'), 'ahk/commands/custom/mine.ahk']
    expect(listsExactly(listFor(real, ['ahk/commands/custom/ssh.ahk'], ['ahk/commands/custom/mine.ahk']), present)).toBe(true)
  })

  it('ignores the order and the case of the files present', () => {
    expect(listsExactly(real, [...REAL_FILES].reverse().map((p) => p.toUpperCase()))).toBe(true)
  })

  it.each([
    ['one file missing from the list', [...REAL_FILES, 'ahk/commands/custom/mine.ahk']],
    ['one file listed that is not there', REAL_FILES.slice(1)],
    ['a different file in the place of one', [...REAL_FILES.slice(1), 'ahk/commands/custom/mine.ahk']],
  ])('is false with %s', (_name, present) => {
    expect(listsExactly(real, present)).toBe(false)
  })

  it('is true for no files and no includes', () => {
    expect(listsExactly('', [])).toBe(true)
  })
})
