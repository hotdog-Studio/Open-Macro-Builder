import { describe, expect, it } from 'vitest'
import { messageOf, withoutFullStop } from './message'

describe('messageOf', () => {
  it.each<[string, unknown, string]>([
    ['an error', new Error('The disk is full.'), 'The disk is full.'],
    ['a text', 'Gone.', 'Gone.'],
    ['anything else', { code: 5 }, 'An unknown error.'],
  ])('gives the message of %s', (_name, cause, message) => {
    expect(messageOf(cause)).toBe(message)
  })
})

describe('withoutFullStop', () => {
  it.each([
    ['The disk is full.', 'The disk is full'],
    ['The disk is full', 'The disk is full'],
    ['Wait...', 'Wait..'],
  ])('%s becomes %s', (message, out) => {
    expect(withoutFullStop(message)).toBe(out)
  })
})
