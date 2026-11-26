import { describe, expect, it } from 'vitest'
import { MemoryFolder } from './folder/memory'
import { emptyImage, iconImage, iconSetNames, scanIcons, STOCK_ICONS } from './iconIndex'

const folder = () =>
  new MemoryFolder('r', {
    'img/chrome/layer.png': 'x',
    'img/chrome/selected_1x2.png': 'x',
    'img/media/layer.png': 'x',
    'img/template/layer.png': 'x',
    'img/nolayer/macro.png': 'x',
    'img/empty.png': 'x',
    'img/empty_1x1.png': 'x',
    'img/empty_3x1.png': 'x',
    'local/img/media/layer.png': 'x',
    'local/img/media/macro_2x1.png': 'x',
    'local/img/mine/layer.png': 'x',
    'local/img/halfdone/macro.png': 'x',
  })

describe('scanIcons', () => {
  it('lists sets with a layer.png in img and local/img, the personal one first, without the template', async () => {
    const icons = await scanIcons(folder())
    expect(iconSetNames(icons)).toEqual(['chrome', 'media', 'mine'])
    expect(icons.sets.get('media')?.dir).toBe('local/img/media')
    expect(icons.sets.get('chrome')?.dir).toBe('img/chrome')
  })

  it('reads the empty key frames of img', async () => {
    expect([...(await scanIcons(folder())).empties].sort()).toEqual(['empty_1x1.png', 'empty_3x1.png'])
  })

  it('reads a folder with no local/img', async () => {
    const icons = await scanIcons(new MemoryFolder('r', { 'img/a/layer.png': 'x' }))
    expect(iconSetNames(icons)).toEqual(['a'])
  })
})

describe('iconImage', () => {
  it("takes the picture drawn for the key's size, else the 1x1 one", async () => {
    const icons = await scanIcons(folder())
    expect(iconImage(icons, 'chrome', 'selected', 1, 2)).toBe('img/chrome/selected_1x2.png')
    expect(iconImage(icons, 'chrome', 'selected', 2, 1)).toBe('img/chrome/selected.png')
    expect(iconImage(icons, 'chrome', 'layer', 1, 2)).toBe('img/chrome/layer.png')
    expect(iconImage(icons, 'media', 'macro', 2, 1)).toBe('local/img/media/macro_2x1.png')
    expect(iconImage(icons, 'mine', 'selected_macro', 1, 1)).toBe('local/img/mine/selected_macro.png')
  })

  it('looks for an unknown set in img', () => {
    expect(iconImage(STOCK_ICONS, 'gone', 'layer', 2, 2)).toBe('img/gone/layer.png')
  })
})

describe('emptyImage', () => {
  it('takes empty_<w>x<h>.png for any size that has one, else empty.png', async () => {
    const icons = await scanIcons(folder())
    expect(emptyImage(icons, 3, 1)).toBe('img/empty_3x1.png')
    expect(emptyImage(icons, 1, 2)).toBe('img/empty.png')
    expect(emptyImage(STOCK_ICONS, 2, 2)).toBe('img/empty_2x2.png')
  })
})
