import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  ViewPlugin,
} from '@codemirror/view'
import { useEffect, useRef, type RefObject } from 'react'
import type { Dictionary } from '../../core/commands/dictionary'
import type { LangId } from '../../core/languages'
import { HIGHLIGHT } from './highlight'
import { hoverDocs } from './hoverDocs'

export interface CodeEditorProps {
  /** The file path. A new key gives a new document with a fresh undo history. */
  docKey: string
  lang: LangId
  /** A value that differs from the text replaces it and starts a fresh undo history. */
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
  /** What the names in the text can be looked up in; the docs of a name show when the pointer rests on it. */
  docs?: Dictionary | null
}

const THEME = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace' },
  // The hint's line is always laid out, so the text never moves when the focus comes or goes. Only whether
  // it is seen changes: it stays in the page and in the accessibility tree either way.
  '.cm-tab-hint': {
    padding: '2px 12px',
    fontSize: '0.75rem',
    lineHeight: '1.25',
    color: '#abb2bf',
    borderTop: '1px solid #3f4451',
    opacity: '0',
  },
  '&.cm-focused .cm-tab-hint': { opacity: '1' },
})

/** Said under the editor, because Tab indents there and a person on the keyboard would be stuck in it. */
const TAB_HINT = 'Tab indents. To leave the editor with the keyboard, press Esc and then Tab.'
let hintCount = 0

/**
 * Escape arms leaving the editor: Tab or Shift+Tab pressed next moves the focus out, however long after
 * the Escape, until another key is pressed or the focus leaves. CodeMirror's own Escape (tab-focus mode)
 * lasts two seconds; this runs after it in the same event and lasts on. Infinity is a time never reached
 * by the clock, and a key other than Tab ends it as it ends CodeMirror's. A mode a person turned on
 * with Ctrl-m stays as it is (a number does not touch it), and a focus that leaves ends the armed one
 * (a time already past), so coming back finds Tab indenting again.
 */
const LEAVE_WITH_TAB = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key === 'Escape') queueMicrotask(() => view.setTabFocusMode(Infinity))
    return false
  },
  blur(_event, view) {
    view.setTabFocusMode(-1)
  },
})

/**
 * A line of the editor's own that says how to leave it with the keyboard, and the Escape that does it.
 * The line is always laid out and in the page for a screen reader, drawn while the focus is in the
 * editor (see THEME), and the editor's content names it.
 */
function tabHint(): Extension {
  const id = `cm-tab-hint-${++hintCount}`
  const line = ViewPlugin.define((view) => {
    const el = document.createElement('div')
    el.id = id
    el.className = 'cm-tab-hint'
    el.textContent = TAB_HINT
    view.dom.append(el)
    return { destroy: () => el.remove() }
  })
  return [line, LEAVE_WITH_TAB, EditorView.contentAttributes.of({ 'aria-describedby': id })]
}

type Latest = Pick<CodeEditorProps, 'value' | 'lang' | 'label' | 'onChange' | 'onSave' | 'docs'> & { readOnly: boolean }

interface Compartments {
  lang: Compartment
  readOnly: Compartment
  label: Compartment
}

/** A new editor state for `doc`, with an empty undo history, set up from the latest props. */
function createState(
  doc: string,
  selection: EditorSelection | undefined,
  c: Compartments,
  latest: RefObject<Latest>,
): EditorState {
  const now = latest.current
  return EditorState.create({
    doc,
    selection,
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
      hoverDocs(() => latest.current.docs ?? null),
      // A `value` it is given arrives as a new state, never as a transaction, so every change seen here is the user's.
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
      }),
    ],
  })
}

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
  docs,
}: Readonly<CodeEditorProps>) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compartments = useRef<Compartments>({
    lang: new Compartment(),
    readOnly: new Compartment(),
    label: new Compartment(),
  })

  // The editor outlives renders, so its callbacks read the latest props from here.
  const latest = useRef<Latest>({ value, lang, label, readOnly, onChange, onSave, docs })
  useEffect(() => {
    latest.current = { value, lang, label, readOnly, onChange, onSave, docs }
  })

  // One editor state per document: a new key starts again, with an empty undo history.
  useEffect(() => {
    const view = new EditorView({
      parent: host.current ?? undefined,
      state: createState(latest.current.value, undefined, compartments.current, latest),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [docKey])

  // A value that differs from the document (a reload, an outside change) replaces all of it with a
  // fresh undo history: an undo past it would bring back text the disk no longer has, and a save
  // would then write it over the outside change. The cursor and the scroll stay where they fit.
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    const { scrollTop, scrollLeft } = view.scrollDOM
    const fit = (pos: number) => Math.min(pos, value.length)
    const { ranges, mainIndex } = view.state.selection
    const selection = EditorSelection.create(
      ranges.map((r) => EditorSelection.range(fit(r.anchor), fit(r.head))),
      mainIndex,
    )
    view.setState(createState(value, selection, compartments.current, latest))
    view.scrollDOM.scrollTop = scrollTop
    view.scrollDOM.scrollLeft = scrollLeft
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

/** What changes with read-only: a file that is read-only is not indented, so it has no hint about Tab. */
function readOnlyExtensions(readOnly: boolean): Extension[] {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), readOnly ? [] : tabHint()]
}
