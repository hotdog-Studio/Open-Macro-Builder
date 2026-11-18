import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { hoverTooltip, type EditorView } from '@codemirror/view'
import { createRoot } from 'react-dom/client'
import { nameAt, type Dictionary } from '../../core/commands/dictionary'
import { DocCard } from './DocCard'

/** How long a hover may wait for the syntax tree to reach the pointer, in milliseconds. */
const TREE_WAIT = 50

/** Whether the highlighter calls the text at `pos` a comment or a string, where a name is no call. */
function inCommentOrString(view: EditorView, pos: number): boolean {
  const tree = ensureSyntaxTree(view.state, pos, TREE_WAIT) ?? syntaxTree(view.state)
  const name = tree.resolveInner(pos, 1).name
  return name.includes('comment') || name.includes('string')
}

/**
 * Shows the docs of the function name under the pointer, from the dictionary `get` returns (read on
 * every hover, so it follows what is typed). Nothing shows over a comment, a string, a variable, or a
 * name the dictionary does not know.
 */
export function hoverDocs(get: () => Dictionary | null): Extension {
  return hoverTooltip((view, pos, side) => {
    const dict = get()
    if (!dict) return null
    const line = view.state.doc.lineAt(pos)
    const column = pos - line.from
    // The end of a name belongs to it when the pointer came from the left of that position.
    const hit = nameAt(line.text, column, dict.lang) ?? (side < 0 && column > 0 ? nameAt(line.text, column - 1, dict.lang) : null)
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
  })
}
