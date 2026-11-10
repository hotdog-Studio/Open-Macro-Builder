export type KeyId = string // 'fn' for the Fn key, 'k1', 'k2', … for macro keys
export type Extra = Record<string, unknown> // unknown fields, kept in source order

export interface PadKey {
  id: KeyId
  key: string
  row?: number
  col?: number
  width?: number
  height?: number
  extra: Extra
}

export interface Macro {
  action: string
  name: string
  description?: string
  icon?: string
  extra: Extra
}

export interface Layer {
  id: string
  title: string
  icon: string
  macros: Record<KeyId, Macro>
  overflowMacros: unknown[]
  extra: Extra
}

export interface Options {
  defaultKey: KeyId | null
  defaultRaw?: unknown // only when "default" is present but out of range
  hasDefault: boolean // "default" was present
  showFn?: boolean | string
  showMacroMarkers?: boolean
  showLabels?: boolean
  useMacroIcons?: boolean
  iconAction?: string
}

export interface Workspace {
  fn: PadKey
  keys: PadKey[]
  slots: Record<KeyId, Layer>
  parked: Layer[]
  options: Options
  hotkeys?: unknown
  hotstrings?: unknown
  extra: Extra
  notices: string[]
}

export const size = (k: PadKey) => ({ w: k.width ?? 1, h: k.height ?? 1, row: k.row ?? 1, col: k.col ?? 1 })
