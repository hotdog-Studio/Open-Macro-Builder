import { useMemo, useState } from 'react'
import { filterSections, listSections, type DictEntry, type Dictionary, type ListGroup } from '../core/commands/dictionary'
import type { LangId } from '../core/languages'
import { DocCard } from './code/DocCard'
import { useDocHover, type RowHoverFor } from './DocHover'
import { STYLE } from './Panels'

const CLOSING: Record<LangId, string> = {
  ahk: "AutoHotkey's own functions, such as Send and Run, are not listed here. They are described at autohotkey.com/docs/v2.",
  ps: "PowerShell's own cmdlets are not listed here.",
}

/** What names a group in the set of toggled ones: its list and its key, as a file can stand in both lists. */
const stateKey = (title: string, list: ListGroup) => `${title}/${list.group.key}`

function Row({
  entry,
  expanded,
  onToggle,
  hover,
}: Readonly<{ entry: DictEntry; expanded: boolean; onToggle: () => void; hover: RowHoverFor }>) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        className="block w-full rounded-md px-2 py-1 text-left hover:bg-zinc-800"
        {...hover(entry, onToggle)}
      >
        <span className="block truncate font-mono text-[12px] text-zinc-200">{entry.fn.name}</span>{' '}
        {entry.summary !== '' && <span className="block truncate text-[10px] text-zinc-500">{entry.summary}</span>}
      </button>
      {expanded && (
        <div className="mx-2 mb-1 rounded-md border border-zinc-800 bg-zinc-950">
          <DocCard entry={entry} />
        </div>
      )}
    </li>
  )
}

function Group({
  list,
  open,
  onToggle,
  expanded,
  onToggleRow,
  hover,
}: Readonly<{
  list: ListGroup
  open: boolean
  onToggle: () => void
  expanded: Set<string>
  onToggleRow: (key: string) => void
  hover: RowHoverFor
}>) {
  const { group, entries } = list
  return (
    <li className="mb-1">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-baseline gap-1.5 rounded-md px-2 py-1 text-left text-zinc-300 hover:bg-zinc-800"
        onClick={onToggle}
      >
        <span aria-hidden="true" className="w-2 shrink-0 text-[9px] text-zinc-500">
          {open ? '▾' : '▸'}
        </span>
        <span className="truncate">{group.label}</span>{' '}
        {group.file && <span className="truncate font-mono text-[10px] text-zinc-500">{group.file}</span>}{' '}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{entries.length}</span>
      </button>
      {open && (
        <ul className="ml-3 space-y-0.5">
          {entries.map((entry) => (
            // The id survives the file being retyped, so a row keeps its open docs.
            <Row
              key={entry.id}
              entry={entry}
              expanded={expanded.has(entry.id)}
              onToggle={() => onToggleRow(entry.id)}
              hover={hover}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** The right panel's second list: what the shown language's commands can call, with the docs of each. */
export function OtherCommands({ dict }: Readonly<{ dict: Dictionary }>) {
  const [query, setQuery] = useState('')
  // A group's own state by list and key, for the ones the user has toggled; the others keep their starting state.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  // The same while the filter has text, where every group starts open; forgotten when the filter changes.
  const [filteredToggled, setFilteredToggled] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const row = useDocHover()
  const all = useMemo(() => listSections(dict), [dict])
  const sections = useMemo(() => filterSections(all, query), [all, query])
  const filtering = query.trim() !== ''

  // The filtered view and the whole list each keep their own groups' states, so neither changes the other.
  const states = filtering ? filteredToggled : toggled
  const setStates = filtering ? setFilteredToggled : setToggled
  const start = (initially: boolean) => filtering || initially
  const isOpen = (key: string, initially: boolean) => states[key] ?? start(initially)
  const toggleGroup = (key: string, initially: boolean) => setStates((was) => ({ ...was, [key]: !(was[key] ?? start(initially)) }))
  const toggleRow = (key: string) =>
    setExpanded((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const section = (title: string, groups: ListGroup[], initially: boolean) =>
    groups.length > 0 && (
      <>
        <h4 className={`${STYLE.heading} mt-3`}>{title}</h4>
        <ul>
          {groups.map((list) => (
            <Group
              key={list.group.key}
              list={list}
              // While the filter has text, a group with a match starts open; its own state comes back after.
              open={isOpen(stateKey(title, list), initially)}
              onToggle={() => toggleGroup(stateKey(title, list), initially)}
              expanded={expanded}
              onToggleRow={toggleRow}
              hover={row}
            />
          ))}
        </ul>
      </>
    )

  return (
    <section aria-label="Other commands available" className="mt-6">
      <h3 className={STYLE.heading}>Other commands available</h3>
      <p className="text-[11px] text-zinc-500">What your commands can call. Hover a name for its docs.</p>
      <input
        type="text"
        aria-label="Filter other commands"
        placeholder="Filter"
        className={`${STYLE.input} mt-2`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setFilteredToggled({})
        }}
      />
      {section('Functions to call', sections.functions, true)}
      {section('Commands in other files', sections.commands, false)}
      {filtering && sections.functions.length === 0 && sections.commands.length === 0 && (
        <p className={STYLE.note}>Nothing matches.</p>
      )}
      <p className={STYLE.note}>{CLOSING[dict.lang]}</p>
    </section>
  )
}
