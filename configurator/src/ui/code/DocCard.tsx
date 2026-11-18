import { sourceText, type DictEntry } from '../../core/commands/dictionary'
import { LANGUAGES, type ParamDoc } from '../../core/languages'

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-zinc-500'
const CODE = 'whitespace-pre-wrap break-words font-mono text-[12px] text-zinc-100'

/** What the docs say about one parameter besides its note: whether it can be left out, and its allowed values. */
function paramNotes(p: ParamDoc): string[] {
  const notes: string[] = []
  if (p.default !== '') notes.push(`Optional, ${p.default} when left out.`)
  else if (p.optional) notes.push('Optional.')
  if (p.values.length > 0) notes.push(`One of: ${p.values.join(', ')}.`)
  return notes
}

function ParamRow({ param }: Readonly<{ param: ParamDoc }>) {
  const notes = paramNotes(param)
  if (param.text === '' && notes.length === 0) return null
  return (
    <li className="flex flex-col">
      <span className="font-mono text-[12px] text-sky-200">{param.name}</span>
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
  const params = fn.doc.params.filter((p) => p.text !== '' || paramNotes(p).length > 0)
  return (
    <div className="max-w-md select-text space-y-2 p-3 text-[12px] text-zinc-300">
      <p className={CODE}>{fn.usage}</p>
      <p className={summary === '' ? 'text-zinc-500' : 'text-zinc-200'}>{summary === '' ? 'No description.' : summary}</p>
      {borrowed && <p className="text-[11px] text-zinc-500">{`From the ${LANGUAGES[borrowed].label} version`}</p>}
      {fn.doc.examples.map((example) => (
        <div key={example} className="space-y-1">
          <p className={LABEL}>Example</p>
          <pre className={`${CODE} rounded-md border border-zinc-800 bg-zinc-950 p-2`}>{example}</pre>
        </div>
      ))}
      {params.length > 0 && (
        <ul className="space-y-1.5">
          {fn.doc.params.map((p) => (
            <ParamRow key={p.name} param={p} />
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
