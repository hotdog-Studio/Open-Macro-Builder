import { Fragment, useMemo, useState } from 'react'
import { pairOutline, paramMismatches, type OutlineEntry, type PairTexts, type ParamMismatch } from '../core/commands/outline'
import { commandCount, commandPairs, languagesDiffer, type CommandPair } from '../core/commands/pairs'
import { keysUsing } from '../core/commands/usage'
import { EncodingError } from '../core/folder/textFile'
import { LANG_IDS, LANGUAGES, type CommandFile, type LangId } from '../core/languages'
import { shownPair, type CommandDialog } from '../state/commandsSlice'
import { useEditor } from '../state/store'
import { CodeEditor } from './code/CodeEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { LeftPanel, RightPanel, STYLE } from './Panels'

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A small coloured mark with a name for screen readers. */
function Dot({ label, tone }: Readonly<{ label: string; tone: string }>) {
  return (
    <span role="img" aria-label={label} title={label} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
  )
}

const UnsavedDot = () => <Dot label="unsaved changes" tone="bg-amber-300" />

/** True when the pair's file in one of `langs` has a key in `byPath` (a draft, an outside change). */
function pairHas(pair: CommandPair, byPath: Record<string, unknown>, langs: LangId[] = LANG_IDS): boolean {
  return langs.some((l) => {
    const file = pair.files[l]
    return file !== undefined && file.file.path in byPath
  })
}

/** `AHK 3 · PS 3`, with a dash for a missing file. */
const counts = (pair: CommandPair) =>
  LANG_IDS.map((l) => {
    const file = pair.files[l]
    return `${LANGUAGES[l].short} ${file ? commandCount(file) : '—'}`
  }).join(' · ')

function PairList({ title, pairs, shown }: Readonly<{ title: string; pairs: CommandPair[]; shown: string | undefined }>) {
  const { state, dispatch } = useEditor()
  return (
    <section className="mb-4">
      <h3 className={STYLE.heading}>{title}</h3>
      <ul className="space-y-0.5">
        {pairs.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              aria-current={p.key === shown || undefined}
              className={`flex w-full flex-col rounded-md px-2 py-1 text-left ${
                p.key === shown ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
              onClick={() => dispatch({ type: 'commands-show', pair: p.key })}
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate font-mono text-[12px]">{p.pair}</span>
                {languagesDiffer(p) && <Dot label="languages differ" tone="bg-red-400" />}
                {pairHas(p, state.commands.drafts) && <UnsavedDot />}
                {pairHas(p, state.commands.outside) && <Dot label="changed on disk" tone="bg-orange-500" />}
              </span>
              <span className="text-[10px] text-zinc-500">{counts(p)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** What the centre says when the chosen language has no file for the pair. */
function missingText(pair: CommandPair, lang: LangId, running: LangId[]): string {
  const label = LANGUAGES[lang].label
  return running.includes(lang)
    ? `There is no ${label} file for ${pair.pair} yet. Its commands will not load in ${label}, which you run.`
    : `There is no ${label} file for ${pair.pair}. That's fine: you don't run ${label}.`
}

/** The AutoHotkey | PowerShell toggle, each with a dot when its file in the pair has a draft. */
function LanguageButtons({ pair }: Readonly<{ pair: CommandPair }>) {
  const { state, dispatch } = useEditor()
  const { lang, drafts } = state.commands
  return (
    <div className="flex gap-1">
      {LANG_IDS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === lang}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
            l === lang ? 'border-sky-500 bg-sky-500/15 text-sky-100' : 'border-zinc-700 hover:bg-zinc-800'
          }`}
          onClick={() => dispatch({ type: 'commands-show', lang: l })}
        >
          {LANGUAGES[l].label}
          {pairHas(pair, drafts, [l]) && <UnsavedDot />}
        </button>
      ))}
    </div>
  )
}

