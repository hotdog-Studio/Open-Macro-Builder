import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view'
import { createRoot } from 'react-dom/client'
import { nameAt, type Dictionary } from '../../core/commands/dictionary'
import { DocCard } from './DocCard'

/** How long the pointer rests on a name before its card shows, in milliseconds (CodeMirror's own default). */
export const HOVER_TIME = 300

/** How long a hover may wait for the syntax tree to reach the pointer, in milliseconds. */
const TREE_WAIT = 50

/** Whether the highlighter calls the text at `pos` a comment or a string, where a name is no call. */
function inCommentOrString(view: EditorView, pos: number): boolean {
  // In a long file the parse may not reach `pos` in time: then the tree as far as it got.
  const tree = ensureSyntaxTree(view.state, pos, TREE_WAIT) ?? syntaxTree(view.state)
  const name = tree.resolveInner(pos, 1).name
  return name.includes('comment') || name.includes('string')
}

/**
 * CodeMirror puts a hover card in a box of its own (`.cm-tooltip-hover`) and, when the card does
 * not fit above or below the name, gives that box the height there is room for. The card then
 * scrolls inside it; the box stays up while the pointer is over it, so the wheel reaches it.
 */
const scrollingCard = EditorView.theme({ '.cm-tooltip-hover': { overflowY: 'auto' } })

/**
 * Shows the docs of the function name under the pointer, from the dictionary `get` returns (read on
 * every hover, so it follows what is typed). Nothing shows over a comment, a string, a variable, or a
 * name the dictionary does not know. Any change to the text takes the card away: it would show the
 * docs it was made with.
 */
export function hoverDocs(get: () => Dictionary | null): Extension {
  const tooltip = hoverTooltip((view, pos, side) => docTooltipAt(view, pos, side, get()), { hideOnChange: true, hoverTime: HOVER_TIME })
  return [tooltip, scrollingCard]
}

/** The card for the name the pointer rests on at `pos` (`side` -1: left of it); null where there is none to show. */
export function docTooltipAt(view: EditorView, pos: number, side: -1 | 1, dict: Dictionary | null): Tooltip | null {
  // A CodeEditor given no docs (its own tests render it so) shows no card.
  if (!dict) return null
  const line = view.state.doc.lineAt(pos)
  // The pointer is over the character before `pos` when it is left of it (side -1), else the one at it.
  const at = pos - line.from - (side < 0 ? 1 : 0)
  const hit = at >= 0 ? nameAt(line.text, at, dict.lang) : null
  if (!hit) return null
  const from = line.from + hit.from
  if (inCommentOrString(view, from)) return null
  const entry = dict.lookup(hit.name)
  if (!entry) return null
  return {
    pos: from,
    end: line.from + hit.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      const root = createRoot(dom)
      root.render(<DocCard entry={entry} />)
      // Unmounted in a microtask: the tooltip can go while React is still rendering.
      return { dom, destroy: () => queueMicrotask(() => root.unmount()) }
    },
  }
}
