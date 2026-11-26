import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECIPE,
  iconSetNameError,
  normalizeSizes,
  parseColour,
  parseRecipe,
  parseSize,
  stateFile,
  writeRecipe,
} from './recipe'

describe('icon.json', () => {
  it('is read back as it was written', () => {
    const recipe = { fit: 'cover' as const, padding: 4, background: '#112233', outline: '#ffffff', sizes: ['1x1', '1x2'] }
    expect(parseRecipe(writeRecipe(recipe))).toEqual(recipe)
  })

  it('takes the default for a field that is missing or wrong', () => {
    expect(parseRecipe('{}')).toEqual(DEFAULT_RECIPE)
    const odd = parseRecipe('{"fit":"zoom","padding":"a","background":"red","outline":7,"sizes":["x",1,"9x9"]}')
    expect(odd).toEqual(DEFAULT_RECIPE)
  })

  it('clamps the padding to whole pixels from 0 to 200 and sorts and cleans the sizes', () => {
    const r = parseRecipe('{"padding":-3.4,"sizes":["2x1","1x2","1x2","1x1"],"background":"#ABCDEF"}')
    expect(r).toMatchObject({ padding: 0, sizes: ['1x1', '2x1', '1x2'], background: '#abcdef' })
    expect(parseRecipe('{"padding":900}')?.padding).toBe(200)
  })

  it('is null for text that is not a JSON object', () => {
    expect(parseRecipe('nope')).toBeNull()
    expect(parseRecipe('[1]')).toBeNull()
    expect(parseRecipe('null')).toBeNull()
  })

  it('is written with two-space indentation and a final newline', () => {
    expect(writeRecipe(DEFAULT_RECIPE)).toBe(
      '{\n  "fit": "contain",\n  "padding": 8,\n  "background": "#8e8cd8",\n  "outline": "#000000",\n  "sizes": [\n    "1x1"\n  ]\n}\n',
    )
  })
})

describe('sizes and names', () => {
  it('reads w x h of 1 to 8 units', () => {
    expect(parseSize('2x3')).toEqual({ w: 2, h: 3 })
    expect(parseSize('0x1')).toBeNull()
    expect(parseSize('9x1')).toBeNull()
    expect(parseSize('1x')).toBeNull()
    expect(normalizeSizes(['2x2', 'bad', '1x1', '2x2'])).toEqual(['1x1', '2x2'])
  })

  it('names the file of a state for a size', () => {
    expect(stateFile('layer', 1, 1)).toBe('layer.png')
    expect(stateFile('selected_macro', 2, 1)).toBe('selected_macro_2x1.png')
  })

  it('reads colours as #rrggbb', () => {
    expect(parseColour('#8E8cd8')).toEqual([0x8e, 0x8c, 0xd8])
    expect(parseColour('8e8cd8')).toBeNull()
    expect(parseColour('#fff')).toBeNull()
  })

  it('accepts a to z, 0 to 9 and _ in a folder name', () => {
    expect(iconSetNameError('my_set_2')).toBeNull()
    expect(iconSetNameError('')).not.toBeNull()
    expect(iconSetNameError('My Set')).not.toBeNull()
    expect(iconSetNameError('a-b')).not.toBeNull()
    expect(iconSetNameError('template')).not.toBeNull()
  })
})
