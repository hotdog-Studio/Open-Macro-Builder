import { DragOverlay, useDndContext, useDraggable } from '@dnd-kit/core'
import { useEffect, useId, useMemo, useState } from 'react'
import type { Layer, PadKey, Workspace } from '../core/config/model'
import { findLayer, setMacro, updateMacro } from '../core/config/ops'
import { definedNames, LANG_IDS, LANGUAGES, type CatalogEntry, type LangId } from '../core/languages'
import { useEditor } from '../state/store'
import { LayerIcon } from './LayersTab'
import { PadDnd, PadGrid } from './PadGrid'
import { CentrePanel, LeftPanel, RightPanel, STYLE } from './Panels'
import { useAsset } from './useAsset'

/** The layers that sit on a key, in key order. */
function slottedLayers(ws: Workspace): Layer[] {
  return ws.keys.flatMap((k) => (ws.slots[k.id] ? [ws.slots[k.id]] : []))
}

/**
 * The layer the grid shows: the selected one if it sits on a key, else the start layer, else the first.
 * Parked layers have no key, so they are never shown here.
 */
function shownLayer(ws: Workspace, selected: string | null): Layer | undefined {
  const layers = slottedLayers(ws)
  const chosen = selected === null ? undefined : layers.find((l) => l.id === selected)
  const start = ws.options.defaultKey === null ? undefined : ws.slots[ws.options.defaultKey]
  return chosen ?? start ?? layers[0]
}

/** For each language, the lower-cased names it defines; the same sets save validation uses. */
function useDefinedNames(): Record<LangId, Set<string>> {
  const { commandFiles } = useEditor().state
  return useMemo(() => {
    const sets = {} as Record<LangId, Set<string>>
    for (const lang of LANG_IDS) sets[lang] = definedNames(commandFiles, lang)
    return sets
  }, [commandFiles])
}

/** The languages you run that do not define the command. A name counts however its file pair is named. */
function useMissingIn(): (command: string) => LangId[] {
  const names = useDefinedNames()
  const { languages } = useEditor().state.settings
  return (command) => languages.filter((l) => !names[l].has(command.toLowerCase()))
}

const shortList = (langs: LangId[]) => langs.map((l) => LANGUAGES[l].short).join(', ')

function KeyFace({ k, layer, missingIn }: Readonly<{ k: PadKey; layer: Layer | undefined; missingIn: (c: string) => LangId[] }>) {
  if (k.id === 'fn') {
    return (
      <span className="flex h-full w-full items-center justify-center rounded-[7px] border border-amber-600 bg-amber-950/60 text-[10px] text-amber-300">
        <b className="mr-1">Fn</b>
        {k.key}
      </span>
    )
  }
  const macro = layer?.macros[k.id]
  if (!macro) {
    return (
      <span className="flex h-full w-full items-center justify-center rounded-[7px] border border-dashed border-zinc-600 text-[10px] text-zinc-600">
        {k.key}
      </span>
    )
  }
  const missing = missingIn(macro.action)
  return (
    <span
      className={`flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[7px] border bg-zinc-800 text-[10px] ${
        missing.length > 0 ? 'border-red-500 text-red-300' : 'border-zinc-500 text-zinc-300'
      }`}
    >
      <span>{k.key}</span>
      {/* The space keeps the button's name readable: "F16 not in AHK". */}{' '}
      {missing.length > 0 && <span className="text-[9px] leading-none text-red-400">not in {shortList(missing)}</span>}
    </span>
  )
}

