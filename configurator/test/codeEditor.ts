import { undo as undoCommand } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from '@testing-library/react'

/** The one CodeMirror editor on the page. */
export function editorView(): EditorView {
  const dom = document.querySelector('.cm-editor')
  const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
  if (!view) throw new Error('No CodeMirror editor on the page')
  return view
}

const typed = Transaction.userEvent.of('input.type')

/** Inserts text at a position, as if the user typed it. */
export function typeAt(pos: number, text: string): void {
  const view = editorView()
  act(() => {
    view.dispatch({ changes: { from: pos, insert: text }, annotations: typed })
  })
}

/** Replaces the whole text, as if the user typed it. */
export function replaceAll(text: string): void {
  const view = editorView()
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: typed,
    })
  })
}

/** Undoes the last edit, as Ctrl+Z does. */
export function undo(): void {
  const view = editorView()
  act(() => {
    undoCommand(view)
  })
}
