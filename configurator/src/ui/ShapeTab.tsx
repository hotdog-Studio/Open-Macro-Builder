import { useEffect, useId, useState } from 'react'
import { size, type PadKey } from '../core/config/model'
import { addKey, removalImpact, removeKey, renameKey, setOptions } from '../core/config/ops'
import { ahkKeyName } from '../core/keyNames'
import { useEditor } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'
import { PadGrid } from './PadGrid'
import { CentrePanel, LeftPanel, RightPanel, STYLE } from './Panels'

const NO_NAME = 'That key has no AutoHotkey name here; type it instead.'

/** F13 to F24 are what most macropads send; fall back to F1 to F12, then to an empty name. */
function freeName(taken: Set<string>): string {
  const candidates = [...Array.from({ length: 12 }, (_, i) => 13 + i), ...Array.from({ length: 12 }, (_, i) => 1 + i)]
  const free = candidates.find((n) => !taken.has(`F${n}`))
  return free === undefined ? '' : `F${free}`
}

function KeyFace({ k }: Readonly<{ k: PadKey }>) {
  const { w, h } = size(k)
  const isFn = k.id === 'fn'
  const tone = isFn ? 'border-amber-600 bg-amber-950/60 text-amber-300' : 'border-zinc-600 bg-zinc-800 text-zinc-100'
  return (
    <span className={`flex h-full w-full flex-col items-center justify-center rounded-[7px] border leading-tight ${tone}`}>
      <span className="font-mono">
        {isFn && <b className="mr-1">Fn</b>}
        {isFn && ' '}
        {k.key}
      </span>{' '}
      <span className={`text-[10px] ${isFn ? 'text-amber-400/70' : 'text-zinc-500'}`}>
        {w}×{h}
      </span>
    </span>
  )
}