function LayerButtons({ layers, shown }: Readonly<{ layers: Layer[]; shown: string }>) {
  const { dispatch } = useEditor()
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {layers.map((l) => (
        <button
          key={l.id}
          type="button"
          aria-pressed={l.id === shown}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
            l.id === shown ? 'border-sky-500 bg-sky-500/15 text-sky-100' : 'border-zinc-700 hover:bg-zinc-800'
          }`}
          onClick={() => dispatch({ type: 'select', layer: l.id })}
        >
          <LayerIcon icon={l.icon} title="" className="h-5 w-5" />
          {l.title}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- the command palette

interface Group {
  id: string
  pair: string
  yours: boolean
  entries: CatalogEntry[]
}

/** The catalog grouped by file pair, in catalog order (yours first). */
function groupByPair(entries: CatalogEntry[]): Group[] {
  const groups = new Map<string, Group>()
  for (const e of entries) {
    const id = `${e.group}\0${e.pair}`
    let g = groups.get(id)
    if (!g) {
      g = { id, pair: e.pair, yours: e.group === 'yours', entries: [] }
      groups.set(id, g)
    }
    g.entries.push(e)
  }
  return [...groups.values()]
}

const matches = (e: CatalogEntry, q: string) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)

const CHIP = 'mb-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1'

function CommandItem({ entry, missing }: Readonly<{ entry: CatalogEntry; missing: LangId[] }>) {
  // Unique per row: one command can be listed under two file pairs, and dnd-kit keys by id.
  const dragId = `cmd:${entry.group}/${entry.pair}/${entry.name}`
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: dragId })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-command={entry.name}
      data-drag-id={dragId}
      title={entry.description || undefined}
      className={`${CHIP} cursor-grab touch-none select-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-zinc-200">{entry.name}</span>
        <span className="flex shrink-0 gap-1">
          {missing.map((l) => (
            <span key={l} className="rounded bg-red-950 px-1 text-[9px] text-red-300">
              no {LANGUAGES[l].short}
            </span>
          ))}
        </span>
      </div>
      {entry.description && <p className="truncate text-[10px] text-zinc-500">{entry.description}</p>}
    </div>
  )
}

/** The command being dragged follows the pointer even outside the side panel, which would clip it. */
function DraggedCommand() {
  const { active } = useDndContext()
  const id = String(active?.id ?? '')
  return (
    <DragOverlay>
      {id.startsWith('cmd:') ? (
        <div className={`${CHIP} cursor-grabbing font-mono text-[11px] text-zinc-200`}>{id.slice(id.lastIndexOf('/') + 1)}</div>
      ) : null}
    </DragOverlay>
  )
}

function Palette() {
  const { catalog } = useEditor().state
  const missingIn = useMissingIn()
  const [query, setQuery] = useState('')
  const searchId = useId()
  const q = query.trim().toLowerCase()
  const groups = useMemo(() => groupByPair(catalog.filter((e) => q === '' || matches(e, q))), [catalog, q])
  return (
    <section aria-label="Commands">
      <label htmlFor={searchId} className={STYLE.heading}>
        Commands
      </label>
      <input
        id={searchId}
        type="search"
        aria-label="Search commands"
        placeholder="Search commands"
        className={STYLE.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className={STYLE.note}>Drag a command onto a key.</p>
      {groups.map((g) => (
        <GroupList key={g.id} group={g} missingIn={missingIn} />
      ))}
      {groups.length === 0 && <p className="mt-3 text-zinc-500">No command matches.</p>}
    </section>
  )
}

function GroupList({ group, missingIn }: Readonly<{ group: Group; missingIn: (c: string) => LangId[] }>) {
  const heading = useId()
  return (
    <div role="group" aria-labelledby={heading} className="mt-3">
      <div className={STYLE.heading}>
        <span id={heading}>{group.pair}</span>
        {group.yours && <span className="rounded bg-sky-950 px-1 normal-case text-sky-300">yours</span>}
      </div>
      {group.entries.map((e) => (
        <CommandItem key={`${e.group}/${e.pair}/${e.name}`} entry={e} missing={missingIn(e.name)} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- the macro's details

function IconChoice({
  name,
  label,
  path,
  chosen,
  onChoose,
}: Readonly<{ name: string; label: string; path: string | null; chosen: boolean; onChoose: () => void }>) {
  const src = useAsset(path)
  return (
    <button
      type="button"
      title={name}
      aria-label={label}
      aria-pressed={chosen}
      className={`flex h-9 items-center justify-center rounded border p-1 text-[10px] ${
        chosen ? 'border-sky-500 bg-sky-500/15' : 'border-zinc-800 hover:border-zinc-600'
      }`}
      onClick={onChoose}
    >
      {src ? <img src={src} alt="" draggable={false} className="pointer-events-none h-7 w-7 object-contain" /> : path === null ? 'Layer' : null}
    </button>
  )
}

function MacroDetails({ layer, keyId, keyName }: Readonly<{ layer: Layer; keyId: string; keyName: string }>) {
  const { state, dispatch } = useEditor()
  const { ws, iconSets } = state
  const names = useDefinedNames()
  const ids = [useId(), useId(), useId(), useId()]
  const macro = layer.macros[keyId]
  const edit = (next: typeof ws) => dispatch({ type: 'edit', ws: next })
  if (!macro) {
    return (
      <>
        <h3 className={STYLE.heading}>{keyName}</h3>
        <p className="text-zinc-500">Nothing on this key yet. Drag a command from the list onto it.</p>
      </>
    )
  }
  const lower = macro.action.toLowerCase()
  return (
    <>
      <h3 className={STYLE.heading}>
        {layer.title} · {keyName}
      </h3>
      <label htmlFor={ids[0]} className={`${STYLE.label} mt-0`}>
        Command
      </label>
      <input id={ids[0]} readOnly className={`${STYLE.input} font-mono`} value={macro.action} />
      <div className="mt-1.5 flex gap-3 text-[11px]">
        {LANG_IDS.map((l) => {
          const ok = names[l].has(lower)
          return (
            <span key={l} className={ok ? 'text-emerald-400' : 'text-red-400'}>
              {`${LANGUAGES[l].label} ${ok ? '✓' : '✗'}`}
            </span>
          )
        })}
      </div>
      <label htmlFor={ids[1]} className={STYLE.label}>
        Label (shown on the overlay)
      </label>
      <input
        id={ids[1]}
        className={STYLE.input}
        value={macro.name}
        onChange={(e) => edit(updateMacro(ws, layer.id, keyId, { name: e.target.value }))}
      />
      <label htmlFor={ids[2]} className={STYLE.label}>
        Description (tooltip)
      </label>
      <input
        id={ids[2]}
        className={STYLE.input}
        value={macro.description ?? ''}
        onChange={(e) => edit(updateMacro(ws, layer.id, keyId, { description: e.target.value }))}
      />
      <p className={STYLE.label}>Icon (optional)</p>
      <div className="grid grid-cols-5 gap-1">
        <IconChoice
          name="Use the icon of the layer"
          label="Layer icon"
          path={null}
          chosen={macro.icon === undefined}
          onChoose={() => edit(updateMacro(ws, layer.id, keyId, { icon: '' }))}
        />
        {iconSets.map((set) => (
          <IconChoice
            key={set}
            name={set}
            label={set}
            path={`img/${set}/macro.png`}
            chosen={macro.icon === set}
            onChoose={() => edit(updateMacro(ws, layer.id, keyId, { icon: set }))}
          />
        ))}
      </div>
      <p className={STYLE.note}>Used when "Use per-macro icons" is on.</p>
      <button
        type="button"
        className={`${STYLE.button} mt-4 w-full`}
        onClick={() => edit(setMacro(ws, layer.id, keyId, null))}
      >
        Clear key
      </button>
    </>
  )
}

/** The Macros tab: what each key of a layer does, with the list of commands to drag onto the keys. */
export function MacrosTab() {
  const { state, dispatch } = useEditor()
  const { ws, selectedKey, selectedLayer } = state
  const missingIn = useMissingIn()
  const layers = slottedLayers(ws)
  const layer = shownLayer(ws, selectedLayer)
  const shownId = layer?.id ?? null

  // The grid's drops and drags edit the selected layer, so make the layer it shows the selected one.
  useEffect(() => {
    if (shownId !== null && shownId !== selectedLayer) dispatch({ type: 'select', layer: shownId })
  }, [shownId, selectedLayer, dispatch])

  const selected = selectedKey === null || selectedKey === 'fn' ? undefined : ws.keys.find((k) => k.id === selectedKey)
  return (
    <PadDnd mode="macros">
      <LeftPanel>
        <Palette />
      </LeftPanel>
      <CentrePanel>
        {layer ? (
          <>
            <LayerButtons layers={layers} shown={layer.id} />
            <PadGrid
              mode="macros"
              renderKey={(k) => <KeyFace k={k} layer={findLayer(ws, layer.id)} missingIn={missingIn} />}
              renderStrip={(k) => (k.id === 'fn' ? null : (layer.macros[k.id]?.name ?? null))}
            />
            <p className="text-[11px] text-zinc-500">
              Drag a command from the list onto a key · drag a key onto another to swap them
            </p>
          </>
        ) : (
          <p className="text-zinc-500">No layer is on a key yet. Put one on a key in the Layers tab.</p>
        )}
      </CentrePanel>
      <RightPanel>
        {layer && selected ? (
          <MacroDetails layer={layer} keyId={selected.id} keyName={selected.key} />
        ) : (
          <p className="text-zinc-500">Select a key.</p>
        )}
      </RightPanel>
      <DraggedCommand />
    </PadDnd>
  )
}
