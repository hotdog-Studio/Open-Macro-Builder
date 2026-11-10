import { validateConfig } from '../../../../scripts/validate-config-core.mjs'
import { LANG_IDS } from '../languages'
import type { LangId } from '../languages'
import type { Workspace } from './model'
import { writeConfig } from './write'

export interface CheckResult {
  errors: string[]
  warnings: string[]
}

export interface CheckContext {
  iconSets: Set<string>
  defined: Record<LangId, Set<string>>
  /** The languages the user runs: a missing command there is an error, in the others a warning. */
  languages: LangId[]
}

/** The command sets for validateConfig: the given languages only, the others skipped (null). */
function commandSets(ctx: CheckContext, langs: LangId[]) {
  const pick = (id: LangId) => (langs.includes(id) ? ctx.defined[id] : null)
  return { ahkActions: pick('ahk'), psActions: pick('ps') }
}

/** Key names repeated across the macro keys and Fn, ignoring case; each message uses the later spelling. */
function duplicateKeyNames(ws: Workspace): string[] {
  const seen = new Set<string>()
  const errors: string[] = []
  for (const k of [ws.fn, ...ws.keys]) {
    const folded = k.key.toLowerCase()
    if (folded === '') continue
    if (seen.has(folded)) errors.push(`Key name "${k.key}" is used twice.`)
    seen.add(folded)
  }
  return errors
}

/**
 * What stops a save (errors) and what only deserves a look (warnings). A command missing from
 * a language the user runs is an error; missing from one they do not run is a warning.
 */
export function checkWorkspace(ws: Workspace, ctx: CheckContext): CheckResult {
  const config: unknown = JSON.parse(writeConfig(ws))
  const mine = ctx.languages
  const errors = validateConfig(config, {
    iconExists: (name) => ctx.iconSets.has(name),
    ...commandSets(ctx, mine),
  })
  // Structure and icons repeat identically in both runs, so only what the first run did not say is new.
  const known = new Set(errors)
  const warnings = validateConfig(config, {
    iconExists: () => true,
    ...commandSets(
      ctx,
      LANG_IDS.filter((id) => !mine.includes(id)),
    ),
  }).filter((m) => !known.has(m))
  return { errors: [...errors, ...duplicateKeyNames(ws)], warnings }
}
