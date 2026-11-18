/** @vitest-environment jsdom */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDictionary } from '../../core/commands/dictionary'
import { newTextFile } from '../../core/folder/textFile'
import { commandFileAt, LANGUAGES } from '../../core/languages'
import { HIGHLIGHT } from './highlight'
import { docTooltipAt } from './hoverDocs'

// The editor's hover rules without layout: which text gets a card. Where the card shows needs a real
// browser (commands.browser.test.tsx, "Commands tab: docs on hover").

const HELPER = '<#\n.SYNOPSIS\nPresses keys.\n#>\nfunction Send-Chord {\n    param($Chord)\n}\n'
const path = 'powershell/commands/helper.ps1'
const dict = buildDictionary({
  lang: 'ps',
  shown: null,
  commandFiles: [{ ...commandFileAt(path)!, file: { ...newTextFile(path, HELPER), version: 'v1' }, functions: LANGUAGES.ps.findFunctions(HELPER), editable: true }],
  libraryFiles: [],
  drafts: {},
})

const DOC = "# Send-Chord\n$x = 'Send-Chord'\n$Send-Chord\nNot-Known 1\nSend-Chord 'a'\n"
let view: EditorView | null = null
const editor = () => {
  view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [HIGHLIGHT.ps()] }) })
  return view
}

afterEach(() => {
  view?.destroy()
  view = null
})

describe('docTooltipAt', () => {
  it('answers for a call only: not in a comment, a string, a variable or an unknown name', () => {
    const v = editor()
    const call = DOC.lastIndexOf('Send-Chord')
    expect(docTooltipAt(v, DOC.indexOf('Send-Chord') + 3, 1, dict)).toBeNull()
    expect(docTooltipAt(v, DOC.indexOf("Send-Chord'") + 3, 1, dict)).toBeNull()
    expect(docTooltipAt(v, DOC.indexOf('$Send-Chord') + 3, 1, dict)).toBeNull()
    expect(docTooltipAt(v, DOC.indexOf('Not-Known') + 3, 1, dict)).toBeNull()
    expect(docTooltipAt(v, call + 3, 1, dict)).toMatchObject({ pos: call, end: call + 'Send-Chord'.length })
  })

  it('reads the character left of the pointer at the end of a name', () => {
    const v = editor()
    const end = DOC.lastIndexOf('Send-Chord') + 'Send-Chord'.length
    expect(docTooltipAt(v, end, -1, dict)).not.toBeNull()
    expect(docTooltipAt(v, end, 1, dict)).toBeNull()
    // Left of the first character of a line there is nothing.
    expect(docTooltipAt(v, DOC.lastIndexOf('Send-Chord'), -1, dict)).toBeNull()
  })

  it('shows no card without docs', () => {
    expect(docTooltipAt(editor(), DOC.lastIndexOf('Send-Chord') + 3, 1, null)).toBeNull()
  })
})
