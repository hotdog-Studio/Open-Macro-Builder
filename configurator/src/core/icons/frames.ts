import { FRAME_TILES, type FrameTile } from './frameTiles'
import { blank, type Rgba } from './rgba'

/** The pictures of an icon set that have a frame: the layer itself has none. */
export type FrameState = 'macro' | 'selected' | 'selected_macro'

/** An RGB colour. */
export type Colour = readonly [number, number, number]

/** Pixels of a key of w×h units: 64 per unit across, and 64 per unit plus a 17 px label strip between rows down. */
export function pixelSize(w: number, h: number): { width: number; height: number } {
  return { width: 64 * w, height: 64 * h + 17 * (h - 1) }
}

const CORNER = 16

/** Which row or column of a 33-wide tile stands for position `p` along a side `length` long. */
function tileIndex(p: number, length: number): number {
  if (p < CORNER) return p
  if (p >= length - CORNER) return CORNER + 1 + (p - (length - CORNER))
  return CORNER
}

/** The character of the tile at pixel (x, y) of a frame width × height: `.` transparent, `f` fill, `l` line. */
function tileChar(tile: FrameTile, x: number, y: number, width: number, height: number): string {
  // The corners of a key wider than one unit are not those of a 1x1 key, as drawn in the templates.
  const rows = width > 64 ? tile.wide : tile.narrow
  return rows[tileIndex(y, height)][tileIndex(x, width)]
}

/** A frame drawn in code at any size, with the same inset, corners and line widths as the templates. */
export function drawFrame(state: FrameState, width: number, height: number, fill: Colour, line: Colour): Rgba {
  const out = blank(width, height)
  const tile = FRAME_TILES[state]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = tileChar(tile, x, y, width, height)
      if (c === '.') continue
      const colour = c === 'f' ? fill : line
      out.data.set([colour[0], colour[1], colour[2], 255], (y * width + x) * 4)
    }
  }
  return out
}

/** The fill colour of the shipped templates. */
export const TEMPLATE_FILL: Colour = [0x8e, 0x8c, 0xd8]

const BLACK: Colour = [0, 0, 0]

/** What a template pixel is recoloured to: the fill for `#8e8cd8`, the line for black, else nothing. */
function recoloured(data: Uint8ClampedArray, i: number, fill: Colour, line: Colour): Colour | null {
  if (data[i + 3] !== 255) return null
  const is = (c: Colour) => data[i] === c[0] && data[i + 1] === c[1] && data[i + 2] === c[2]
  if (is(TEMPLATE_FILL)) return fill
  return is(BLACK) ? line : null
}

/** A template with its `#8e8cd8` made `fill` and its black made `line`; any other pixel stays. */
export function recolourTemplate(template: Rgba, fill: Colour, line: Colour): Rgba {
  const out: Rgba = { width: template.width, height: template.height, data: template.data.slice() }
  for (let i = 0; i < out.data.length; i += 4) {
    const to = recoloured(out.data, i, fill, line)
    if (to) out.data.set(to, i)
  }
  return out
}
