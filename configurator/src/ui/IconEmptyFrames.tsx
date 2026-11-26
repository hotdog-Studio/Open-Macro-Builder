import { useMemo, useState } from 'react'
import { emptyFrameFile, renderEmptyFrame, type TemplateLookup } from '../core/icons/generate'
import { DEFAULT_OUTLINE, normalizeSizes, parseSize } from '../core/icons/recipe'
import type { Rgba } from '../core/icons/rgba'
import { padSizes } from '../core/icons/usage'
import { useEditor } from '../state/store'
import { ColourField, OUTLINE_SWATCHES, ReplaceDialog, SizePicker } from './IconControls'
import { FramePreview } from './IconPreviews'
import { loadTemplates, planFiles } from './iconFiles'
import { STYLE } from './Panels'
import { useImageUrls } from './useDiskImage'
import { useIconWrite } from './useIconWrite'

function framesOf(sizes: readonly string[], outline: string, templates?: TemplateLookup): Map<string, Rgba> {
  const frames = new Map<string, Rgba>()
  for (const name of sizes) {
    const size = parseSize(name)
    if (size) frames.set(emptyFrameFile(size.w, size.h), renderEmptyFrame(size.w, size.h, outline, templates))
  }
  return frames
}

/** The frames shown on a key that has a macro but no layer: `img/empty_<w>x<h>.png`, an outline frame of any size. */
export function IconEmptyFrames({ version, onSaved }: Readonly<{ version: number; onSaved: () => void }>) {
  const { state } = useEditor()
  const { folder, ws } = state
  const inUse = useMemo(() => padSizes(ws), [ws])
  const [sizes, setSizes] = useState<string[]>(inUse)
  const [outline, setOutline] = useState(DEFAULT_OUTLINE)
  const write = useIconWrite()

  const chosen = useMemo(() => normalizeSizes(sizes), [sizes])
  const frames = useMemo(() => framesOf(chosen, outline), [chosen, outline])
  const urls = useImageUrls(frames)

  const save = () => {
    const build = async () => planFiles(folder, 'img', framesOf(chosen, outline, await loadTemplates(folder, chosen)), null)
    return write.start('The empty key frames', 'img/', build, onSaved)
  }

  return (
    <div className="w-full max-w-3xl">
      <h2 className="mb-1 text-base font-semibold">Empty key frames</h2>
      <p className="mb-3 text-zinc-400">
        An outline frame for the keys that have a macro but no layer. A size without its own frame shows <code className="font-mono text-[12px]">img/empty.png</code>.
      </p>
      <div className="grid gap-x-8 md:grid-cols-2">
        <SizePicker ticked={chosen} used={inUse} onChange={setSizes} />
        <ColourField label="Outline colour" value={outline} swatches={OUTLINE_SWATCHES} onChange={setOutline} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={chosen.length === 0 || write.busy}
          onClick={() => void save()}
        >
          Write empty key frames
        </button>
        <span className="font-mono text-[11px] text-zinc-500">img/</span>
      </div>
      <div className="mt-4 grid gap-3">
        {chosen.length === 0 && <p className={STYLE.note}>Tick a size.</p>}
        {chosen.map((size) => {
          const parsed = parseSize(size)
          return parsed && <FramePreview key={size} size={size} file={emptyFrameFile(parsed.w, parsed.h)} urls={urls} version={version} />
        })}
      </div>
      {write.asking && <ReplaceDialog files={write.asking} onCancel={write.cancel} onReplace={() => void write.replace()} />}
    </div>
  )
}
