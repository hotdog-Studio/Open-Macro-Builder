import type { FolderAccess } from '../core/folder/types'
import type { FrameState } from '../core/icons/frames'
import type { TemplateLookup } from '../core/icons/generate'
import { DEFAULT_RECIPE, parseRecipe, parseSize, stateFile, writeRecipe, type IconRecipe } from '../core/icons/recipe'
import type { Rgba } from '../core/icons/rgba'
import { decodePng, encodePng } from './iconCodec'

const STATES: readonly FrameState[] = ['macro', 'selected', 'selected_macro']

async function readOrNull(folder: FolderAccess, path: string): Promise<Uint8Array | null> {
  try {
    return await folder.readBytes(path)
  } catch {
    return null
  }
}

async function readPicture(folder: FolderAccess, path: string): Promise<Rgba | null> {
  const bytes = await readOrNull(folder, path)
  if (!bytes) return null
  try {
    return await decodePng(bytes)
  } catch {
    return null
  }
}

/** The user's templates in img/template for the sizes, as a lookup (a size or state without one is null). */
export async function loadTemplates(folder: FolderAccess, sizes: readonly string[]): Promise<TemplateLookup> {
  const wanted = sizes.flatMap((name) => {
    const size = parseSize(name)
    return size ? STATES.map((state) => ({ key: `${state}:${name}`, path: `img/template/${stateFile(state, size.w, size.h)}` })) : []
  })
  const pictures = await Promise.all(wanted.map((t) => readPicture(folder, t.path)))
  const found = new Map<string, Rgba>()
  wanted.forEach((t, i) => {
    const picture = pictures[i]
    if (picture) found.set(t.key, picture)
  })
  return (state, w, h) => found.get(`${state}:${w}x${h}`) ?? null
}

/** What an existing set gives to start from. */
export interface SetDraft {
  /** The saved picture, or the set's layer.png when it has none; null when the set has neither. */
  picture: Rgba | null
  /** The picture is the set's layer.png, not a saved source.png. */
  fromLayer: boolean
  /** The set's icon.json; null when it has none. */
  recipe: IconRecipe | null
}

/** The picture and recipe saved in a set's folder: source.png and icon.json, or the layer.png with no padding. */
export async function readSetDraft(folder: FolderAccess, dir: string): Promise<SetDraft> {
  const recipeBytes = await readOrNull(folder, `${dir}/icon.json`)
  const recipeText = recipeBytes ? new TextDecoder().decode(recipeBytes) : null
  const recipe = recipeText === null ? null : parseRecipe(recipeText)
  const source = await readPicture(folder, `${dir}/source.png`)
  if (source) return { picture: source, fromLayer: false, recipe }
  const layer = await readPicture(folder, `${dir}/layer.png`)
  return { picture: layer, fromLayer: layer !== null, recipe: recipe && { ...recipe, padding: 0 } }
}

/** The recipe to start an existing set's editor with: the saved one, or the default with no padding for a layer.png. */
export function startRecipe(draft: SetDraft): IconRecipe {
  if (draft.recipe) return draft.recipe
  return { ...DEFAULT_RECIPE, padding: draft.fromLayer ? 0 : DEFAULT_RECIPE.padding, sizes: [...DEFAULT_RECIPE.sizes] }
}

/** A file about to be written. */
export interface PlannedFile {
  path: string
  bytes: Uint8Array
  /** The folder already has a file at this path. */
  replaces: boolean
}

/** Whether a file is there; one that cannot be read counts as there, so it is never replaced without asking. */
async function exists(folder: FolderAccess, path: string): Promise<boolean> {
  try {
    return (await folder.readBytes(path)) !== null
  } catch {
    return true
  }
}

async function planned(folder: FolderAccess, path: string, bytes: Uint8Array | Promise<Uint8Array>): Promise<PlannedFile> {
  const [data, replaces] = await Promise.all([bytes, exists(folder, path)])
  return { path, bytes: data, replaces }
}

/** Encodes the pictures (and text) to write under `dir` and checks which files are already there. */
export async function planFiles(
  folder: FolderAccess,
  dir: string,
  pictures: ReadonlyMap<string, Rgba>,
  extra: { source: Rgba | null; recipe: IconRecipe } | null,
): Promise<PlannedFile[]> {
  const files = [...pictures].map(([name, image]) => planned(folder, `${dir}/${name}`, encodePng(image)))
  if (extra?.source) files.push(planned(folder, `${dir}/source.png`, encodePng(extra.source)))
  if (extra) files.push(planned(folder, `${dir}/icon.json`, new TextEncoder().encode(writeRecipe(extra.recipe))))
  return Promise.all(files)
}

/**
 * Writes the planned files. A set's layer.png goes last: it is what makes a folder an icon set, so a write that fails
 * part way never leaves a set the macropads would load with pictures missing.
 */
export async function writePlanned(folder: FolderAccess, files: readonly PlannedFile[]): Promise<void> {
  const isLayer = (f: PlannedFile) => f.path.endsWith('/layer.png')
  await Promise.all(files.filter((f) => !isLayer(f)).map((f) => folder.writeBytes(f.path, f.bytes)))
  await Promise.all(files.filter(isLayer).map((f) => folder.writeBytes(f.path, f.bytes)))
}

/** The text of a file of the folder, or null. */
export async function readText(folder: FolderAccess, path: string): Promise<string | null> {
  const bytes = await readOrNull(folder, path)
  return bytes ? new TextDecoder().decode(bytes) : null
}
