import type { Colour } from './frames'

/** How the picture sits in the key: Fit (contain), Fill (cover) or Stretch. */
export type Fit = 'contain' | 'cover' | 'stretch'

export const FITS: readonly Fit[] = ['contain', 'cover', 'stretch']

/** What `icon.json` saves, so the set can be drawn again for another size or colour. */
export interface IconRecipe {
  fit: Fit
  /** Pixels of space between the picture and the edge of the key. */
  padding: number
  /** The fill of the selected states, `#rrggbb`. */
  background: string
  /** The line of the macro states, `#rrggbb`. */
  outline: string
  /** Key sizes as `<w>x<h>`, in the order of the layout's use, then the others. */
  sizes: string[]
}

export const DEFAULT_BACKGROUND = '#8e8cd8'
export const DEFAULT_OUTLINE = '#000000'

export const DEFAULT_RECIPE: IconRecipe = {
  fit: 'contain',
  padding: 8,
  background: DEFAULT_BACKGROUND,
  outline: DEFAULT_OUTLINE,
  sizes: ['1x1'],
}

const MAX_UNITS = 8
const MAX_PADDING = 200

/** The key size `<w>x<h>` as units, or null when it is not a size of 1 to 8 units either way. */
export function parseSize(text: string): { w: number; h: number } | null {
  const m = /^(\d{1,2})x(\d{1,2})$/.exec(text)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return w >= 1 && h >= 1 && w <= MAX_UNITS && h <= MAX_UNITS ? { w, h } : null
}

export function sizeName(w: number, h: number): string {
  return `${w}x${h}`
}

/** The sizes in order of width, then height, without repeats or anything that is not a size. */
export function normalizeSizes(sizes: readonly string[]): string[] {
  const seen = new Set<string>()
  const parsed: { w: number; h: number }[] = []
  for (const s of sizes) {
    const size = parseSize(s)
    if (!size || seen.has(sizeName(size.w, size.h))) continue
    seen.add(sizeName(size.w, size.h))
    parsed.push(size)
  }
  return parsed.sort((a, b) => a.h * 100 + a.w - (b.h * 100 + b.w)).map((s) => sizeName(s.w, s.h))
}

/** `#rrggbb` (any case) as a colour, or null. */
export function parseColour(text: string): Colour | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text)
  return m ? [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)] : null
}

function colourOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && parseColour(value) ? value.toLowerCase() : fallback
}

function fitOr(value: unknown): Fit {
  return FITS.find((f) => f === value) ?? DEFAULT_RECIPE.fit
}

function paddingOr(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECIPE.padding
  return Math.min(MAX_PADDING, Math.max(0, Math.round(value)))
}

function sizesOr(value: unknown): string[] {
  const list = Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : []
  const sizes = normalizeSizes(list)
  return sizes.length > 0 ? sizes : [...DEFAULT_RECIPE.sizes]
}

/** The recipe in the text of an `icon.json`; a field that is missing or wrong is the default. Null when it is not a JSON object. */
export function parseRecipe(text: string): IconRecipe | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  return {
    fit: fitOr(o.fit),
    padding: paddingOr(o.padding),
    background: colourOr(o.background, DEFAULT_BACKGROUND),
    outline: colourOr(o.outline, DEFAULT_OUTLINE),
    sizes: sizesOr(o.sizes),
  }
}

/** The text of `icon.json`. */
export function writeRecipe(recipe: IconRecipe): string {
  const { fit, padding, background, outline, sizes } = recipe
  return `${JSON.stringify({ fit, padding, background, outline, sizes }, null, 2)}\n`
}

/** The file of a picture of a set for a key of w×h units: `layer.png` at 1x1, `layer_1x2.png` at other sizes. */
export function stateFile(state: string, w: number, h: number): string {
  return w === 1 && h === 1 ? `${state}.png` : `${state}_${sizeName(w, h)}.png`
}

/** Why a folder cannot be the name of an icon set, or null when it can. */
export function iconSetNameError(name: string): string | null {
  if (name === '') return 'Give the set a name.'
  if (!/^[a-z0-9_]+$/.test(name)) return 'Use only a to z (lower case), 0 to 9 and _.'
  if (name === 'template') return '"template" is where the frames are kept.'
  return null
}
