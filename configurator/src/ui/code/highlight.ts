import { StreamLanguage } from '@codemirror/language'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import type { Extension } from '@codemirror/state'
import type { LangId } from '../../core/languages'
import { ahkMode } from './ahkMode'

const AHK = StreamLanguage.define(ahkMode)
const PS = StreamLanguage.define(powerShell)

/** The syntax highlighting for each command language. */
export const HIGHLIGHT: Record<LangId, () => Extension> = {
  ahk: () => AHK,
  ps: () => PS,
}
