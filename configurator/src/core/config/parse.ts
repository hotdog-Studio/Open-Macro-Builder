import type { Extra, KeyId, Layer, Macro, Options, PadKey, Workspace } from './model'

export class ConfigError extends Error {}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number'
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const isStringOrBoolean = (v: unknown): v is string | boolean => isString(v) || isBoolean(v)

/** Moves a field out of `rest` only when it has the wanted type; otherwise it stays an extra. */
function take<T>(rest: Obj, name: string, ok: (v: unknown) => v is T): T | undefined {
  const v = rest[name]
  if (!ok(v)) return undefined
  delete rest[name]
  return v
}

/** Required text fields: anything but a string reads as empty and is not kept. */
function takeText(rest: Obj, name: string): string {
  const v = rest[name]
  delete rest[name]
  return isString(v) ? v : ''
}

function parseKey(raw: Obj, id: KeyId): PadKey {
  const rest = { ...raw }
  const key: PadKey = { id, key: takeText(rest, 'key'), extra: rest }
  for (const f of ['row', 'col', 'width', 'height'] as const) {
    const v = take(rest, f, isNumber)
    if (v !== undefined) key[f] = v
  }
  return key
}

function parseMacro(raw: Obj): Macro {
  const rest = { ...raw }
  const macro: Macro = { action: takeText(rest, 'action'), name: takeText(rest, 'name'), extra: rest }
  const description = take(rest, 'description', isString)
  if (description !== undefined) macro.description = description
  const icon = take(rest, 'icon', isString)
  if (icon !== undefined) macro.icon = icon
  return macro
}

function parseLayer(raw: Obj, id: string, keys: PadKey[], notices: string[]): { layer: Layer; disabled: boolean } {
  const rest = { ...raw }
  const disabled = rest.disabled === true
  delete rest.disabled
  const title = takeText(rest, 'title')
  const icon = takeText(rest, 'icon')
  const list: unknown[] = Array.isArray(rest.macros) ? rest.macros : []
  delete rest.macros
  const macros: Record<KeyId, Macro> = {}
  list.slice(0, keys.length).forEach((m, j) => {
    if (isObj(m)) macros[keys[j].id] = parseMacro(m)
  })
  const overflowMacros = list.slice(keys.length)
  if (overflowMacros.length > 0) {
    notices.push(`Layer "${title}" has more macros than keys; the extra ones are kept as they are.`)
  }
  return { layer: { id, title, icon, macros, overflowMacros, extra: rest }, disabled }
}

export function parseConfig(text: string, fileName: string): Workspace {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ConfigError(`${fileName} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isObj(data)) throw new ConfigError(`${fileName} must hold a JSON object.`)
  const { fn: rawFn, keys: rawKeys, layers: rawLayers, ...others } = data
  if (!isObj(rawFn)) throw new ConfigError(`${fileName} has no "fn" object.`)
  if (!Array.isArray(rawKeys)) throw new ConfigError(`${fileName} has no "keys" list.`)

  const rest: Obj = others
  const notices: string[] = []
  const fn = parseKey(rawFn, 'fn')
  const keys = rawKeys.map((k: unknown, i) => {
    if (!isObj(k)) throw new ConfigError(`${fileName}: key ${i + 1} in "keys" is not an object.`)
    return parseKey(k, `k${i + 1}`)
  })

  const slots: Record<KeyId, Layer> = {}
  const parked: Layer[] = []
  const layerList: unknown[] = Array.isArray(rawLayers) ? rawLayers : []
  let counter = 0
  let layerNo = 0
  for (const entry of layerList) {
    if (!isObj(entry)) {
      counter++
      continue
    }
    const { layer, disabled } = parseLayer(entry, `L${++layerNo}`, keys, notices)
    if (disabled) {
      parked.push(layer)
    } else if (counter < keys.length) {
      slots[keys[counter].id] = layer
      counter++
    } else {
      parked.push(layer)
      notices.push(`Layer "${layer.title}" had no key, so it was parked.`)
    }
  }

  const options: Options = { defaultKey: null, hasDefault: 'default' in rest }
  if (options.hasDefault) {
    const n = rest.default
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= keys.length) {
      options.defaultKey = keys[n - 1].id
    } else {
      options.defaultRaw = n
    }
    delete rest.default
  }
  const showFn = take(rest, 'showFn', isStringOrBoolean)
  if (showFn !== undefined) options.showFn = showFn
  for (const f of ['showMacroMarkers', 'showLabels', 'useMacroIcons'] as const) {
    const v = take(rest, f, isBoolean)
    if (v !== undefined) options[f] = v
  }
  const iconAction = take(rest, 'iconAction', isString)
  if (iconAction !== undefined) options.iconAction = iconAction

  const ws: Workspace = { fn, keys, slots, parked, options, extra: rest as Extra, notices }
  if ('hotkeys' in rest) {
    ws.hotkeys = rest.hotkeys
    delete rest.hotkeys
  }
  if ('hotstrings' in rest) {
    ws.hotstrings = rest.hotstrings
    delete rest.hotstrings
  }
  return ws
}
