import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import type { FolderAccess } from '../core/folder/types'
import type { IconIndex, IconSetEntry } from '../core/iconIndex'
import { renderSet } from '../core/icons/generate'
import {
  DEFAULT_RECIPE,
  iconSetNameError,
  normalizeSizes,
  type Fit,
  type IconRecipe,
} from '../core/icons/recipe'
import type { Rgba } from '../core/icons/rgba'
import { padSizes, setUsage } from '../core/icons/usage'
import { useEditor } from '../state/store'
import {
  BACKGROUND_SWATCHES,
  ColourField,
  FitField,
  OUTLINE_SWATCHES,
  PaddingField,
  ReplaceDialog,
  SizePicker,
} from './IconControls'
import { SizePreview } from './IconPreviews'
import { decodePicture } from './iconCodec'
import { loadTemplates, planFiles, readSetDraft, startRecipe } from './iconFiles'
import { STYLE } from './Panels'
import { useImageUrls, useTemplates } from './useDiskImage'
import { useIconWrite } from './useIconWrite'

/** The picture the set is drawn from, and whether it is new (so source.png is written). */
interface Chosen {
  image: Rgba
  write: boolean
  /** What to call it: the file's name, or where it came from. */
  label: string
}

type Where = 'local' | 'shared'

const NOTHING: ReadonlyMap<string, Rgba> = new Map()

/** The templates of img/template for these sizes, or null until they are read. */
/** What an existing set's editor starts from, once its folder is read. */
type Apply = (picture: Chosen | null, recipe: IconRecipe) => void

/**
 * Reads an existing set's saved picture and recipe when it is chosen, and again after a write (`version`), and
 * hands them to `apply`. The sizes the layout uses are ticked as well.
 */
