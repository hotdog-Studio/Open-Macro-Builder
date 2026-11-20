import { expect, it } from 'vitest'
import { compareVersions } from './version'

it.each([
  ['1.0.4', '1.0.6', -1],
  ['1.0.10', '1.0.9', 1],
  ['1.0.6', '1.0.6', 0],
  ['1.0.0-dev', '1.0.0', 0],
  ['1.0.0-dev', '1.0.4', -1],
  ['nonsense', '1.0.4', 0],
  ['1.0.4', '', 0],
  ['1.2.0', '1.10.0', -1],
  ['2.0.0', '1.99.99', 1],
])('compares %s with %s', (a, b, sign) => {
  expect(Math.sign(compareVersions(a, b))).toBe(sign)
})
