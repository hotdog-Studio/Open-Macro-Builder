/** A picture as plain 8-bit RGBA, not premultiplied: what the canvas gives and takes. */
export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** A fully transparent picture. */
export function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/** The part of a picture inside a rectangle that lies within it. */
export function crop(src: Rgba, x: number, y: number, width: number, height: number): Rgba {
  const out = blank(width, height)
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * src.width + x) * 4
    out.data.set(src.data.subarray(from, from + width * 4), row * width * 4)
  }
  return out
}

/** One pixel of `top` over one of `base` (source-over), written to `out` at `at`. */
function blendPixel(base: Uint8ClampedArray, top: Uint8ClampedArray, from: number, at: number, out: Uint8ClampedArray): void {
  const ta = top[from + 3] / 255
  const ba = base[at + 3] / 255
  const alpha = ta + ba * (1 - ta)
  if (alpha === 0) return
  for (let c = 0; c < 3; c++) {
    out[at + c] = (top[from + c] * ta + base[at + c] * ba * (1 - ta)) / alpha
  }
  out[at + 3] = alpha * 255
}

/** `top` drawn over `base` with its top-left corner at (dx, dy), clipped to `base`; a new picture. */
export function over(base: Rgba, top: Rgba, dx = 0, dy = 0): Rgba {
  const out: Rgba = { width: base.width, height: base.height, data: base.data.slice() }
  for (let y = Math.max(0, -dy); y < top.height && y + dy < base.height; y++) {
    for (let x = Math.max(0, -dx); x < top.width && x + dx < base.width; x++) {
      blendPixel(base.data, top.data, (y * top.width + x) * 4, ((y + dy) * base.width + x + dx) * 4, out.data)
    }
  }
  return out
}

/** A source pixel an output pixel is made of, with its weight. */
interface Tap {
  index: number
  weight: number
}

/** Enlarging blends the two nearest source pixels. */
function blendTaps(out: number, srcLen: number, scale: number): Tap[] {
  const centre = (out + 0.5) * scale - 0.5
  const i0 = Math.floor(centre)
  const t = centre - i0
  const clamp = (i: number) => Math.min(srcLen - 1, Math.max(0, i))
  return [
    { index: clamp(i0), weight: 1 - t },
    { index: clamp(i0 + 1), weight: t },
  ]
}

/** Shrinking averages the source pixels the output pixel covers, the edge ones by how much they are covered. */
function areaTaps(out: number, srcLen: number, scale: number): Tap[] {
  const start = out * scale
  const end = start + scale
  const result: Tap[] = []
  for (let i = Math.floor(start); i < Math.min(srcLen, Math.ceil(end)); i++) {
    result.push({ index: i, weight: (Math.min(i + 1, end) - Math.max(i, start)) / scale })
  }
  return result
}

function taps(out: number, srcLen: number, dstLen: number): Tap[] {
  const scale = srcLen / dstLen
  return scale <= 1 ? blendTaps(out, srcLen, scale) : areaTaps(out, srcLen, scale)
}

/** One pass of the resize along x (when `horizontal`) or y, on premultiplied floats with 4 channels. */
function pass(src: Float32Array, w: number, h: number, size: number, horizontal: boolean): Float32Array {
  const outW = horizontal ? size : w
  const outH = horizontal ? h : size
  const out = new Float32Array(outW * outH * 4)
  const tapsOf = Array.from({ length: size }, (_, i) => taps(i, horizontal ? w : h, size))
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // The source pixels on the line through (x, y): along the row when horizontal, else down the column.
      const from = horizontal ? (index: number) => y * w + index : (index: number) => index * w + x
      accumulate(out, (y * outW + x) * 4, src, tapsOf[horizontal ? x : y], from)
    }
  }
  return out
}

/** Adds the weighted source pixels of `list` into the output pixel at `at`. */
function accumulate(out: Float32Array, at: number, src: Float32Array, list: readonly Tap[], from: (index: number) => number): void {
  for (const t of list) {
    const base = from(t.index) * 4
    for (let c = 0; c < 4; c++) out[at + c] += src[base + c] * t.weight
  }
}

function premultiplied(src: Rgba): Float32Array {
  const out = new Float32Array(src.data.length)
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3] / 255
    out[i] = src.data[i] * a
    out[i + 1] = src.data[i + 1] * a
    out[i + 2] = src.data[i + 2] * a
    out[i + 3] = src.data[i + 3]
  }
  return out
}

function unpremultiplied(src: Float32Array, width: number, height: number): Rgba {
  const out = blank(width, height)
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255
    for (let c = 0; c < 3; c++) out.data[i + c] = a === 0 ? 0 : src[i + c] / a
    out.data[i + 3] = src[i + 3]
  }
  return out
}

/** A picture scaled to another size: area average when shrinking, bilinear when enlarging. */
export function resize(src: Rgba, width: number, height: number): Rgba {
  if (src.width === width && src.height === height) return { ...src, data: src.data.slice() }
  const wide = pass(premultiplied(src), src.width, src.height, width, true)
  const tall = pass(wide, width, src.height, height, false)
  return unpremultiplied(tall, width, height)
}
