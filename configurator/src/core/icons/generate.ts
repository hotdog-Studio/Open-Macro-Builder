import { drawFrame, pixelSize, recolourTemplate, type Colour, type FrameState } from './frames'
import { parseColour, parseSize, stateFile, type Fit, type IconRecipe } from './recipe'
import { blank, crop, over, resize, type Rgba } from './rgba'

/** The user's template picture for a state at a key size, when there is one. */
export type TemplateLookup = (state: FrameState, w: number, h: number) => Rgba | null

const FRAME_STATES: readonly FrameState[] = ['macro', 'selected', 'selected_macro']

/** The size the picture is scaled to for a box: all of it inside (contain), all of the box covered (cover), or the box itself. */
function scaledSize(src: Rgba, box: { w: number; h: number }, fit: Fit): { w: number; h: number } {
  if (fit === 'stretch') return box
  const ratio = fit === 'contain' ? Math.min(box.w / src.width, box.h / src.height) : Math.max(box.w / src.width, box.h / src.height)
  return { w: Math.max(1, Math.round(src.width * ratio)), h: Math.max(1, Math.round(src.height * ratio)) }
}

/** The picture placed on a transparent canvas of the key's pixel size, `padding` px from every edge: `layer.png`. */
export function placePicture(src: Rgba, width: number, height: number, fit: Fit, padding: number): Rgba {
  const pad = Math.min(padding, Math.floor((Math.min(width, height) - 1) / 2))
  const box = { w: width - 2 * pad, h: height - 2 * pad }
  const size = scaledSize(src, box, fit)
  const scaled = resize(src, size.w, size.h)
  // A picture bigger than the box (cover) is cut to it, centred.
  const shown = crop(scaled, Math.max(0, Math.floor((size.w - box.w) / 2)), Math.max(0, Math.floor((size.h - box.h) / 2)), Math.min(size.w, box.w), Math.min(size.h, box.h))
  const x = pad + Math.max(0, Math.floor((box.w - size.w) / 2))
  const y = pad + Math.max(0, Math.floor((box.h - size.h) / 2))
  return over(blank(width, height), shown, x, y)
}

function colourOf(text: string, fallback: Colour): Colour {
  return parseColour(text) ?? fallback
}

/** The frame of a state for a key size: the user's template when there is one, else drawn in code. */
export function frameFor(
  state: FrameState,
  w: number,
  h: number,
  fill: Colour,
  line: Colour,
  templates?: TemplateLookup,
): Rgba {
  const { width, height } = pixelSize(w, h)
  const template = templates?.(state, w, h)
  if (template?.width === width && template.height === height) return recolourTemplate(template, fill, line)
  return drawFrame(state, width, height, fill, line)
}

/** The four pictures of a set for one key size, by file name. */
export function renderSize(picture: Rgba, recipe: IconRecipe, w: number, h: number, templates?: TemplateLookup): Map<string, Rgba> {
  const { width, height } = pixelSize(w, h)
  const layer = placePicture(picture, width, height, recipe.fit, recipe.padding)
  const fill = colourOf(recipe.background, [0x8e, 0x8c, 0xd8])
  const line = colourOf(recipe.outline, [0, 0, 0])
  const out = new Map<string, Rgba>([[stateFile('layer', w, h), layer]])
  for (const state of FRAME_STATES) {
    out.set(stateFile(state, w, h), over(frameFor(state, w, h, fill, line, templates), layer))
  }
  return out
}

/** Every picture of a set for the recipe's sizes (1x1 always), by file name. */
export function renderSet(picture: Rgba, recipe: IconRecipe, templates?: TemplateLookup): Map<string, Rgba> {
  const out = new Map<string, Rgba>()
  for (const name of new Set(['1x1', ...recipe.sizes])) {
    const size = parseSize(name)
    if (!size) continue
    for (const [file, image] of renderSize(picture, recipe, size.w, size.h, templates)) out.set(file, image)
  }
  return out
}

/** The empty key frame of a size: the outline frame, as `img/empty_<w>x<h>.png`. */
export function renderEmptyFrame(w: number, h: number, outline: string, templates?: TemplateLookup): Rgba {
  return frameFor('macro', w, h, [0x8e, 0x8c, 0xd8], colourOf(outline, [0, 0, 0]), templates)
}

/** The file of an empty key frame. */
export function emptyFrameFile(w: number, h: number): string {
  return `empty_${w}x${h}.png`
}
