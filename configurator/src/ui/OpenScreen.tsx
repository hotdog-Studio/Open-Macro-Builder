import { useState, type ReactNode } from 'react'
import { LANG_IDS, LANGUAGES } from '../core/languages'
import { useApp, type SetupState } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'
import { DownloadLink } from './DownloadLink'
import { NewFolderDialog } from './NewFolderDialog'

const PRIMARY = 'rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500'
const PLAIN = 'rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-800'

function Frame({ message, children }: Readonly<{ message: string | null; children?: ReactNode }>) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Open Macro Builder</h1>
      {message && (
        <p role="alert" className="max-w-xl rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-red-200">
          {message}
        </p>
      )}
      {children}
    </main>
  )
}

const LINK = 'text-sky-400 underline-offset-4 hover:underline'

/** A browser that cannot open folders: the explanation, and the desktop app, which works everywhere on Windows. */
export function Unsupported({ message }: Readonly<{ message: string }>) {
  return (
    <Frame message={message}>
      <DownloadLink className={LINK}>Or download the desktop app for Windows</DownloadLink>
    </Frame>
  )
}

/** An empty folder: Set up a fresh copy here?, then Setting up… while the files are copied. */
function SetupDialog({ state }: Readonly<{ state: SetupState }>) {
  const { actions } = useApp()
  if (state.writing) {
    return (
      <ConfirmDialog title="Setting up…" choices={[]}>
        <p>Copying files into {state.folder.name}.</p>
      </ConfirmDialog>
    )
  }
  return (
    <ConfirmDialog
      title="This folder is empty"
      onCancel={actions.closeFolder}
      choices={[{ label: 'Set up', primary: true, onChoose: () => void actions.chooseSetup() }]}
    >
      <p>
        Set up a fresh Open Macro Builder here? It copies the scripts, the icons and the example layout into this
        folder.
      </p>
    </ConfirmDialog>
  )
}

/**
 * No folder open yet, or one being opened: Open folder, Create new folder…, Reopen <name>, and the
 * first-run prompts.
 */
export function OpenScreen() {
  const { state, actions, platform } = useApp()
  const [naming, setNaming] = useState(false)
  if (state.screen === 'edit') return null
  const open = state.screen === 'open' ? state : null

  return (
    <Frame message={open?.message ?? null}>
      <div className="flex gap-3">
        <button type="button" className={PRIMARY} onClick={() => void actions.openFolder()}>
          Open folder
        </button>
        <button type="button" className={PLAIN} onClick={() => setNaming(true)}>
          Create new folder…
        </button>
        {open?.reopen && (
          <button type="button" className={PLAIN} onClick={() => void actions.reopen()}>
            Reopen {open.reopen}
          </button>
        )}
      </div>
      {platform === 'browser' && <DownloadLink className={LINK}>Download the desktop app for Windows</DownloadLink>}
      {naming && (
        <NewFolderDialog
          onCreate={(name) => {
            setNaming(false)
            void actions.createFolder(name)
          }}
          onCancel={() => setNaming(false)}
        />
      )}
      {state.screen === 'setup' && <SetupDialog state={state} />}
      {state.screen === 'pick-config' && (
        <ConfirmDialog
          title="This folder has no local/config.json yet"
          onCancel={actions.closeFolder}
          choices={[
            { label: 'Edit the shared example', onChoose: () => void actions.chooseConfig('example') },
            {
              label: 'Edit a copy in local/ (recommended)',
              primary: true,
              onChoose: () => void actions.chooseConfig('copy'),
            },
          ]}
        >
          <p>
            Your own layout lives in local/config.json, which git ignores, so updates never touch it. The shared
            config.json is the example everyone gets.
          </p>
        </ConfirmDialog>
      )}
      {state.screen === 'pick-language' && (
        <ConfirmDialog
          title="Which version do you run?"
          onCancel={actions.closeFolder}
          choices={LANG_IDS.map((lang) => ({
            label: LANGUAGES[lang].label,
            onChoose: () => void actions.chooseLanguage(lang),
          }))}
        >
          <p>The configurator checks your macros against the commands of the version you run.</p>
        </ConfirmDialog>
      )}
    </Frame>
  )
}
