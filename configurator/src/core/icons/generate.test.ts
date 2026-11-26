import { describe, expect, it } from 'vitest'
import { decodePng } from '../../../test/png'
import { readRepoBytes } from '../../../test/repo'
import { TEMPLATE_FILL, drawFrame, pixelSize, recolourTemplate, type FrameState } from './frames'
import { emptyFrameFile, frameFor, placePicture, renderEmptyFrame, renderSet, renderSize } from './generate'
import { DEFAULT_RECIPE } from './recipe'
import { blank, over, resize, type Rgba } from './rgba'

const png = (path: string): Rgba => decodePng(readRepoBytes(path))

const SIZES: [number, number, string][] = [
  [1, 1, ''],
  [1, 2, '_1x2'],
  [2, 1, '_2x1'],
  [2, 2, '_2x2'],
]
const STATES: FrameState[] = ['macro', 'selected', 'selected_macro']
const BLACK = [0, 0, 0] as const

/** The pixels that differ, counting a pixel once; two transparent pixels never differ. */
function differing(a: Rgba, b: Rgba, tolerance = 0): number {
  expect([a.width, a.height]).toEqual([b.width, b.height])
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] === 0 && b.data[i + 3] === 0) continue
    const worst = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(a.data[i + c] - b.data[i + c])))
    if (worst > tolerance) n++
  }
  return n
}

/**
 * Over the fill, a pixel where the layer is opaque or transparent is the same in the shipped picture. Where the layer is
 * semi-transparent (the edge of the drawing) the shipped colour is a little off from a plain composite, by up to 60 of
 * 255 in the shipped sets; the alpha is the frame's.
 */
function expectSameBesidesEdges(composed: Rgba, shipped: Rgba, layer: Rgba, label: string): void {
  let solid = 0
  let edgeWorst = 0
  for (let i = 0; i < composed.data.length; i += 4) {
    const worst = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(composed.data[i + c] - shipped.data[i + c])))
    const alpha = layer.data[i + 3]
    if (alpha === 0 || alpha === 255) solid += worst > 1 ? 1 : 0
    else edgeWorst = Math.max(edgeWorst, worst)
  }
  expect(solid, `${label}: pixels away from the edge`).toBe(0)
  expect(edgeWorst, `${label}: edge pixels`).toBeLessThanOrEqual(64)
}

describe('frames drawn in code', () => {
  it.each(SIZES)('match the shipped templates at %ix%i', (w, h, suffix) => {
    const { width, height } = pixelSize(w, h)
    for (const state of STATES) {
      const template = png(`img/template/${state}${suffix}.png`)
      const drawn = drawFrame(state, width, height, TEMPLATE_FILL, BLACK)
      expect(differing(drawn, template), `${state}${suffix}`).toBe(0)
    }
  })

  it('has the labelled pixel sizes', () => {
    expect(pixelSize(1, 1)).toEqual({ width: 64, height: 64 })
    expect(pixelSize(1, 2)).toEqual({ width: 64, height: 145 })
    expect(pixelSize(2, 2)).toEqual({ width: 128, height: 145 })
    expect(pixelSize(3, 3)).toEqual({ width: 192, height: 226 })
  })

  it('draws a size without a template with the same corners and edges', () => {
    const frame = drawFrame('selected_macro', 192, 226, TEMPLATE_FILL, [255, 0, 0])
    const px = (x: number, y: number) => [...frame.data.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)]
    expect(px(0, 0)).toEqual([0, 0, 0, 0])
    expect(px(60, 2)).toEqual([255, 0, 0, 255]) // the first line pixel along the top
    expect(px(60, 3)).toEqual([255, 0, 0, 255]) // and the second
    expect(px(60, 4)).toEqual([0x8e, 0x8c, 0xd8, 255])
    expect(px(96, 113)).toEqual([0x8e, 0x8c, 0xd8, 255])
  })

  it('recolours the fill and the line of a template and leaves other pixels', () => {
    const t = blank(3, 1)
    t.data.set([0x8e, 0x8c, 0xd8, 255, 0, 0, 0, 255, 10, 20, 30, 255])
    const out = recolourTemplate(t, [1, 2, 3], [4, 5, 6])
    expect([...out.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 10, 20, 30, 255])
    expect([...t.data.subarray(0, 3)]).toEqual([0x8e, 0x8c, 0xd8])
  })

  it('uses a template of the right size and draws when it has another', () => {
    const wrong = blank(10, 10)
    const frame = frameFor('macro', 1, 1, TEMPLATE_FILL, BLACK, () => wrong)
    expect(frame.width).toBe(64)
    const mine = blank(64, 64)
    mine.data.set([0x8e, 0x8c, 0xd8, 255])
    const used = frameFor('macro', 1, 1, [9, 9, 9], BLACK, () => mine)
    expect([...used.data.subarray(0, 4)]).toEqual([9, 9, 9, 255])
  })
})

