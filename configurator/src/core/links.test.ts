import { describe, expect, it } from 'vitest'
import { isAllowedLink, LINKS } from './links'

describe('the links the desktop app may open', () => {
  it.each(Object.entries(LINKS))('allows the %s link', (_name, url) => {
    expect(isAllowedLink(url)).toBe(true)
  })

  it.each([
    ['the same address over plain http', 'http://www.autohotkey.com/download/'],
    ['the same address with a query', 'https://www.autohotkey.com/download/?x=1'],
    ['another page of the same site', 'https://www.autohotkey.com/'],
    ['a look-alike host', 'https://www.autohotkey.com.evil.example/download/'],
    ['a file address', 'file:///C:/Windows/System32/cmd.exe'],
    ['an empty address', ''],
  ])('refuses %s', (_what, url) => {
    expect(isAllowedLink(url)).toBe(false)
  })
})
