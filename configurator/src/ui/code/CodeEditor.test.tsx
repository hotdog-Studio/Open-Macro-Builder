/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorView, replaceAll, typeAt, undo } from '../../../test/codeEditor'
import { CodeEditor } from './CodeEditor'

afterEach(cleanup)

type Props = Parameters<typeof CodeEditor>[0]

function start(over: Partial<Props> = {}) {
  const onChange = vi.fn()
  const props: Props = {
    docKey: 'local/ahk/a.ahk',
    lang: 'ahk',
    value: 'one',
    onChange,
    label: 'AutoHotkey code',
    ...over,
  }
  const { rerender } = render(<CodeEditor {...props} />)
  return {
    onChange,
    again: (next: Partial<Props>) => rerender(<CodeEditor {...props} {...next} />),
  }
}

const text = () => editorView().state.doc.toString()

describe('CodeEditor', () => {
  it('shows the text exactly', () => {
    start({ value: 'a\n\tb' })
    expect(text()).toBe('a\n\tb')
    expect(editorView().state.doc.lines).toBe(2)
    expect(editorView().contentDOM.getAttribute('aria-label')).toBe('AutoHotkey code')
  })

  it('keeps a lone carriage return', () => {
    const { onChange } = start({ value: 'a\rb' })
    expect(editorView().state.doc.lines).toBe(1)
    expect(text()).toBe('a\rb')
    typeAt(3, '!')
    expect(onChange).toHaveBeenLastCalledWith('a\rb!')
  })

  it('reports each user edit as the whole text', () => {
    const { onChange } = start({ value: 'a\n\tb' })
    typeAt(1, 'X')
    expect(onChange).toHaveBeenLastCalledWith('aX\n\tb')
    replaceAll('new')
    expect(onChange).toHaveBeenLastCalledWith('new')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not report a value it was given', () => {
    const { onChange, again } = start()
    again({ value: 'two' })
    expect(text()).toBe('two')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces the text when the value changes', () => {
    const { again } = start({ value: 'one\ntwo' })
    const view = editorView()
    again({ value: 'reloaded' })
    expect(editorView()).toBe(view)
    expect(text()).toBe('reloaded')
  })

  it('a new value starts a fresh undo history', () => {
    const { onChange, again } = start({ value: 'one\ntwo' })
    typeAt(3, 'X')
    onChange.mockClear()
    again({ value: 'reloaded' })
    // Neither the replace nor the edit before it can be undone: the disk no longer has that text.
    undo()
    expect(text()).toBe('reloaded')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a new value keeps the cursor where it still fits', () => {
    const { again } = start({ value: 'one\ntwo\nthree' })
    act(() => editorView().dispatch({ selection: { anchor: 5 } }))
    again({ value: 'one\ntwo\nthree!' })
    expect(editorView().state.selection.main.head).toBe(5)
    again({ value: 'ab' })
    expect(editorView().state.selection.main.head).toBe(2)
    // The language, the label and read-only carry over to the new state.
    expect(editorView().contentDOM.getAttribute('aria-label')).toBe('AutoHotkey code')
    again({ value: 'ab', readOnly: true })
    again({ value: 'cd', readOnly: true })
    expect(editorView().state.readOnly).toBe(true)
  })

  it('undo reverts a user edit under the same key', () => {
    start()
    typeAt(3, 'X')
    expect(text()).toBe('oneX')
    undo()
    expect(text()).toBe('one')
  })

  it('a new docKey starts a fresh undo history', () => {
    const { again } = start()
    typeAt(3, 'X')
    again({ docKey: 'local/ahk/b.ahk', value: 'two' })
    expect(text()).toBe('two')
    undo()
    expect(text()).toBe('two')
  })

  it('read-only refuses edits', () => {
    const { again } = start({ readOnly: true })
    expect(editorView().state.readOnly).toBe(true)
    expect(editorView().contentDOM.getAttribute('contenteditable')).toBe('false')
    again({ readOnly: false })
    expect(editorView().state.readOnly).toBe(false)
    expect(editorView().contentDOM.getAttribute('contenteditable')).toBe('true')
  })

  it('Ctrl+S calls onSave', () => {
    const onSave = vi.fn()
    start({ onSave })
    fireEvent.keyDown(editorView().contentDOM, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('jumps to a line', () => {
    const { again } = start({ value: 'l1\nl2\nl3\nl4' })
    const lineOfCursor = () => {
      const { state } = editorView()
      return state.doc.lineAt(state.selection.main.head).number
    }
    again({ jump: { line: 3, n: 1 } })
    expect(lineOfCursor()).toBe(3)
    expect(editorView().state.selection.main.head).toBe(6)
    again({ jump: { line: 1, n: 2 } })
    expect(lineOfCursor()).toBe(1)
  })

  it('switching language keeps the text', () => {
    const { again } = start({ value: 'Write-Host "hi"' })
    const view = editorView()
    again({ lang: 'ps' })
    expect(editorView()).toBe(view)
    expect(text()).toBe('Write-Host "hi"')
  })
})