/** The toolbar's file controls and the editor of one command file. */
function FileView({ pair, file }: Readonly<{ pair: CommandPair; file: CommandFile }>) {
  const { state, dispatch, actions } = useEditor()
  const { drafts, saved, jump, outside } = state.commands
  const [confirmReload, setConfirmReload] = useState(false)
  const path = file.file.path
  const name = fileName(path)
  const draft = drafts[path]
  const label = LANGUAGES[file.lang].label
  const reload = () => {
    setConfirmReload(false)
    void actions.reloadCommandFile(path)
  }
  /** Reload from disk, in the toolbar and the banner: asks first when there are unsaved changes. */
  const askReload = () => (draft === undefined ? reload() : setConfirmReload(true))
  return (
    <>
      <div role="toolbar" aria-label="Command file" className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <LanguageButtons pair={pair} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">{path}</span>
        <button type="button" className={STYLE.button} onClick={askReload}>
          Reload from disk
        </button>
        {file.editable && (
          <button
            type="button"
            disabled={draft === undefined}
            className="rounded-md bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void actions.saveCommandFile(path)}
          >
            Save {name}
          </button>
        )}
      </div>
      {outside[path] && !outside[path].dismissed && (
        <div role="alert" className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-200">
          <p className="flex-1">{`${name} changed on disk.`}</p>
          <button
            type="button"
            className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[12px] hover:bg-amber-500/20"
            onClick={askReload}
          >
            Reload from disk
          </button>
          <button
            type="button"
            className="rounded-md px-2 text-[12px] opacity-80 hover:opacity-100"
            onClick={() => dispatch({ type: 'command-dismiss', path })}
          >
            Dismiss
          </button>
        </div>
      )}
      {!file.editable && (
        <p className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-200">{new EncodingError(path).message}</p>
      )}
      <div className="min-h-0 flex-1">
        <CodeEditor
          docKey={path}
          lang={file.lang}
          value={draft ?? file.file.text}
          // The version whose text the editor holds: the editor takes a new value only after
          // React commits it, so a keystroke before then is made on this version's text.
          onChange={(text) => actions.editCommand(path, text, file.file.version)}
          label={`${label} code`}
          readOnly={!file.editable}
          jump={jump?.path === path ? { line: jump.line, n: jump.n } : null}
          onSave={() => void actions.saveCommandFile(path)}
        />
      </div>
      {saved[path] && (
        <p role="status" className="border-t border-zinc-800 px-4 py-1.5 text-[12px] text-emerald-300">
          {`Saved ${name}.`}
        </p>
      )}
      {confirmReload && (
        <ConfirmDialog
          title={`Discard your changes to ${name}?`}
          onCancel={() => setConfirmReload(false)}
          choices={[{ label: 'Discard and reload', danger: true, onChoose: reload }]}
        />
      )}
    </>
  )
}

/** The conflict dialog of a command file save and its Overwrite anyway confirmation. */
function CommandDialogView({ dialog }: Readonly<{ dialog: CommandDialog }>) {
  const { dispatch, actions } = useEditor()
  const { path } = dialog
  const close = () => dispatch({ type: 'command-dialog', dialog: null })
  if (dialog.kind === 'conflict') {
    return (
      <ConfirmDialog
        title={`${fileName(path)} changed on disk since you opened it.`}
        onCancel={close}
        choices={[
          { label: 'Reload from disk', onChoose: () => void actions.reloadCommandFile(path) },
          {
            label: 'Overwrite anyway',
            danger: true,
            onChoose: () => dispatch({ type: 'command-dialog', dialog: { kind: 'confirm-overwrite', path } }),
          },
        ]}
      >
        <p>
          Something else edited <code className="font-mono">{path}</code> after the configurator loaded it, so nothing
          was saved. Reload from disk shows that version and drops your unsaved edits; Overwrite anyway replaces it
          with yours.
        </p>
      </ConfirmDialog>
    )
  }
  return (
    <ConfirmDialog
      title="Overwrite anyway?"
      onCancel={close}
      choices={[
        {
          label: 'Overwrite anyway',
          danger: true,
          onChoose: () => {
            close()
            void actions.saveCommandFile(path, { force: true })
          },
        },
      ]}
    >
      <p>
        The other edit to <code className="font-mono">{path}</code> is replaced by yours. A copy of it is kept as{' '}
        <code className="font-mono">{path}.bak</code>.
      </p>
    </ConfirmDialog>
  )
}

/** Mark of one language in an outline entry: green when it has the command, else a gap. */
function LangMark({ lang, has }: Readonly<{ lang: LangId; has: boolean }>) {
  const { settings } = useEditor().state
  // A gap in a language you run is a problem (red); in another it is information only (amber).
  const gap = settings.languages.includes(lang) ? 'text-red-400' : 'text-amber-400'
  return <span className={has ? 'text-emerald-400' : gap}>{`${LANGUAGES[lang].short} ${has ? '✓' : '✗'}`}</span>
}

