import { keysUsing, type KeyUse } from '../commands/usage'
import type { Workspace } from '../config/model'
import { definedNames, LANG_IDS, type CommandFile, type LangId } from '../languages'
import type { UpdatePicks } from './apply'
import type { UpdatePlan } from './plan'

/** A command the layout names, with the keys that run it on the layers that sit on a key. */
export interface NamedCommand {
  /** As the layout spells it where it is first used. */
  name: string
  /** The layers that sit on a key only: a parked layer is never loaded, so its commands need not exist. */
  keys: KeyUse[]
}

const lowerSet = (paths: readonly string[]) => new Set(paths.map((path) => path.toLowerCase()))

/**
 * The command files the folder holds after an update that carries out `plan` with `picks`, by the plan's own rules:
 * a file of the app's copy is the app's, unless it is a changed file not ticked (the folder's stays) or a deleted
 * one not ticked (none); a file the app's copy does not have stays (one of the person's own, a changed one the app
 * no longer has), unless the update removes it. `now` are the folder's command files, `app` the app's copy's.
 */
export function commandFilesAfter(
  now: readonly CommandFile[],
  app: readonly CommandFile[],
  plan: Pick<UpdatePlan, 'changed' | 'deleted' | 'remove'>,
  picks: UpdatePicks,
): CommandFile[] {
  const ticked = lowerSet([...picks.replaceChanged, ...picks.restoreDeleted])
  const keptChanged = new Set([...lowerSet(plan.changed)].filter((path) => !ticked.has(path)))
  const stayDeleted = new Set([...lowerSet(plan.deleted)].filter((path) => !ticked.has(path)))
  const removed = lowerSet(plan.remove)
  const appPaths = lowerSet(app.map((f) => f.file.path))
  const held = now.filter((f) => {
    const path = f.file.path.toLowerCase()
    return appPaths.has(path) ? keptChanged.has(path) : !removed.has(path)
  })
  const fromApp = app.filter((f) => !keptChanged.has(f.file.path.toLowerCase()) && !stayDeleted.has(f.file.path.toLowerCase()))
  return [...held, ...fromApp]
}

/** Each command the macros of the layers on keys run, once (ignoring case), in key order. */
function namedCommands(ws: Workspace): NamedCommand[] {
  const actions = ws.keys.flatMap((k) => {
    const layer = ws.slots[k.id]
    return layer ? ws.keys.map((j) => layer.macros[j.id]?.action ?? '') : []
  })
  const names = new Map<string, string>()
  for (const action of actions) {
    if (action !== '' && !names.has(action.toLowerCase())) names.set(action.toLowerCase(), action)
  }
  return [...names.values()].map((name) => ({ name, keys: keysUsing(ws, name).filter((use) => !use.parked) }))
}

/** For each language, the lower-cased names `files` define, counted as the layout check counts them. */
function definedIn(files: readonly CommandFile[]): Record<LangId, Set<string>> {
  const defined = {} as Record<LangId, Set<string>>
  for (const lang of LANG_IDS) defined[lang] = definedNames(files, lang)
  return defined
}

/**
 * The commands the layers on keys run that `files` leave undefined in a language the person runs: as the layout
 * check decides, and the macropad of that language does not start.
 */
export function undefinedCommands(ws: Workspace, languages: readonly LangId[], files: readonly CommandFile[]): NamedCommand[] {
  const defined = definedIn(files)
  return namedCommands(ws).filter((c) => languages.some((lang) => !defined[lang].has(c.name.toLowerCase())))
}

/**
 * The commands the layers on keys run that a file defines now (`now`) and none will after the update (`after`),
 * in a language the person runs: the update would leave a macropad that does not start.
 */
export function lostCommands(
  ws: Workspace,
  languages: readonly LangId[],
  now: readonly CommandFile[],
  after: readonly CommandFile[],
): NamedCommand[] {
  const was = definedIn(now)
  const will = definedIn(after)
  return namedCommands(ws).filter((c) => {
    const name = c.name.toLowerCase()
    return languages.some((lang) => was[lang].has(name) && !will[lang].has(name))
  })
}
