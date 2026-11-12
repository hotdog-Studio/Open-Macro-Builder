import { useMemo, useState } from 'react'
import { commandCount, commandPairs, languagesDiffer, type CommandPair } from '../core/commands/pairs'
import { EncodingError } from '../core/folder/textFile'
import { LANG_IDS, LANGUAGES, type CommandFile, type LangId } from '../core/languages'
import type { CommandDialog } from '../state/commandsSlice'
import { useEditor } from '../state/store'
import { CodeEditor } from './code/CodeEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { LeftPanel, STYLE } from './Panels'

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A small coloured mark with a name for screen readers. */
function Dot({ label, tone }: Readonly<{ label: string; tone: string }>) {
  return (
    <span role="img" aria-label={label} title={label} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
  )
}

const UnsavedDot = () => <Dot label="unsaved changes" tone="bg-amber-300" />

/** True when the pair's file in one of `langs` has a draft. */
function hasDraft(pair: CommandPair, drafts: Record<string, string>, langs: LangId[] = LANG_IDS): boolean {
  return langs.some((l) => {
    const file = pair.files[l]
    return file !== undefined && file.file.path in drafts
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
                {hasDraft(p, state.commands.drafts) && <UnsavedDot />}
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
          {hasDraft(pair, drafts, [l]) && <UnsavedDot />}
        </button>
      ))}
    </div>
  )
}

/** The toolbar's file controls and the editor of one command file. */
function FileView({ pair, file }: Readonly<{ pair: CommandPair; file: CommandFile }>) {
  const { state, actions } = useEditor()
  const { drafts, saved, jump } = state.commands
  const [confirmReload, setConfirmReload] = useState(false)
  const path = file.file.path
  const name = fileName(path)
  const draft = drafts[path]
  const label = LANGUAGES[file.lang].label
  const reload = () => {
    setConfirmReload(false)
    void actions.reloadCommandFile(path)
  }
  return (
    <>
      <div role="toolbar" aria-label="Command file" className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <LanguageButtons pair={pair} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">{path}</span>
        <button type="button" className={STYLE.button} onClick={() => (draft === undefined ? reload() : setConfirmReload(true))}>
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
      {!file.editable && (
        <p className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-200">{new EncodingError(path).message}</p>
      )}
      <div className="min-h-0 flex-1">
        <CodeEditor
          docKey={path}
          lang={file.lang}
          value={draft ?? file.file.text}
          onChange={(text) => actions.editCommand(path, text)}
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

/** The Commands tab: each command file pair, and an editor for one language of the chosen pair. */
export function CommandsTab() {
  const { state } = useEditor()
  const { commandFiles, settings } = state
  const { lang, dialog } = state.commands
  const pairs = useMemo(() => commandPairs(commandFiles), [commandFiles])
  const pair = pairs.find((p) => p.key === state.commands.pair) ?? pairs[0]
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
      {dialog && <CommandDialogView dialog={dialog} />}
    </>
  )
}