/** Where the selected command sits in each language, and which keys use it. */
function EntryDetails({ entry }: Readonly<{ entry: OutlineEntry }>) {
  const { ws } = useEditor().state
  const uses = keysUsing(ws, entry.name)
  const description = LANG_IDS.map((l) => entry.in[l]?.description).find(Boolean)
  return (
    <div className="mt-4 border-t border-zinc-800 pt-3">
      {description && <p className="mb-1 text-zinc-300">{description}</p>}
      {LANG_IDS.map((l) => {
        const at = entry.in[l]
        const where = at ? 'line ' + at.line : 'missing'
        return (
          <p key={l} className="text-[11px] text-zinc-400">
            {`${LANGUAGES[l].label}: ${where}`}
          </p>
        )
      })}
      <h4 className={`${STYLE.heading} mt-3`}>Used by</h4>
      {uses.length === 0 ? (
        <p className="text-zinc-500">Not used in the current layout.</p>
      ) : (
        <ul className="space-y-0.5 text-[11px] text-zinc-300">
          {uses.map((u) => (
            <li key={`${u.parked}\0${u.layer}\0${u.key}`}>{`${u.layer} · ${u.key}${u.parked ? ' (parked)' : ''}`}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The right panel: every command of the shown pair with its gaps, and the details of one. */
function Outline({ pair }: Readonly<{ pair: CommandPair }>) {
  const { state, dispatch, actions } = useEditor()
  const { lang, drafts } = state.commands
  const [selected, setSelected] = useState<string | null>(null)
  // The text the editors hold, so the outline follows typing.
  const texts = useMemo(() => {
    const out: PairTexts = {}
    for (const l of LANG_IDS) {
      const file = pair.files[l]
      if (file) out[l] = drafts[file.file.path] ?? file.file.text
    }
    return out
  }, [pair, drafts])
  const outline = useMemo(() => pairOutline(texts), [texts])
  const mismatches = useMemo(() => paramMismatches(texts), [texts])
  const chosen = outline.find((e) => e.name.toLowerCase() === selected)

  const open = (entry: OutlineEntry) => {
    setSelected(entry.name.toLowerCase())
    const has = LANG_IDS.filter((l) => entry.in[l])
    const target = entry.in[lang] ? lang : (has.find((l) => state.settings.languages.includes(l)) ?? has[0])
    const at = entry.in[target]
    const file = pair.files[target]
    if (!at || !file) return
    // Showing another file clears a pending jump, so the language comes first.
    if (target !== lang) dispatch({ type: 'commands-show', lang: target })
    dispatch({ type: 'jump', path: file.file.path, line: at.line })
  }

  const rename = (m: ParamMismatch) => {
    const file = pair.files[m.lang]
    const current = texts[m.lang]
    if (!file || current === undefined) return
    const fn = LANGUAGES[m.lang].findFunctions(current).find((f) => f.line === m.line && f.name === m.name)
    if (!fn) return
    actions.editCommand(file.file.path, LANGUAGES[m.lang].renameParam(current, fn, 'Macro'), file.file.version)
    dispatch({ type: 'commands-show', lang: m.lang })
  }

  return (
    <section aria-label="Commands in this file">
      <h3 className={STYLE.heading}>Commands in this file</h3>
      <ul className="space-y-0.5">
        {outline.map((e) => (
          <li key={e.name.toLowerCase()}>
            <button
              type="button"
              aria-current={e === chosen || undefined}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left ${
                e === chosen ? 'bg-zinc-700' : 'hover:bg-zinc-800'
              }`}
              onClick={() => open(e)}
            >
              <span className="truncate font-mono text-[12px] text-zinc-200">{e.name}</span>{' '}
              <span className="flex shrink-0 gap-2 text-[10px]">
                {LANG_IDS.map((l, i) => (
                  <Fragment key={l}>
                    {i > 0 && ' '}
                    <LangMark lang={l} has={e.in[l] !== undefined} />
                  </Fragment>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {mismatches.map((m) => (
        <div key={`${m.lang}:${m.name}`} className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
          <p>{`${LANGUAGES[m.lang].label} defines ${m.name} with the parameter "${m.param}" instead of "Macro", so it does not count as a command.`}</p>
          {pair.files[m.lang]?.editable && (
            <button type="button" className={`${STYLE.button} mt-2`} onClick={() => rename(m)}>
              Rename the parameter to Macro
            </button>
          )}
        </div>
      ))}
      {chosen && <EntryDetails entry={chosen} />}
    </section>
  )
}

/** The Commands tab: each command file pair, and an editor for one language of the chosen pair. */
export function CommandsTab() {
  const { state } = useEditor()
  const { commandFiles, settings } = state
  const { lang, dialog } = state.commands
  const pairs = useMemo(() => commandPairs(commandFiles), [commandFiles])
  const pair = shownPair(pairs, state.commands.pair)
  const file = pair?.files[lang]
  return (
    <>
      <LeftPanel>
        <nav aria-label="Command files">
          <PairList title="Yours" pairs={pairs.filter((p) => p.group === 'yours')} shown={pair?.key} />
          <PairList title="Shared" pairs={pairs.filter((p) => p.group === 'shared')} shown={pair?.key} />
        </nav>
      </LeftPanel>
      <main className="flex min-w-0 flex-1 flex-col">
        {pair && file && <FileView key={file.file.path} pair={pair} file={file} />}
        {pair && !file && (
          <>
            <div role="toolbar" aria-label="Command file" className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
              <LanguageButtons pair={pair} />
            </div>
            <p className="p-5 text-zinc-400">{missingText(pair, lang, settings.languages)}</p>
          </>
        )}
        {!pair && <p className="p-5 text-zinc-500">There are no command files yet.</p>}
      </main>
      <RightPanel preview={false}>{pair && <Outline key={pair.key} pair={pair} />}</RightPanel>
      {dialog && <CommandDialogView dialog={dialog} />}
    </>
  )
}
