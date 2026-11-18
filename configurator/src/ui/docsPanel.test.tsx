/** @vitest-environment jsdom */
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { replaceAll, typeAt } from '../../test/codeEditor'
import { pairButton, startCommands } from '../../test/commandsTab'
import { LANGUAGES } from '../core/languages'

// The right panel's docs, past what otherCommands.test.tsx covers: rows of one name, the state of
// groups, the one floating card, and the docs of the rows of "Commands in this file".

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const other = () => screen.getByRole('region', { name: 'Other commands available' })
const rows = (name: string) => within(other()).getAllByRole('button', { name: new RegExp(String.raw`^${name}\b`) })
const keyWarnings = (error: { mock: { calls: unknown[][] } }) => error.mock.calls.filter(([m]) => String(m).includes('same key'))

describe('the rows of Other commands available', () => {
  it('lists a function defined twice in one file as two rows', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    replaceAll('/**\n * First.\n */\nTwice(A)\n{\n}\n/**\n * Second.\n */\nTwice(A)\n{\n}\n')
    expect(rows('Twice')).toHaveLength(2)
    await user.click(rows('Twice')[0])
    expect(rows('Twice').map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    expect(keyWarnings(error)).toEqual([])
  })
})

describe('the dictionary behind the panel', () => {
  it('parses a draft once, not on every keystroke in another file', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('media'))
    typeAt(0, '; kept\n')
    await user.click(pairButton('windows'))
    const parse = vi.spyOn(LANGUAGES.ahk, 'findFunctions')
    typeAt(0, '; one\n')
    typeAt(0, '; two\n')
    expect(parse.mock.calls.filter(([text]) => text.startsWith('; kept\n'))).toHaveLength(0)
  })
})

describe('the groups of Other commands available', () => {
  it("starts each shown file's own group open, whatever was done to another's", async () => {
    const { user } = await startCommands({ files: { 'ahk/commands/tools.ahk': '/**\n * A tool.\n */\nTool(A)\n{\n}\n' } })
    await user.click(pairButton('tools'))
    const tools = () => within(other()).getAllByRole('button', { name: /^tools\b/ })[0]
    await user.click(tools())
    expect(tools().getAttribute('aria-expanded')).toBe('false')
    await user.click(pairButton('helper'))
    const shown = within(other()).getAllByRole('button', { name: /^helper\b/ })[0]
    expect(shown.getAttribute('aria-expanded')).toBe('true')
  })
})
