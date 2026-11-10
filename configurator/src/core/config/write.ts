import type { Extra, Layer, Macro, PadKey, Workspace } from './model'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `{ "a": 1, "b": "x" }`: one line, values from JSON.stringify; unset (undefined) values are left out. */
function inline(fields: Array<[string, unknown]>): string {
  const parts = fields
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`
}

/** A raw value from the file as one line; objects use the `{ "a": 1 }` style. */
const inlineValue = (v: unknown): string => (isObj(v) ? inline(Object.entries(v)) : JSON.stringify(v))

/** A value of any shape, spread over lines with 2-space indents, to sit at `indent` spaces. */
const pretty = (v: unknown, indent: number): string => JSON.stringify(v, null, 2).replaceAll('\n', '\n' + ' '.repeat(indent))

/** The typed fields, then the extras whose names the typed fields have not already written. */
function withExtra(typed: Array<[string, unknown]>, extra: Extra): Array<[string, unknown]> {
  const written = new Set(typed.filter(([, v]) => v !== undefined).map(([k]) => k))
  return [...typed, ...Object.entries(extra).filter(([k]) => !written.has(k))]
}

function keyText(k: PadKey): string {
  return inline(
    withExtra(
      [
        ['key', k.key],
        ['row', k.row],
        ['col', k.col],
        ['width', k.width],
        ['height', k.height],
      ],
      k.extra,
    ),
  )
}

function macroText(m: Macro): string {
  return inline(
    withExtra(
      [
        ['action', m.action],
        ['name', m.name],
        ['description', m.description],
        ['icon', m.icon],
      ],
      m.extra,
    ),
  )
}

/** The lines of a list, one entry per line at `indent` spaces; `[]` when there are none. */
function list(entries: string[], indent: number): string {
  if (entries.length === 0) return '[]'
  const pad = ' '.repeat(indent + 2)
  return `[\n${entries.map((e) => pad + e).join(',\n')}\n${' '.repeat(indent)}]`
}

/** Extras as `"name": value` lines, leaving out the names in `written`. */
function extraFields(extra: Extra, indent: number, written: string[] = []): string[] {
  return Object.entries(extra)
    .filter(([k, v]) => v !== undefined && !written.includes(k))
    .map(([k, v]) => `${JSON.stringify(k)}: ${pretty(v, indent)}`)
}

function layerText(ws: Workspace, layer: Layer, parked: boolean): string {
  let entries = ws.keys.map((k) => (layer.macros[k.id] ? macroText(layer.macros[k.id]) : 'null'))
  if (layer.overflowMacros.length > 0) {
    entries = [...entries, ...layer.overflowMacros.map(inlineValue)]
  } else {
    while (entries.length > 0 && entries.at(-1) === 'null') entries.pop()
  }
  const fields = [`"title": ${JSON.stringify(layer.title)}`, `"icon": ${JSON.stringify(layer.icon)}`]
  const written = ['title', 'icon', 'macros']
  if (parked) {
    fields.push('"disabled": true')
    written.push('disabled')
  }
  fields.push(`"macros": ${list(entries, 6)}`, ...extraFields(layer.extra, 6, written))
  return `{\n${fields.map((f) => '      ' + f).join(',\n')}\n    }`
}

function defaultNumber(ws: Workspace): unknown {
  const { defaultKey, defaultRaw } = ws.options
  if (defaultKey !== null) {
    const i = ws.keys.findIndex((k) => k.id === defaultKey)
    if (i >= 0) return i + 1
  }
  return defaultRaw
}

export function writeConfig(ws: Workspace): string {
  const o = ws.options
  const layers = [
    ...ws.keys.map((k) => (ws.slots[k.id] ? layerText(ws, ws.slots[k.id], false) : 'null')),
    ...ws.parked.map((l) => layerText(ws, l, true)),
  ]
  const start = defaultNumber(ws)
  const rawList = (v: unknown) => (Array.isArray(v) ? list(v.map(inlineValue), 2) : pretty(v, 2))

  const fields: Array<[string, string | undefined]> = [
    ['fn', keyText(ws.fn)],
    ['keys', list(ws.keys.map(keyText), 2)],
    ['layers', list(layers, 2)],
    ['default', start === undefined ? undefined : pretty(start, 2)],
    ['showFn', o.showFn === undefined ? undefined : JSON.stringify(o.showFn)],
    ['showMacroMarkers', o.showMacroMarkers === undefined ? undefined : JSON.stringify(o.showMacroMarkers)],
    ['showLabels', o.showLabels === undefined ? undefined : JSON.stringify(o.showLabels)],
    ['useMacroIcons', o.useMacroIcons === undefined ? undefined : JSON.stringify(o.useMacroIcons)],
    ['iconAction', o.iconAction === undefined ? undefined : JSON.stringify(o.iconAction)],
    ['hotkeys', ws.hotkeys === undefined ? undefined : rawList(ws.hotkeys)],
    ['hotstrings', ws.hotstrings === undefined ? undefined : rawList(ws.hotstrings)],
  ]
  const present = fields.filter((f): f is [string, string] => f[1] !== undefined)
  const lines = present
    .map(([k, v]) => `${JSON.stringify(k)}: ${v}`)
    .concat(extraFields(ws.extra, 2, present.map(([k]) => k)))
  return `{\n${lines.map((l) => '  ' + l).join(',\n')}\n}\n`
}