function useStart(folder: FolderAccess, dir: string | null, version: number, used: readonly string[], apply: Apply): void {
  // The latest used sizes and callback, read when the folder has been read, without reading the folder again for them.
  const latest = useRef({ used, apply })
  useEffect(() => {
    latest.current = { used, apply }
  })
  useEffect(() => {
    if (dir === null) return
    let live = true
    readSetDraft(folder, dir)
      .then((draft) => {
        if (!live) return
        const recipe = startRecipe(draft)
        const label = `${dir}/${draft.fromLayer ? 'layer' : 'source'}.png`
        const picture = draft.picture && { image: draft.picture, write: draft.fromLayer, label }
        latest.current.apply(picture, { ...recipe, sizes: normalizeSizes([...recipe.sizes, ...latest.current.used]) })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [folder, dir, version])
}

function PictureField({ chosen, onPick }: Readonly<{ chosen: Chosen | null; onPick: (file: File) => void }>) {
  const id = useId()
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onPick(file)
  }
  return (
    <div
      className={`rounded-lg border border-dashed p-3 ${over ? 'border-sky-400 bg-sky-400/10' : 'border-zinc-700'}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <label htmlFor={id} className="mb-1 block text-[11px] text-zinc-400">
        Picture (PNG, JPG, SVG…)
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        className="block w-full text-[12px] text-zinc-300 file:mr-2 file:rounded-md file:border file:border-zinc-700 file:bg-transparent file:px-2.5 file:py-1 file:text-zinc-200"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
        }}
      />
      <p className={STYLE.note}>
        {chosen ? `${chosen.label}, ${chosen.image.width}×${chosen.image.height} px.` : 'Choose a picture, or drop one here.'}
      </p>
    </div>
  )
}

function WhereField({ where, onChange }: Readonly<{ where: Where; onChange: (w: Where) => void }>) {
  const name = useId()
  return (
    <fieldset className="mt-3 min-w-0">
      <legend className="mb-1 text-[11px] text-zinc-400">Where it goes</legend>
      <label className="flex items-center gap-2 text-zinc-200">
        <input type="radio" name={name} className="accent-sky-500" checked={where === 'local'} onChange={() => onChange('local')} />
        <span>
          Yours <code className="font-mono text-[11px] text-zinc-500">local/img</code>
        </span>
      </label>
      <label className="mt-1 flex items-center gap-2 text-zinc-200">
        <input type="radio" name={name} className="accent-sky-500" checked={where === 'shared'} onChange={() => onChange('shared')} />
        <span>
          Shared <code className="font-mono text-[11px] text-zinc-500">img</code>
        </span>
      </label>
    </fieldset>
  )
}

function NameField({ name, error, onChange }: Readonly<{ name: string; error: string | null; onChange: (name: string) => void }>) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-zinc-400">
        Name (the folder)
      </label>
      <input
        id={id}
        className={STYLE.input}
        value={name}
        spellCheck={false}
        aria-invalid={error !== null}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== null && name !== '' && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

/** Where an existing set is, or the name and location of a new one. */
function Location({
  set,
  name,
  error,
  where,
  onName,
  onWhere,
}: Readonly<{
  set: IconSetEntry | null
  name: string
  error: string | null
  where: Where
  onName: (name: string) => void
  onWhere: (where: Where) => void
}>) {
  if (!set) {
    return (
      <>
        <NameField name={name} error={error} onChange={onName} />
        <WhereField where={where} onChange={onWhere} />
      </>
    )
  }
  return (
    <p className="text-zinc-400">
      In <code className="font-mono text-[12px]">{set.dir}/</code>
      {set.dir.startsWith('img/') && ' (shared: an update of the scripts may replace these files)'}
    </p>
  )
}

function Previews({
  sizes,
  urls,
  dir,
  version,
}: Readonly<{ sizes: readonly string[]; urls: ReadonlyMap<string, string>; dir: string | null; version: number }>) {
  if (sizes.length === 0) return <p className="mt-4 text-zinc-500">Choose a picture to see the icons.</p>
  return (
    <div className="mt-4 grid gap-3">
      {sizes.map((size) => (
        <SizePreview key={size} size={size} urls={urls} dir={dir} version={version} />
      ))}
    </div>
  )
}

interface EditorProps {
  /** The set being edited; null for a new one. */
  set: IconSetEntry | null
  /** Bumped after every write, so what is shown from the disk is read again. */
  version: number
  /** Called with the set's name once its files are written. */
  onSaved: (name: string) => void
}

/**
 * Why a new set cannot have this name, or null. A name already used in local/img or img is refused: a set of the
 * same name in the other folder would hide one of them from the macropads without a word.
 */
function newSetNameError(name: string, icons: IconIndex): string | null {
  const error = iconSetNameError(name)
  if (error) return error
  const existing = icons.sets.get(name)
  return existing ? `There is already an icon set called ${name} in ${existing.dir}; choose it on the left to change it.` : null
}

/** Tells the store which set has unsaved changes (null: none), and that none has once the editor goes. */
function useDraftFlag(draft: string | null): void {
  const { dispatch } = useEditor()
  useEffect(() => {
    dispatch({ type: 'icon-draft', draft })
  }, [dispatch, draft])
  useEffect(() => () => dispatch({ type: 'icon-draft', draft: null }), [dispatch])
}

/** The folder a set is written to. */
function setDir(set: IconSetEntry | null, where: Where, name: string): string {
  if (set) return set.dir
  return `${where === 'local' ? 'local/img' : 'img'}/${name}`
}

/** The editor of one icon set, or of a new one: the inputs, the preview and the comparison with the disk. */
export function IconSetEditor({ set, version, onSaved }: Readonly<EditorProps>) {
  const { state } = useEditor()
  const { folder, ws } = state
  const [name, setName] = useState(set?.name ?? '')
  const [where, setWhere] = useState<Where>('local')
  const [picture, setPicture] = useState<Chosen | null>(null)
  // A new set starts with the key sizes of the pad ticked; an existing one with its own and those where it is used.
  const [recipe, setRecipe] = useState<IconRecipe>(() => (set ? DEFAULT_RECIPE : { ...DEFAULT_RECIPE, sizes: padSizes(ws) }))
  // What the recipe was when the set was read (or the editor opened), and whether a picture was chosen since:
  // a change to either is unsaved work.
  const [base, setBase] = useState<IconRecipe>(recipe)
  const [picked, setPicked] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const write = useIconWrite()

  const used = useMemo(() => (set ? setUsage(ws, set.name).sizes : padSizes(ws)), [ws, set])
  useStart(folder, set?.dir ?? null, version, used, (p, r) => {
    setPicture(p)
    setRecipe(r)
    setBase(r)
    setPicked(false)
  })

  const sizes = useMemo(() => normalizeSizes(['1x1', ...recipe.sizes]), [recipe.sizes])
  const templates = useTemplates(folder, sizes)
  const files = useMemo(
    () => (picture ? renderSet(picture.image, recipe, templates ?? undefined) : NOTHING),
    [picture, recipe, templates],
  )
  const urls = useImageUrls(files)
  const nameError = set ? null : newSetNameError(name, state.icons)
  const dir = setDir(set, where, name)
  useDraftFlag(picked || JSON.stringify(recipe) !== JSON.stringify(base) ? dir : null)
  const patch = (change: Partial<IconRecipe>) => setRecipe((r) => ({ ...r, ...change }))

  const pick = (file: File) => {
    setProblem(null)
    decodePicture(file)
      .then((image) => {
        setPicture({ image, write: true, label: file.name })
        setPicked(true)
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : 'The picture could not be read.'))
  }

  const save = () => {
    if (!picture) return
    const saved = { ...recipe, sizes }
    const build = async () => {
      const pictures = renderSet(picture.image, saved, await loadTemplates(folder, sizes))
      return planFiles(folder, dir, pictures, { source: picture.write ? picture.image : null, recipe: saved })
    }
    return write.start('The icon set', `${dir}/`, build, () => onSaved(set?.name ?? name))
  }

  return (
    <div className="w-full max-w-3xl">
      <h2 className="mb-3 text-base font-semibold">{set ? set.name : 'New icon set'}</h2>
      <div className="grid gap-x-8 md:grid-cols-2">
        <div className="min-w-0">
          <Location set={set} name={name} error={nameError} where={where} onName={setName} onWhere={setWhere} />
          <div className="mt-3">
            <PictureField chosen={picture} onPick={pick} />
            {problem !== null && <p className="mt-1 text-[11px] text-red-400">{problem}</p>}
          </div>
          <FitField value={recipe.fit} onChange={(fit: Fit) => patch({ fit })} />
          <PaddingField value={recipe.padding} onChange={(padding) => patch({ padding })} />
        </div>
        <div className="min-w-0">
          <ColourField label="Background (selected states)" value={recipe.background} swatches={BACKGROUND_SWATCHES} onChange={(background) => patch({ background })} />
          <ColourField label="Outline colour" value={recipe.outline} swatches={OUTLINE_SWATCHES} onChange={(outline) => patch({ outline })} />
          <SizePicker ticked={recipe.sizes} used={used} always="1x1" onChange={(next) => patch({ sizes: next })} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!picture || nameError !== null || write.busy}
          onClick={() => void save()}
        >
          {set ? 'Save icon set' : 'Create icon set'}
        </button>
        <span className="font-mono text-[11px] text-zinc-500">{dir}/</span>
      </div>
      <Previews sizes={picture ? sizes : []} urls={urls} dir={set?.dir ?? null} version={version} />
      {write.asking && <ReplaceDialog files={write.asking} onCancel={write.cancel} onReplace={() => void write.replace()} />}
    </div>
  )
}
