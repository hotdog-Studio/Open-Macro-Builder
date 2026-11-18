import { sourceText, type DictEntry } from '../../core/commands/dictionary'
import { LANGUAGES, type ParamDoc } from '../../core/languages'

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-zinc-500'
const CODE = 'whitespace-pre-wrap break-words font-mono text-[12px] text-zinc-100'

/** A default as a novice reads it: empty quotes are "empty", a switch is on or off; null when it says nothing worth saying. */
function plainDefault(p: ParamDoc): string | null {
  const value = p.default
  if (value === '""' || value === "''") return 'empty'
  const lower = value.toLowerCase()
  if (lower === '$null') return null
  if (p.type.toLowerCase() === 'switch' && (lower === '$true' || lower === '$false')) return lower === '$true' ? 'on' : 'off'
  return value
}

/** What the docs say about one parameter besides its note: whether it can be left out, and its allowed values. */
function paramNotes(p: ParamDoc): string[] {
  const notes: string[] = []
  const value = p.default === '' ? null : plainDefault(p)
  if (value !== null) notes.push(`Optional, ${value} when left out.`)
  else if (p.optional) notes.push('Optional.')
  if (p.values.length > 0) notes.push(`One of: ${p.values.join(', ')}.`)
  return notes
}

/** The type worth showing beside the name: none when it is the same word as the name (`{Macro} Macro`). */
const typeOf = (p: ParamDoc): string => (p.type.toLowerCase() === p.name.toLowerCase() ? '' : p.type)

function ParamRow({ param, notes }: Readonly<{ param: ParamDoc; notes: string[] }>) {
  const type = typeOf(param)
  return (
    <li className="flex flex-col">
      <span>
        <span className="font-mono text-[12px] text-sky-200">{param.name}</span>
        {type !== '' && <span className="font-mono text-[11px] text-zinc-500">{` ${type}`}</span>}
      </span>
      {param.text !== '' && <span className="text-zinc-300">{param.text}</span>}
      {notes.map((note) => (
        <span key={note} className="text-zinc-400">
          {note}
        </span>
      ))}
    </li>
  )
}

/** What the docs of a function say: how to call it, what it does, an example, each parameter, and where it is. */
export function DocCard({ entry }: Readonly<{ entry: DictEntry }>) {
  const { fn, summary, borrowed, source } = entry
  // A parameter gets a row when anything is known of it: a note, a type, a default or its values.
  const rows = fn.doc.params
    .map((param) => ({ param, notes: paramNotes(param) }))
    .filter(({ param, notes }) => param.text !== '' || typeOf(param) !== '' || notes.length > 0)
  return (
    <div className="max-w-md select-text space-y-2 p-3 text-[12px] text-zinc-300">
      <p className={CODE}>{fn.usage}</p>
      <p className={summary === '' ? 'text-zinc-500' : 'text-zinc-200'}>{summary === '' ? 'No description.' : summary}</p>
      {borrowed && <p className="text-[11px] text-zinc-500">{`From the ${LANGUAGES[borrowed].label} version`}</p>}
      {fn.doc.examples.map((example, i) => (
        // The same example can be written twice, so its place tells the two apart.
        <div key={`${i}\0${example}`} className="space-y-1">
          <p className={LABEL}>Example</p>
          <pre className={`${CODE} rounded-md border border-zinc-800 bg-zinc-950 p-2`}>{example}</pre>
        </div>
      ))}
      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map(({ param, notes }, i) => (
            // A half-typed list can declare a name twice.
            <ParamRow key={`${i}\0${param.name}`} param={param} notes={notes} />
          ))}
        </ul>
      )}
      {fn.doc.returns !== '' && (
        <div className="space-y-1">
          <p className={LABEL}>Returns</p>
          <p className="text-zinc-300">{fn.doc.returns}</p>
        </div>
      )}
      <p className="font-mono text-[11px] text-zinc-500">{sourceText(source)}</p>
    </div>
  )
}
