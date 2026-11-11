import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type { LangId } from '../../core/languages'
import { HIGHLIGHT } from './highlight'

export interface CodeEditorProps {
  /** The file path. A new key gives a new document with a fresh undo history. */
  docKey: string
  lang: LangId
  value: string
  /** Called with the whole text after each edit the user makes, never for a `value` it was given. */
  onChange(text: string): void
  /** The accessible name of the text area. */
  label: string
  readOnly?: boolean
  /** Selects the start of line `line` (1-based) and scrolls to it whenever `n` changes. */
  jump?: { line: number; n: number } | null
  /** Runs on Ctrl+S (Cmd+S on a Mac). */
  onSave?(): void
}

/** Marks a transaction that applies a `value` from outside, so it is not reported as an edit. */
const fromOutside = Annotation.define<boolean>()

const THEME = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace' },
})

/** A CodeMirror editor for one command file at a time. */
export function CodeEditor({
  docKey,
  lang,
  value,
  onChange,
  label,
  readOnly = false,
  jump = null,
  onSave,
}: Readonly<CodeEditorProps>) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compartments = useRef({
    lang: new Compartment(),
    readOnly: new Compartment(),
    label: new Compartment(),
  })

  // The editor outlives renders, so its callbacks read the latest props from here.
  const latest = useRef({ value, lang, label, readOnly, onChange, onSave })
  useEffect(() => {
    latest.current = { value, lang, label, readOnly, onChange, onSave }
  })

  // One editor state per document: a new key starts again, with an empty undo history.
  useEffect(() => {
    const c = compartments.current
    const now = latest.current
    const view = new EditorView({
      parent: host.current ?? undefined,
      state: EditorState.create({
        doc: now.value,
        extensions: [
          // Only \n splits lines, so a lone \r stays a character and saving writes what was typed.
          EditorState.lineSeparator.of('\n'),
          EditorState.tabSize.of(4),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          bracketMatching(),
          oneDark,
          THEME,
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                latest.current.onSave?.()
                return true
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          c.lang.of(HIGHLIGHT[now.lang]()),
          c.readOnly.of(readOnlyExtensions(now.readOnly)),
          c.label.of(EditorView.contentAttributes.of({ 'aria-label': now.label })),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            if (update.transactions.some((tr) => tr.annotation(fromOutside))) return
            latest.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [docKey])

  // A value that differs from the document (a reload, an outside change) replaces all of it.
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: fromOutside.of(true),
    })
  }, [value, docKey])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.lang.reconfigure(HIGHLIGHT[lang]()),
    })
  }, [lang, docKey])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.readOnly.reconfigure(readOnlyExtensions(readOnly)),
    })
  }, [readOnly, docKey])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.label.reconfigure(
        EditorView.contentAttributes.of({ 'aria-label': label }),
      ),
    })
  }, [label, docKey])

  const jumpLine = jump?.line
  const jumpN = jump?.n
  useEffect(() => {
    const view = viewRef.current
    if (!view || jumpLine === undefined) return
    const line = view.state.doc.line(Math.min(Math.max(jumpLine, 1), view.state.doc.lines))
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
  }, [jumpLine, jumpN, docKey])

  return <div ref={host} className="h-full min-h-0 w-full overflow-hidden" />
}

function readOnlyExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}
