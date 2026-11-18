import { describe, expect, it } from 'vitest'
import { exampleOf, textOf } from './types'

describe('exampleOf', () => {
  it('drops the blank lines at its ends and trims its first line', () => {
    expect(exampleOf(['  F(1)  ', 'G(2)', '', ''])).toBe('F(1)\nG(2)')
    expect(exampleOf(['', '', 'F(1)'])).toBe('F(1)')
    expect(exampleOf(['', '   '])).toBe('')
  })

  it('takes the indentation all its lines share off each of them', () => {
    expect(exampleOf(['', '    Send-Click 1 2'])).toBe('Send-Click 1 2')
    expect(exampleOf(['', '    a', '        b'])).toBe('a\n    b')
    expect(exampleOf(['', '    a', '', '      b'])).toBe('a\n\n  b')
  })
})

describe('textOf', () => {
  it('joins lines into one', () => {
    expect(textOf(['a  b', ' c', ''])).toBe('a b c')
  })
})
