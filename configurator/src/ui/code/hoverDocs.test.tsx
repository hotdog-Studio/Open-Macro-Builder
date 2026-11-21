/** @vitest-environment jsdom */
import { EditorState } from '@codemirror/state'
import { EditorView, type TooltipView } from '@codemirror/view'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDictionary } from '../../core/commands/dictionary'
import { AHK_REFERENCE } from '../../core/commands/ahkReference'
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

describe('docTooltipAt in an AutoHotkey file', () => {
  const AHK_DOC = 'Copy(Macro)\n{\n    Send "^c"\n}\n'
  const ahkPath = 'ahk/commands/helper.ahk'
  const ahkDict = (text: string | null) =>
    buildDictionary({
      lang: 'ahk',
      shown: null,
      commandFiles: text === null ? [] : [{ ...commandFileAt(ahkPath)!, file: { ...newTextFile(ahkPath, text), version: 'v1' }, functions: LANGUAGES.ahk.findFunctions(text), editable: true }],
      libraryFiles: [],
      drafts: {},
      reference: AHK_REFERENCE,
    })

  /** The text of the card the editor shows for the name at `pos`, drawn as the editor draws it. */
  function cardText(pos: number, dict: ReturnType<typeof ahkDict>): string {
    const v = new EditorView({ state: EditorState.create({ doc: AHK_DOC, extensions: [HIGHLIGHT.ahk()] }) })
    view = v
    const tooltip = docTooltipAt(v, pos, 1, dict)
    if (!tooltip) throw new Error('no card')
    const made: { card?: TooltipView } = {}
    act(() => {
      made.card = tooltip.create(v)
    })
    if (!made.card) throw new Error('no card drawn')
    const text = made.card.dom.textContent ?? ''
    made.card.destroy?.()
    return text
  }

  it.each([
    ["AutoHotkey's own Send, from the reference", null, ['Send(Keys)', 'In the PowerShell version: Send-Ahk', 'https://www.autohotkey.com/docs/v2/lib/Send.htm']],
    ['a function of the folder named Send, which wins', '/**\n * Mine.\n */\nSend(Keys)\n{\n}\n', ['Mine.', 'ahk/commands/helper.ahk · line 4']],
  ])('shows %s', (_name, own, parts) => {
    const text = cardText(AHK_DOC.indexOf('Send') + 2, ahkDict(own))
    for (const part of parts) expect(text).toContain(part)
  })
})
