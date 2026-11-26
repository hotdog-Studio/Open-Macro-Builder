import { inflateSync } from 'node:zlib'
import type { Rgba } from '../src/core/icons/rgba'

/** Channels per pixel by PNG colour type: grey, RGB, palette, grey+alpha, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function predictor(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 1:
      return a
    case 2:
      return b
    case 3:
      return (a + b) >> 1
    case 4:
      return paeth(a, b, c)
    default:
      return 0
  }
}

/** Undoes the row filters of the inflated image data. */
function unfilter(raw: Uint8Array, rowBytes: number, rows: number, bpp: number): Uint8Array {
  const out = new Uint8Array(rowBytes * rows)
  for (let y = 0; y < rows; y++) {
    const filter = raw[y * (rowBytes + 1)]
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? out[y * rowBytes + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * rowBytes + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * rowBytes + x - bpp] : 0
      out[y * rowBytes + x] = (raw[y * (rowBytes + 1) + 1 + x] + predictor(filter, a, b, c)) & 255
    }
  }
  return out
}

function toRgba(px: Uint8Array, width: number, height: number, type: number, palette: Uint8Array | null): Rgba {
  const data = new Uint8ClampedArray(width * height * 4)
  const n = CHANNELS[type]
  for (let i = 0; i < width * height; i++) {
    const p = i * n
    const rgba = [px[p], px[p], px[p], 255]
    if (type === 2 || type === 6) rgba.splice(0, 4, px[p], px[p + 1], px[p + 2], type === 6 ? px[p + 3] : 255)
    if (type === 4) rgba[3] = px[p + 1]
    if (type === 3 && palette) rgba.splice(0, 3, palette[px[p] * 3], palette[px[p] * 3 + 1], palette[px[p] * 3 + 2])
    data.set(rgba, i * 4)
  }
  return { width, height, data }
}

/** A PNG file as RGBA: 8 bits per channel, not interlaced (what the repository's icons are). Tests only. */
export function decodePng(bytes: Uint8Array): Rgba {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let type = 0
  let palette: Uint8Array | null = null
  const idat: Uint8Array[] = []
  for (let p = 8; p < bytes.length; ) {
    const length = view.getUint32(p)
    const name = String.fromCodePoint(...bytes.subarray(p + 4, p + 8))
    const body = bytes.subarray(p + 8, p + 8 + length)
    if (name === 'IHDR') {
      width = view.getUint32(p + 8)
      height = view.getUint32(p + 12)
      type = bytes[p + 17]
      if (bytes[p + 16] !== 8 || bytes[p + 20] !== 0) throw new Error('decodePng: only 8-bit, not interlaced')
    }
    if (name === 'PLTE') palette = body
    if (name === 'IDAT') idat.push(body)
    p += 12 + length
  }
  const n = CHANNELS[type]
  const raw = inflateSync(Buffer.concat(idat))
  return toRgba(unfilter(raw, width * n, height, n), width, height, type, palette)
}
