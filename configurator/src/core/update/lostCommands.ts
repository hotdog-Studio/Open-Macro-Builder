import { keysUsing } from '../commands/usage'
import type { Workspace } from '../config/model'
import { definedNames, LANG_IDS, type CommandFile, type LangId } from '../languages'
import type { UpdatePicks } from './apply'
import type { UpdatePlan } from './plan'

/** Where the layout runs a command: a key of a layer on a key, a hotkey, or a hotstring with the X option. */
export interface CommandPlace {
  kind: 'key' | 'hotkey' | 'hotstring'
  /** As a person finds it: `VS Studio · F15` (the Macros tab's names), `Hotkey ^!e`, `Hotstring :X:now`. */
  name: string
}

/** A command the layout runs, where it runs it, and the languages it is missing from. */
export interface NamedCommand {
  /** As the layout spells it where it is first used. */
  name: string
  /** Keys first, in key order, then hotkeys, then hotstrings, each in the file's order. */
  places: CommandPlace[]
  /** The languages the person runs in which no file defines it (would define it, for a lost one). */
  langs: LangId[]
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Whether a hotstring runs an action: the X option (not X0), as the layout check reads it. */
function executes(hotstring: string): boolean {
  const options = /^:([^:]*):./.exec(hotstring)
  return options !== null && /X(?!0)/i.test(options[1])
}

/** The action and place of each hotkey, and of each hotstring with the X option, that the layout check counts. */
function hotkeyRuns(ws: Workspace): { action: string; place: CommandPlace }[] {
  const hotkeys = listOf(ws.hotkeys).flatMap((h) =>
    isRecord(h) && typeof h.hotkey === 'string' && typeof h.action === 'string'
      ? [{ action: h.action, place: { kind: 'hotkey' as const, name: `Hotkey ${h.hotkey}` } }]
      : [],
  )
  const hotstrings = listOf(ws.hotstrings).flatMap((s) =>
    isRecord(s) && typeof s.hotstring === 'string' && typeof s.action === 'string' && s.action !== '' && executes(s.hotstring)
      ? [{ action: s.action, place: { kind: 'hotstring' as const, name: `Hotstring ${s.hotstring}` } }]
      : [],
  )
  return [...hotkeys, ...hotstrings]
}

/**
 * Each command the layout runs, once (ignoring case), with where: the macros of the layers on keys (a parked layer
 * is never loaded), the hotkeys and the hotstrings with the X option. Both macropads refuse to start on any of them
 * that no file defines.
 */
function namedCommands(ws: Workspace): Omit<NamedCommand, 'langs'>[] {
  const keyActions = ws.keys.flatMap((k) => {
    const layer = ws.slots[k.id]
    return layer ? ws.keys.map((j) => layer.macros[j.id]?.action ?? '') : []
  })
  const commands = new Map<string, Omit<NamedCommand, 'langs'>>()
  const named = (action: string) => {
    const key = action.toLowerCase()
    let command = commands.get(key)
    if (!command) {
      command = { name: action, places: [] }
      commands.set(key, command)
    }
    return command
  }
  for (const action of keyActions.filter((a) => a !== '')) {
    const command = named(action)
    if (command.places.length === 0) {
      const keys = keysUsing(ws, action).filter((use) => !use.parked)
      command.places.push(...keys.map((use) => ({ kind: 'key' as const, name: `${use.layer} · ${use.key}` })))
    }
  }
  for (const { action, place } of hotkeyRuns(ws)) named(action).places.push(place)
  return [...commands.values()]
}

/** For each language, the lower-cased names `files` define, counted as the layout check counts them. */
function definedIn(files: readonly CommandFile[]): Record<LangId, Set<string>> {
  const defined = {} as Record<LangId, Set<string>>
  for (const lang of LANG_IDS) defined[lang] = definedNames(files, lang)
  return defined
}

/** What an item shows in place of the name of a hotkey whose action is empty (the layout check counts it; no file can define it). */
const NO_COMMAND = 'no command'

/** The commands with the languages each is missing from, those missing from none left out. */
function missing(ws: Workspace, isMissing: (lang: LangId, name: string) => boolean, languages: readonly LangId[]): NamedCommand[] {
  return namedCommands(ws).flatMap((c) => {
    const langs = languages.filter((lang) => isMissing(lang, c.name.toLowerCase()))
    return langs.length > 0 ? [{ ...c, name: c.name === '' ? NO_COMMAND : c.name, langs }] : []
  })
}

/**
 * The commands the layout runs that `files` leave undefined in a language the person runs: as the layout check
 * decides, and the macropad of that language does not start.
 */
export function undefinedCommands(ws: Workspace, languages: readonly LangId[], files: readonly CommandFile[]): NamedCommand[] {
  const defined = definedIn(files)
  return missing(ws, (lang, name) => !defined[lang].has(name), languages)
}

/**
 * The commands the layout runs that a file defines now (`now`) and none will after the update (`after`), in a
 * language the person runs: the update would leave a macropad that does not start.
 */
export function lostCommands(
  ws: Workspace,
  languages: readonly LangId[],
  now: readonly CommandFile[],
  after: readonly CommandFile[],
): NamedCommand[] {
  const was = definedIn(now)
  const will = definedIn(after)
  return missing(ws, (lang, name) => was[lang].has(name) && !will[lang].has(name), languages)
}
