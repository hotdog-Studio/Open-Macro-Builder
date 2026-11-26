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
  const found = new Map<string, Rgba>()
  for (const name of sizes) {
    const size = parseSize(name)
    if (!size) continue
    for (const state of STATES) {
      const picture = await readPicture(folder, `img/template/${stateFile(state, size.w, size.h)}`)
      if (picture) found.set(`${state}:${name}`, picture)
    }
  }
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

async function planned(folder: FolderAccess, path: string, bytes: Uint8Array): Promise<PlannedFile> {
  return { path, bytes, replaces: (await readOrNull(folder, path)) !== null }
}

/** Encodes the pictures (and text) to write under `dir` and checks which files are already there. */
export async function planFiles(
  folder: FolderAccess,
  dir: string,
  pictures: ReadonlyMap<string, Rgba>,
  extra: { source: Rgba | null; recipe: IconRecipe } | null,
): Promise<PlannedFile[]> {
  const files: PlannedFile[] = []
  for (const [name, image] of pictures) files.push(await planned(folder, `${dir}/${name}`, await encodePng(image)))
  if (extra?.source) files.push(await planned(folder, `${dir}/source.png`, await encodePng(extra.source)))
  if (extra) files.push(await planned(folder, `${dir}/icon.json`, new TextEncoder().encode(writeRecipe(extra.recipe))))
  return files
}

/** Writes the planned files, one after the other. */
export async function writePlanned(folder: FolderAccess, files: readonly PlannedFile[]): Promise<void> {
  for (const f of files) await folder.writeBytes(f.path, f.bytes)
}

/** The text of a file of the folder, or null. */
export async function readText(folder: FolderAccess, path: string): Promise<string | null> {
  const bytes = await readOrNull(folder, path)
  return bytes ? new TextDecoder().decode(bytes) : null
}