function Check({ label, checked, onChange }: Readonly<{ label: string; checked: boolean; onChange: (on: boolean) => void }>) {
  return (
    <label className="mt-2 flex items-center gap-2 text-zinc-200">
      <input type="checkbox" className="accent-sky-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function OverlayOptions() {
  const { state, dispatch } = useEditor()
  const { ws } = state
  const o = ws.options
  const labelId = useId()
  const actionId = useId()
  const set = (patch: Parameters<typeof setOptions>[1]) => dispatch({ type: 'edit', ws: setOptions(ws, patch) })
  const showFn = o.showFn !== undefined && o.showFn !== false

  return (
    <>
      <h3 className={STYLE.heading}>Overlay options</h3>
      <Check label="Show labels above keys" checked={o.showLabels ?? false} onChange={(on) => set({ showLabels: on })} />
      <Check
        label="Outline keys that have a macro"
        checked={o.showMacroMarkers ?? false}
        onChange={(on) => set({ showMacroMarkers: on })}
      />
      <Check label="Show the Fn key" checked={showFn} onChange={(on) => set({ showFn: on })} />
      <label htmlFor={labelId} className={STYLE.label}>
        Fn label
      </label>
      <input
        id={labelId}
        className={STYLE.input}
        disabled={!showFn}
        value={typeof o.showFn === 'string' ? o.showFn : ''}
        placeholder={showFn ? ws.fn.key : ''}
        onChange={(e) => set({ showFn: e.target.value === '' ? true : e.target.value })}
      />
      <Check label="Use per-macro icons" checked={o.useMacroIcons ?? false} onChange={(on) => set({ useMacroIcons: on })} />
      <label htmlFor={actionId} className={STYLE.label}>
        Clicking an icon
      </label>
      <select
        id={actionId}
        className={STYLE.input}
        value={o.iconAction ?? 'Layer'}
        onChange={(e) => set({ iconAction: e.target.value })}
      >
        <option value="Layer">switches layer</option>
        <option value="Macro">runs the macro</option>
      </select>
    </>
  )
}

function KeyDetails({ k }: Readonly<{ k: PadKey }>) {
  const { state, dispatch } = useEditor()
  const { ws } = state
  const nameId = useId()
  const [capturing, setCapturing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const isFn = k.id === 'fn'
  const index = ws.keys.findIndex((x) => x.id === k.id)

  // While capturing, the next key press anywhere names the key.
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const name = ahkKeyName(e.code)
      setCapturing(false)
      if (name === null) {
        setProblem(NO_NAME)
      } else {
        setProblem(null)
        dispatch({ type: 'edit', ws: renameKey(ws, k.id, name) })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, dispatch, k.id, ws])

  const ask = () => {
    const result = removeKey(ws, k.id)
    if (result.ok) setConfirming(true)
    else dispatch({ type: 'banner', banner: { text: result.reason, kind: 'error' } })
  }
  const remove = () => {
    const result = removeKey(ws, k.id)
    setConfirming(false)
    if (!result.ok) {
      dispatch({ type: 'banner', banner: { text: result.reason, kind: 'error' } })
      return
    }
    dispatch({ type: 'edit', ws: result.ws })
    dispatch({ type: 'select', key: null })
  }

  const impact = removalImpact(ws, k.id)
  return (
    <>
      <h3 className={STYLE.heading}>{isFn ? 'Fn key' : `Macro key ${index + 1} of ${ws.keys.length}`}</h3>
      <label htmlFor={nameId} className={`${STYLE.label} mt-0`}>
        Keyboard key it sends
      </label>
      <input
        id={nameId}
        className={`${STYLE.input} font-mono`}
        value={k.key}
        spellCheck={false}
        onChange={(e) => dispatch({ type: 'edit', ws: renameKey(ws, k.id, e.target.value) })}
      />
      <button
        type="button"
        className={`${STYLE.button} mt-2 w-full ${capturing ? 'border-sky-500 text-sky-300' : ''}`}
        onClick={() => {
          setProblem(null)
          setCapturing((on) => !on)
        }}
      >
        Capture by pressing it
      </button>
      {capturing && <p className="mt-2 text-sky-300">Press the key on your pad…</p>}
      {problem && (
        <p role="alert" className="mt-2 text-red-300">
          {problem}
        </p>
      )}
      <p className={STYLE.note}>
        Capture works only while the macropad is not running; a running macropad takes the key before this window
        sees it.
      </p>
      <button type="button" className={`${STYLE.button} mt-4`} disabled={isFn} onClick={ask}>
        Remove
      </button>
      {confirming && (
        <ConfirmDialog
          title={`Remove ${k.key}?`}
          onCancel={() => setConfirming(false)}
          choices={[{ label: 'Remove key', danger: true, onChoose: remove }]}
        >
          {impact.layer === null && impact.macros.length === 0 ? (
            <p>Nothing is assigned to this key.</p>
          ) : (
            <>
              <p>Removing this key also changes:</p>
              <ul className="mt-2 list-disc pl-5">
                {impact.layer !== null && <li>The layer "{impact.layer}" has no key any more and moves to Parked.</li>}
                {impact.macros.map((m) => (
                  <li key={`${m.layer}:${m.name}`}>
                    The macro "{m.name}" on layer "{m.layer}" is cleared.
                  </li>
                ))}
              </ul>
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  )
}

function AddKey() {
  const { state, dispatch } = useEditor()
  const { ws } = state
  const add = () => {
    const added = addKey(ws, freeName(new Set([ws.fn.key, ...ws.keys.map((x) => x.key)])))
    dispatch({ type: 'edit', ws: added.ws })
    dispatch({ type: 'select', key: added.id })
    const notices = added.ws.notices.slice(ws.notices.length)
    if (notices.length > 0) dispatch({ type: 'banner', banner: { text: notices.join('\n'), kind: 'info' } })
  }
  return (
    <button type="button" className={`${STYLE.button} mt-4 w-full`} onClick={add}>
      + Add key
    </button>
  )
}

/** The Pad shape tab: the physical pad, and the overlay options. */
export function ShapeTab() {
  const { state } = useEditor()
  const { ws, selectedKey } = state
  const selected = selectedKey === 'fn' ? ws.fn : ws.keys.find((k) => k.id === selectedKey)
  return (
    <>
      <LeftPanel>
        <OverlayOptions />
      </LeftPanel>
      <CentrePanel>
        <p className="text-zinc-400">The physical pad. One grid square is one key unit.</p>
        <PadGrid mode="shape" extraCell renderKey={(k) => <KeyFace k={k} />} />
        <p className="text-[11px] text-zinc-500">Drag a key to an empty square to move it · drag its corner to resize it · Alt+arrows move the focused key,
          Shift+Alt+arrows resize it</p>
      </CentrePanel>
      <RightPanel>
        {selected ? <KeyDetails key={selected.id} k={selected} /> : <p className="text-zinc-500">Select a key.</p>}
        <AddKey />
      </RightPanel>
    </>
  )
}
