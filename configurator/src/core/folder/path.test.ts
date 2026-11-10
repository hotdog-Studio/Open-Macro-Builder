import { describe, expect, it } from 'vitest'
import { normalizePath, PathError } from './path'

describe('normalizePath', () => {
  it('turns backslashes into slashes and drops "." segments', () => {
    expect(normalizePath('a\\b/./c')).toBe('a/b/c')
  })

  it.each(['', '/x', 'C:/x', 'a/../b', '..'])('rejects %j', (bad) => {
    expect(() => normalizePath(bad)).toThrow(PathError)
  })
})
