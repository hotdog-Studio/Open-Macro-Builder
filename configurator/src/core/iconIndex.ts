import { compareText } from './folder/path'
import type { FolderAccess } from './folder/types'

/** The four pictures of an icon set, by the file name of their 1×1 version (without `.png`). */
export type IconState = 'layer' | 'macro' | 'selected' | 'selected_macro'

export interface IconSetEntry {
  name: string
  /** `local/img/<name>` (a set of your own) or `img/<name>` (shared). */
  dir: string
  /** The file names in the set's folder. */
  files: ReadonlySet<string>
}

/** The icon sets and empty key frames of a folder, as both runtimes find them. */
export interface IconIndex {
  /** By name; a set in local/img hides the shared set of the same name. */
  sets: ReadonlyMap<string, IconSetEntry>
  /** The `empty_<w>x<h>.png` files in img/. */
  empties: ReadonlySet<string>
}

/** The index of a folder as shipped, before one is read: the four stock empty frames and no sets. */
export const STOCK_ICONS: IconIndex = {
  sets: new Map(),
  empties: new Set(['empty_1x1.png', 'empty_1x2.png', 'empty_2x1.png', 'empty_2x2.png']),
}

const EMPTY_FRAME = /^empty_\d+x\d+\.png$/

async function setsIn(folder: FolderAccess, root: 'img' | 'local/img'): Promise<IconSetEntry[]> {
  const dirs = (await folder.list(root)).filter((e) => e.kind === 'dir' && e.name !== 'template')
  const entries = await Promise.all(
    dirs.map(async (d) => {
      const dir = `${root}/${d.name}`
      const files = new Set((await folder.list(dir)).filter((e) => e.kind === 'file').map((e) => e.name))
      return { name: d.name, dir, files }
    }),
  )
  // A folder is an icon set when it has a layer.png, as the runtimes and the validator decide.
  return entries.filter((e) => e.files.has('layer.png'))
}

/** Reads the icon sets of img/ and local/img/, and the empty key frames of img/. */
export async function scanIcons(folder: FolderAccess): Promise<IconIndex> {
  const [shared, personal, img] = await Promise.all([
    setsIn(folder, 'img'),
    setsIn(folder, 'local/img'),
    folder.list('img'),
  ])
  const sets = new Map<string, IconSetEntry>()
  for (const s of [...shared, ...personal]) sets.set(s.name, s)
  const empties = new Set(img.filter((e) => e.kind === 'file' && EMPTY_FRAME.test(e.name)).map((e) => e.name))
  return { sets, empties }
}

/** The names of the icon sets, sorted. */
export function iconSetNames(index: IconIndex): string[] {
  return [...index.sets.keys()].sort(compareText)
}

/**
 * The picture a key of w×h units shows for a set: `<state>_<w>x<h>.png` when the set has it, else
 * `<state>.png`, from the set's folder (local/img before img). A set the index does not know is
 * looked for in img/.
 */
export function iconImage(index: IconIndex, set: string, state: IconState, w: number, h: number): string {
  const entry = index.sets.get(set)
  const dir = entry?.dir ?? `img/${set}`
  const sized = `${state}_${w}x${h}.png`
  return entry?.files.has(sized) ? `${dir}/${sized}` : `${dir}/${state}.png`
}

/** The empty frame of a key of w×h units: `img/empty_<w>x<h>.png` when it exists, else `img/empty.png`. */
export function emptyImage(index: IconIndex, w: number, h: number): string {
  const sized = `empty_${w}x${h}.png`
  return index.empties.has(sized) ? `img/${sized}` : 'img/empty.png'
}