describe('composing a set from its layer.png', () => {
  // The six sets whose variants are plain composites of layer.png over the template (the rest were drawn by hand).
  it.each(['chrome', 'programs', 'vs_code', 'godot', 'putty', 'windows'])('reproduces the shipped pictures of %s', (set) => {
    const layer = png(`img/${set}/layer.png`)
    const suffix = layer.height === 145 ? '_1x2' : ''
    for (const state of STATES) {
      const composed = over(png(`img/template/${state}${suffix}.png`), layer)
      const shipped = png(`img/${set}/${state}.png`)
      if (state === 'macro') expect(differing(composed, shipped), `${set} ${state}`).toBe(0)
      else expectSameBesidesEdges(composed, shipped, layer, `${set} ${state}`)
    }
  })

  it('draws the same from the code-drawn frames as from the templates', () => {
    const layer = png('img/chrome/layer.png')
    const out = renderSize(layer, { ...DEFAULT_RECIPE, padding: 0 }, 1, 1)
    expect(differing(out.get('layer.png') as Rgba, layer, 2)).toBeLessThanOrEqual(10)
    expect(differing(out.get('macro.png') as Rgba, png('img/chrome/macro.png'), 2)).toBeLessThanOrEqual(10)
  })
})

describe('placing a picture', () => {
  const wide = (): Rgba => {
    const p = blank(40, 20)
    p.data.fill(255)
    return p
  }
  const bounds = (img: Rgba) => {
    let x0 = img.width
    let y0 = img.height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (img.data[(y * img.width + x) * 4 + 3] === 0) continue
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
    return [x0, y0, x1, y1]
  }

  it('fits inside the padding, centred', () => {
    expect(bounds(placePicture(wide(), 64, 64, 'contain', 8))).toEqual([8, 20, 55, 43])
  })

  it('covers the padded box and cuts what lies outside it', () => {
    expect(bounds(placePicture(wide(), 64, 64, 'cover', 8))).toEqual([8, 8, 55, 55])
  })

  it('stretches to the padded box', () => {
    expect(bounds(placePicture(wide(), 64, 145, 'stretch', 4))).toEqual([4, 4, 59, 140])
  })

  it('keeps a picture the size of the key as it is with no padding', () => {
    const p = blank(64, 64)
    p.data.set([1, 2, 3, 255], 4 * 100)
    expect(placePicture(p, 64, 64, 'contain', 0).data).toEqual(p.data)
  })

  it('does not let the padding eat the whole key', () => {
    expect(bounds(placePicture(wide(), 64, 64, 'contain', 500)).every((n) => n >= 0)).toBe(true)
  })
})

describe('resize', () => {
  it('averages when it shrinks and keeps a flat colour flat', () => {
    const p = blank(8, 8)
    for (let i = 0; i < 64; i++) p.data.set([200, 100, 50, 255], i * 4)
    const out = resize(p, 3, 3)
    expect([...out.data.subarray(0, 4)]).toEqual([200, 100, 50, 255])
  })

  it('does not bleed the colour of transparent pixels into the edge', () => {
    const p = blank(2, 1)
    p.data.set([255, 0, 0, 255, 0, 255, 0, 0])
    const out = resize(p, 4, 1)
    expect([...out.data.subarray(0, 3)]).toEqual([255, 0, 0])
  })

  it('returns a copy at the same size', () => {
    const p = blank(2, 2)
    const out = resize(p, 2, 2)
    out.data[0] = 9
    expect(p.data[0]).toBe(0)
  })
})

describe('a whole set', () => {
  it('has the four pictures at 1x1 and four more per other size', () => {
    const picture = blank(10, 10)
    picture.data.fill(255)
    const files = renderSet(picture, { ...DEFAULT_RECIPE, sizes: ['1x2', '2x1'] })
    expect([...files.keys()]).toEqual([
      'layer.png',
      'macro.png',
      'selected.png',
      'selected_macro.png',
      'layer_1x2.png',
      'macro_1x2.png',
      'selected_1x2.png',
      'selected_macro_1x2.png',
      'layer_2x1.png',
      'macro_2x1.png',
      'selected_2x1.png',
      'selected_macro_2x1.png',
    ])
    expect(files.get('selected_1x2.png')).toMatchObject({ width: 64, height: 145 })
  })

  it('uses the chosen colours', () => {
    const picture = blank(4, 4)
    const files = renderSet(picture, { ...DEFAULT_RECIPE, background: '#ff0000', outline: '#00ff00' })
    const at = (name: string, x: number, y: number) => [...(files.get(name) as Rgba).data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]
    expect(at('selected.png', 32, 32)).toEqual([255, 0, 0, 255])
    expect(at('macro.png', 32, 2)).toEqual([0, 255, 0, 255])
  })

  it('draws an empty key frame as the outline frame, as the shipped ones are', () => {
    for (const [w, h] of SIZES) {
      const shipped = png(`img/empty_${w}x${h}.png`)
      expect(differing(renderEmptyFrame(w, h, '#000000'), shipped)).toBe(0)
      expect(emptyFrameFile(w, h)).toBe(`empty_${w}x${h}.png`)
    }
  })
})
