import { describe, expect, it } from 'vitest'
import { renderSet } from '../core/icons/generate'
import { DEFAULT_RECIPE } from '../core/icons/recipe'
import type { Rgba } from '../core/icons/rgba'
import { decodePicture, decodePng, encodePng } from './iconCodec'

// The Icons tab's one boundary with the canvas, in a real browser: jsdom has no canvas, so the
// unit tests stand in for it. The preview and the written files both go through these functions.

/** 4×2: opaque red, green, blue, white; then transparent, opaque black, and two half-transparent. */
function sample(): Rgba {
  const px = [
    [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255],
    [0, 0, 0, 0], [0, 0, 0, 255], [200, 100, 50, 128], [10, 20, 30, 64],
  ]
  return { width: 4, height: 2, data: new Uint8ClampedArray(px.flat()) }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('iconCodec in a browser', () => {
  it('writes a PNG and reads it back: opaque and transparent pixels exactly, half-transparent within rounding', async () => {
    const bytes = await encodePng(sample())
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE)
    const back = await decodePng(bytes)
    expect([back.width, back.height]).toEqual([4, 2])
    const want = sample().data
    for (let i = 0; i < 24; i++) expect(back.data[i], `byte ${i}`).toBe(want[i])
    for (let i = 24; i < 32; i++) expect(Math.abs(back.data[i] - want[i]), `byte ${i}`).toBeLessThanOrEqual(3)
  })

  it('reads an SVG that has only a viewBox at 512 px on its longer side', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#00ff00"/></svg>'
    const image = await decodePicture(new Blob([svg], { type: 'image/svg+xml' }))
    expect(image.width).toBe(512)
    expect(image.height).toBeGreaterThanOrEqual(256)
    const centre = 4 * (Math.floor(image.height / 2) * image.width + 256)
    expect([...image.data.slice(centre, centre + 4)]).toEqual([0, 255, 0, 255])
  })

  it('reads a JPG', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 30
    canvas.height = 20
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 30, 20)
    const jpg = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/jpeg'))
    const image = await decodePicture(jpg)
    expect([image.width, image.height]).toEqual([30, 20])
    expect(image.data[0]).toBeGreaterThan(240)
    expect(image.data[3]).toBe(255)
  })

  it('refuses what is not a picture', async () => {
    await expect(decodePicture(new Blob(['not a picture'], { type: 'image/png' }))).rejects.toThrow(
      'The browser could not read this picture.',
    )
  })

  it('makes every picture of a set as a PNG of the size the runtimes stretch to', async () => {
    const files = renderSet(sample(), { ...DEFAULT_RECIPE, sizes: ['1x1', '1x2'] })
    expect([...files.keys()].sort()).toContain('selected_macro_1x2.png')
    for (const [name, image] of files) {
      const back = await decodePng(await encodePng(image))
      expect([back.width, back.height], name).toEqual(name.includes('_1x2') ? [64, 145] : [64, 64])
    }
  })
})
