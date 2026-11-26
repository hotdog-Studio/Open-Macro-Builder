import { useId, useState } from 'react'
import { FITS, normalizeSizes, parseSize, sizeName, type Fit } from '../core/icons/recipe'
import type { PlannedFile } from './iconFiles'
import { ConfirmDialog } from './ConfirmDialog'
import { STYLE } from './Panels'

const FIT_LABEL: Record<Fit, string> = { contain: 'Fit', cover: 'Fill', stretch: 'Stretch' }

/** Fit (contain), Fill (cover) or Stretch. */
export function FitField({ value, onChange }: Readonly<{ value: Fit; onChange: (fit: Fit) => void }>) {
  const name = useId()
  return (
    <fieldset className="mt-3 min-w-0">
      <legend className="mb-1 text-[11px] text-zinc-400">Picture</legend>
      <div className="flex gap-3">
        {FITS.map((fit) => (
          <label key={fit} className="flex items-center gap-1.5 text-zinc-200">
            <input type="radio" name={name} className="accent-sky-500" checked={value === fit} onChange={() => onChange(fit)} />
            {FIT_LABEL[fit]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function PaddingField({ value, onChange }: Readonly<{ value: number; onChange: (padding: number) => void }>) {
  const id = useId()
  return (
    <div className="mt-3">
      <label htmlFor={id} className="mb-1 block text-[11px] text-zinc-400">
        Padding (px)
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={200}
        className={`${STYLE.input} w-24`}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0))))}
      />
    </div>
  )
}

/** A colour picker with swatches and the colour's hex text. */
export function ColourField({
  label,
  value,
  swatches,
  onChange,
}: Readonly<{ label: string; value: string; swatches: readonly string[]; onChange: (colour: string) => void }>) {
  const id = useId()
  return (
    <div className="mt-3">
      <label htmlFor={id} className="mb-1 block text-[11px] text-zinc-400">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          id={id}
          type="color"
          className="h-7 w-10 cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <code className="mr-1 font-mono text-[11px] text-zinc-400">{value}</code>
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`${label} ${c}`}
            className={`h-5 w-5 rounded border ${c === value ? 'border-sky-400' : 'border-zinc-600'}`}
            style={{ backgroundColor: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  )
}

export const BACKGROUND_SWATCHES = ['#8e8cd8', '#5b8def', '#3fa37a', '#d9a441', '#d1604d', '#9a6fd1', '#4a4f5a', '#ffffff']
export const OUTLINE_SWATCHES = ['#000000', '#ffffff', '#8e8cd8', '#d9a441', '#d1604d']

const PRESETS = ['1x1', '1x2', '2x1', '2x2']

/** One size of a picker: the sizes of the layout carry a note. */
function SizeCheck({
  name,
  ticked,
  locked,
  used,
  onChange,
}: Readonly<{ name: string; ticked: boolean; locked: boolean; used: boolean; onChange: (on: boolean) => void }>) {
  return (
    <label className="flex items-center gap-2 text-zinc-200">
      <input
        type="checkbox"
        className="accent-sky-500"
        checked={ticked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {name.replace('x', '×')}
      {used && <span className="text-[11px] text-zinc-500">used by the layout</span>}
      {locked && <span className="text-[11px] text-zinc-500">always made</span>}
    </label>
  )
}

function AddSize({ onAdd }: Readonly<{ onAdd: (size: string) => void }>) {
  const [w, setW] = useState('3')
  const [h, setH] = useState('1')
  const widthId = useId()
  const heightId = useId()
  const size = sizeName(Number(w), Number(h))
  const valid = parseSize(size) !== null
  return (
    <div className="mt-2 flex items-end gap-1.5">
      <div>
        <label htmlFor={widthId} className="mb-1 block text-[11px] text-zinc-400">
          Wide
        </label>
        <input id={widthId} type="number" min={1} max={8} className={`${STYLE.input} w-16`} value={w} onChange={(e) => setW(e.target.value)} />
      </div>
      <div>
        <label htmlFor={heightId} className="mb-1 block text-[11px] text-zinc-400">
          High
        </label>
        <input id={heightId} type="number" min={1} max={8} className={`${STYLE.input} w-16`} value={h} onChange={(e) => setH(e.target.value)} />
      </div>
      <button type="button" className={STYLE.button} disabled={!valid} onClick={() => onAdd(size)}>
        Add size
      </button>
    </div>
  )
}

/**
 * The key sizes to make: 1×1, 1×2, 2×1 and 2×2, the sizes of the layout that are none of these, and any other
 * size added by hand. `always` is a size that cannot be unticked (1×1 of a set, which the macropad falls back to).
 */
export function SizePicker({
  ticked,
  used,
  always,
  onChange,
}: Readonly<{ ticked: readonly string[]; used: readonly string[]; always?: string; onChange: (sizes: string[]) => void }>) {
  const shown = normalizeSizes([...PRESETS, ...used, ...ticked])
  const toggle = (name: string, on: boolean) =>
    onChange(normalizeSizes(on ? [...ticked, name] : ticked.filter((s) => s !== name)))
  return (
    <fieldset className="mt-3 min-w-0">
      <legend className="mb-1 text-[11px] text-zinc-400">Key sizes to make</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {shown.map((name) => (
          <SizeCheck
            key={name}
            name={name}
            ticked={ticked.includes(name) || name === always}
            locked={name === always}
            used={used.includes(name)}
            onChange={(on) => toggle(name, on)}
          />
        ))}
      </div>
      <AddSize onAdd={(size) => onChange(normalizeSizes([...ticked, size]))} />
    </fieldset>
  )
}

/** Asks before files that are already there are replaced. */
/** Asks before the icon set being drawn is given up: its changes are not written anywhere until it is saved. */
export function LeaveIconSetDialog({ dir, onCancel, onLeave }: Readonly<{ dir: string; onCancel: () => void; onLeave: () => void }>) {
  return (
    <ConfirmDialog title="Leave the icon set unsaved?" onCancel={onCancel} choices={[{ label: 'Leave without saving', danger: true, onChoose: onLeave }]}>
      <p>
        Your changes to <code className="font-mono">{dir}/</code> are not saved, and are lost if you leave.
      </p>
    </ConfirmDialog>
  )
}

export function ReplaceDialog({
  files,
  onCancel,
  onReplace,
}: Readonly<{ files: readonly PlannedFile[]; onCancel: () => void; onReplace: () => void }>) {
  const replaced = files.filter((f) => f.replaces)
  return (
    <ConfirmDialog
      title="Replace existing files?"
      onCancel={onCancel}
      choices={[{ label: 'Replace', danger: true, onChoose: onReplace }]}
    >
      <p>These files are already there and will be replaced:</p>
      <ul className="mt-2 max-h-48 overflow-auto font-mono text-[11px] text-zinc-400">
        {replaced.map((f) => (
          <li key={f.path}>{f.path}</li>
        ))}
      </ul>
    </ConfirmDialog>
  )
}
