import { useEffect, useMemo, useState } from 'react'
import type { IconSetEntry } from '../core/iconIndex'
import { setUsage, type SetUsage } from '../core/icons/usage'
import { useEditor } from '../state/store'
import { IconEmptyFrames } from './IconEmptyFrames'
import { IconSetEditor } from './IconSetEditor'
import { readText } from './iconFiles'
import { CentrePanel, LeftPanel, RightPanel, STYLE } from './Panels'
import { useDiskImage } from './useDiskImage'

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'empty' } | { kind: 'set'; name: string }

const ITEM = 'mb-1 flex w-full items-center gap-2 rounded border px-2 py-1 text-left'

function itemClass(on: boolean): string {
  return `${ITEM} ${on ? 'border-sky-500 bg-sky-500/15' : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'}`
}

function SetItem({ entry, on, version, onChoose }: Readonly<{ entry: IconSetEntry; on: boolean; version: number; onChoose: () => void }>) {
  const src = useDiskImage(`${entry.dir}/layer.png`, version)
  return (
    <button type="button" aria-pressed={on} className={itemClass(on)} onClick={onChoose}>
      {src ? <img src={src} alt="" draggable={false} className="h-7 w-7 shrink-0 object-contain" /> : <span className="h-7 w-7 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      <span className="text-[10px] text-zinc-500">{entry.dir.startsWith('local/') ? 'yours' : 'shared'}</span>
    </button>
  )
}

function SetList({ sel, version, onSelect }: Readonly<{ sel: Selection; version: number; onSelect: (s: Selection) => void }>) {
  const { state } = useEditor()
  const entries = state.iconSets.map((n) => state.icons.sets.get(n)).filter((e): e is IconSetEntry => e !== undefined)
  return (
    <>
      <div className={STYLE.heading}>
        <span>Icon sets</span>
        <span>{entries.length}</span>
      </div>
      <ul aria-label="Icon sets" className="m-0 list-none p-0">
        {entries.map((e) => (
          <li key={e.name}>
            <SetItem entry={e} on={sel.kind === 'set' && sel.name === e.name} version={version} onChoose={() => onSelect({ kind: 'set', name: e.name })} />
          </li>
        ))}
      </ul>
      <button type="button" className={`${STYLE.button} mt-2 w-full`} onClick={() => onSelect({ kind: 'new' })}>
        + New icon set
      </button>
      <div className={`${STYLE.heading} mt-5`}>
        <span>Generated</span>
      </div>
      <button type="button" aria-pressed={sel.kind === 'empty'} className={itemClass(sel.kind === 'empty')} onClick={() => onSelect({ kind: 'empty' })}>
        Empty key frames
      </button>
    </>
  )
}

function UsageList({ title, items }: Readonly<{ title: string; items: readonly string[] }>) {
  return (
    <>
      <p className={STYLE.label}>{title}</p>
      {items.length === 0 ? (
        <p className="text-zinc-600">None</p>
      ) : (
        <ul className="m-0 list-none p-0 text-zinc-300">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </>
  )
}

const where = (key: string | null, size: string | null) => (key === null || size === null ? 'parked' : `key ${key}, ${size}`)

function Usage({ usage }: Readonly<{ usage: SetUsage }>) {
  return (
    <>
      <UsageList title="Layers" items={usage.layers.map((l) => `${l.title} (${where(l.key, l.size)})`)} />
      <UsageList title="Key sizes" items={usage.sizes.map((s) => s.replace('x', '×'))} />
      <UsageList title="Macro icons" items={usage.macros.map((m) => `${m.macro} on ${m.layer} (key ${m.key}, ${m.size})`)} />
    </>
  )
}

/** The text of a set's icon.json, read again after every write; null when there is none. */
function useRecipeText(dir: string | null, version: number): string | null {
  const { state } = useEditor()
  const { folder } = state
  const [loaded, setLoaded] = useState<{ key: string; text: string | null } | null>(null)
  const key = `${dir}:${version}`
  useEffect(() => {
    if (dir === null) return
    let live = true
    readText(folder, `${dir}/icon.json`)
      .then((text) => {
        if (live) setLoaded({ key, text })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [folder, dir, key])
  return loaded?.key === key ? loaded.text : null
}

function SetDetails({ entry, version }: Readonly<{ entry: IconSetEntry; version: number }>) {
  const { state } = useEditor()
  const usage = useMemo(() => setUsage(state.ws, entry.name), [state.ws, entry.name])
  const recipe = useRecipeText(entry.dir, version)
  return (
    <>
      <h3 className={STYLE.heading}>Used by</h3>
      <Usage usage={usage} />
      <h3 className={`${STYLE.heading} mt-5`}>Saved recipe</h3>
      {recipe === null ? (
        <p className="text-zinc-600">No icon.json: the set was not made with this tab.</p>
      ) : (
        <pre className="m-0 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">{recipe}</pre>
      )}
    </>
  )
}

function Details({ sel, entry, version }: Readonly<{ sel: Selection; entry: IconSetEntry | undefined; version: number }>) {
  if (sel.kind === 'set' && entry) return <SetDetails entry={entry} version={version} />
  if (sel.kind === 'empty') {
    return <p className="text-zinc-500">The frames go to <code className="font-mono">img/</code>, next to <code className="font-mono">empty.png</code>. A key of a size with no frame of its own shows <code className="font-mono">empty.png</code>.</p>
  }
  if (sel.kind === 'new') return <p className="text-zinc-500">A new set is not used by anything until a layer or a macro picks it.</p>
  return <p className="text-zinc-500">Choose an icon set.</p>
}

/** The Icons tab: icon sets drawn from one picture for any key size, and the empty key frames. */
export function IconsTab() {
  const { state } = useEditor()
  const [sel, setSel] = useState<Selection>({ kind: 'none' })
  // Bumped after every write: what the tab shows from the disk is then read again.
  const [version, setVersion] = useState(0)
  const entry = sel.kind === 'set' ? state.icons.sets.get(sel.name) : undefined
  const saved = (name?: string) => {
    setVersion((v) => v + 1)
    if (name !== undefined) setSel({ kind: 'set', name })
  }
  return (
    <>
      <LeftPanel>
        <SetList sel={sel} version={version} onSelect={setSel} />
      </LeftPanel>
      <CentrePanel>
        {sel.kind === 'none' && <p className="text-zinc-400">Choose an icon set to redraw it, or make a new one.</p>}
        {sel.kind === 'new' && <IconSetEditor key="new" set={null} version={version} onSaved={saved} />}
        {sel.kind === 'set' && entry && <IconSetEditor key={entry.dir} set={entry} version={version} onSaved={saved} />}
        {sel.kind === 'empty' && <IconEmptyFrames key="empty" version={version} onSaved={saved} />}
      </CentrePanel>
      <RightPanel preview={false}>
        <Details sel={sel} entry={entry} version={version} />
      </RightPanel>
    </>
  )
}
