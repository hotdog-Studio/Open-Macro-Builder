#!/usr/bin/env node
// Rebuilds the icons from their SVG sources. Run after editing img/icon.svg or img/logo.svg:
//
//   cd configurator && node scripts/make-icon.mjs
//
// Writes:
//   img/icon.ico   the tray icon of both macropad versions (ahk/main.ahk, powershell/main.ps1) and
//                  the icon of the desktop app and its installer (electron-builder.yml)
//   img/logo.png   the logo at 512 px, for places that cannot show an SVG
//
// Draws with the Chromium that Playwright installs for the browser tests
// (`npx playwright install chromium`), so there is nothing else to install.
/* global Image, document -- used inside page.evaluate, which runs in the browser */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const img = resolve(dirname(fileURLToPath(import.meta.url)), '../../img')

/** The sizes Windows asks an icon for, from the tray (16) to the large-icon view (256). */
const SIZES = [16, 24, 32, 48, 64, 72, 96, 128, 256]

/** One icon image as Windows' own bitmap format: header, pixels bottom row first as BGRA, then a 1-bit mask. */
function bitmapEntry(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  // Twice the height: the pixels and the mask count as one tall image.
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)

  const pixels = Buffer.alloc(size * size * 4)
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size)
  for (let y = 0; y < size; y++) {
    const out = size - 1 - y
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = (out * size + x) * 4
      pixels[to] = rgba[from + 2]
      pixels[to + 1] = rgba[from + 1]
      pixels[to + 2] = rgba[from]
      pixels[to + 3] = rgba[from + 3]
      // A set mask bit means "see through", for anything that ignores the alpha channel.
      if (rgba[from + 3] === 0) mask[out * maskRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, pixels, mask])
}

/** An .ico file from its images. `size` 256 is written as 0, as the format has it. */
function icoFile(entries) {
  const dir = Buffer.alloc(6 + entries.length * 16)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(entries.length, 4)
  let offset = dir.length
  entries.forEach(({ size, data }, i) => {
    const at = 6 + i * 16
    dir[at] = size === 256 ? 0 : size
    dir[at + 1] = size === 256 ? 0 : size
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([dir, ...entries.map((e) => e.data)])
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()

  /** The SVG drawn at a size: its pixels as RGBA, and the same picture as a PNG file. */
  async function draw(svg, size) {
    return page.evaluate(
      async ({ svg, size }) => {
        const image = new Image()
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(image, 0, 0, size, size)
        return {
          rgba: Array.from(ctx.getImageData(0, 0, size, size).data),
          png: canvas.toDataURL('image/png').split(',')[1],
        }
      },
      { svg, size },
    )
  }

  const icon = readFileSync(resolve(img, 'icon.svg'), 'utf8')
  const entries = []
  for (const size of SIZES) {
    const { rgba, png } = await draw(icon, size)
    // The largest is kept as a PNG, as Windows itself writes icons; the rest as plain bitmaps,
    // which every reader of .ico files understands.
    entries.push({ size, data: size === 256 ? Buffer.from(png, 'base64') : bitmapEntry(size, rgba) })
  }
  writeFileSync(resolve(img, 'icon.ico'), icoFile(entries))

  const logo = await draw(readFileSync(resolve(img, 'logo.svg'), 'utf8'), 512)
  writeFileSync(resolve(img, 'logo.png'), Buffer.from(logo.png, 'base64'))
  console.log(`Wrote img/icon.ico (${SIZES.join(', ')} px) and img/logo.png (512 px).`)
} finally {
  await browser.close()
}
