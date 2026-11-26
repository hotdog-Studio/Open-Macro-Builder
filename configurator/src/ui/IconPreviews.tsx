import { pixelSize } from '../core/icons/frames'
import { parseSize, stateFile } from '../core/icons/recipe'
import { STYLE } from './Panels'
import { useDiskImage } from './useDiskImage'

const STATE_LABEL: Record<string, string> = {
  layer: 'Layer',
  macro: 'Macro',
  selected: 'Selected',
  selected_macro: 'Selected, macro',
}

const SET_STATES = ['layer', 'macro', 'selected', 'selected_macro'] as const

/** A picture at its real pixel size on a dark ground; a missing one shows its place. */
function Cell({ src, alt, width, height }: Readonly<{ src: string | null; alt: string; width: number; height: number }>) {
  return src ? (
    <img src={src} alt={alt} width={width} height={height} draggable={false} className="max-w-none bg-zinc-950" />
  ) : (
    <span
      aria-label={`${alt}: none`}
      style={{ width, height }}
      className="flex items-center justify-center border border-dashed border-zinc-700 text-[10px] text-zinc-600"
    >
      none
    </span>
  )
}

function Caption({ children }: Readonly<{ children: string }>) {
  return <figcaption className="mt-1 text-center text-[10px] text-zinc-500">{children}</figcaption>
}

/** What a row of four pictures is called. */
function RowTitle({ children }: Readonly<{ children: string }>) {
  return <h4 className="mb-1 mt-2 text-[11px] text-zinc-400">{children}</h4>
}

function DiskCell({ path, alt, width, height, version }: Readonly<{ path: string; alt: string; width: number; height: number; version: number }>) {
  const src = useDiskImage(path, version)
  return <Cell src={src} alt={alt} width={width} height={height} />
}

/**
 * One key size: the four pictures as the code composes them, and, under them, the files the set has on disk now
 * (when `dir` is given). `urls` are the composed pictures by file name.
 */
export function SizePreview({
  size,
  urls,
  dir,
  version,
}: Readonly<{ size: string; urls: ReadonlyMap<string, string>; dir: string | null; version: number }>) {
  const parsed = parseSize(size)
  if (!parsed) return null
  const { width, height } = pixelSize(parsed.w, parsed.h)
  return (
    <section aria-label={`Size ${size}`} className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <h3 className={STYLE.heading}>
        <span>
          {size.replace('x', '×')} key
        </span>
        <span className="font-mono normal-case">
          {width}×{height} px
        </span>
      </h3>
      <RowTitle>Preview</RowTitle>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {SET_STATES.map((state) => (
          <figure key={state}>
            <Cell src={urls.get(stateFile(state, parsed.w, parsed.h)) ?? null} alt={`${STATE_LABEL[state]} ${size}`} width={width} height={height} />
            <Caption>{STATE_LABEL[state]}</Caption>
          </figure>
        ))}
      </div>
      {dir !== null && (
        <>
          <RowTitle>On disk now</RowTitle>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {SET_STATES.map((state) => (
              <figure key={state}>
                <DiskCell
                  path={`${dir}/${stateFile(state, parsed.w, parsed.h)}`}
                  alt={`On disk ${STATE_LABEL[state]} ${size}`}
                  width={width}
                  height={height}
                  version={version}
                />
                <Caption>{STATE_LABEL[state]}</Caption>
              </figure>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/** One empty key frame, composed now and as it is on disk. */
export function FramePreview({
  size,
  file,
  urls,
  version,
}: Readonly<{ size: string; file: string; urls: ReadonlyMap<string, string>; version: number }>) {
  const parsed = parseSize(size)
  if (!parsed) return null
  const { width, height } = pixelSize(parsed.w, parsed.h)
  return (
    <section aria-label={`Size ${size}`} className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <h3 className={STYLE.heading}>
        <span>{size.replace('x', '×')} key</span>
        <span className="font-mono normal-case">{file}</span>
      </h3>
      <div className="flex gap-3">
        <figure>
          <Cell src={urls.get(file) ?? null} alt={`Frame ${size}`} width={width} height={height} />
          <Caption>Preview</Caption>
        </figure>
        <figure>
          <DiskCell path={`img/${file}`} alt={`On disk frame ${size}`} width={width} height={height} version={version} />
          <Caption>On disk now</Caption>
        </figure>
      </div>
    </section>
  )
}
