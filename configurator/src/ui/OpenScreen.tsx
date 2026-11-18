import { useState, type ReactNode } from 'react'
import { LANG_IDS, LANGUAGES } from '../core/languages'
import { useApp, type SetupState } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'
import { DownloadLink } from './DownloadLink'
import { GetStarted } from './GetStarted'
import { NewFolderDialog } from './NewFolderDialog'
import { LINK, Strong } from './prose'

const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = `rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 ${DISABLED}`
const PLAIN = `rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-800 ${DISABLED}`

/**
 * The title and what goes under it. With the guide showing the page is taller than a small window,
 * so the main aligns to the top and scrolls inside itself: centred, its top would be cut off above
 * the window with nothing to scroll back to.
 */
function Frame({
  message,
  guide = null,
  children,
}: Readonly<{ message: string | null; guide?: ReactNode; children?: ReactNode }>) {
  const place = guide ? 'justify-start overflow-y-auto' : 'justify-center'
  return (
    <main className={`flex h-full flex-col items-center gap-6 p-8 ${place}`}>
      <h1 className="text-2xl font-semibold">Open Macro Builder</h1>
      {message && (
        <p role="alert" className="max-w-xl rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-red-200">
          {message}
        </p>
      )}
      {children}
      {guide && <div className="w-full max-w-3xl text-left">{guide}</div>}
    </main>
  )
}

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
  const [guide, setGuide] = useState(false)
  if (state.screen === 'edit') return null
  const open = state.screen === 'open' ? state : null
  // Still reachable by Tab behind the Setting up… dialog; no folder may open while the copy runs.
  const copying = state.screen === 'setup' && state.writing

  return (
    <Frame message={open?.message ?? null} guide={guide && <GetStarted folderName={null} languages={LANG_IDS} />}>
      <p className="max-w-xl text-center text-zinc-300">
        Turn a spare keypad into a pad of shortcuts. New here? <Strong>Get started</Strong>{' '}
        says what you need and takes you as far as your first key press.
      </p>
      <div className="flex gap-3">
        <button type="button" disabled={copying} className={PRIMARY} onClick={() => void actions.openFolder()}>
          Open folder
        </button>
        <button type="button" disabled={copying} className={PLAIN} onClick={() => setNaming(true)}>
          Create new folder…
        </button>
        {open?.reopen && (
          <button type="button" disabled={copying} className={PLAIN} onClick={() => void actions.reopen()}>
            Reopen {open.reopen}
          </button>
        )}
      </div>
      <button type="button" aria-expanded={guide} className={PLAIN} onClick={() => setGuide(!guide)}>
        {guide ? 'Hide the guide' : 'Get started'}
      </button>
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
          choices={[{ label: 'Edit a copy in local/', primary: true, onChoose: () => void actions.chooseConfig() }]}
        >
          <p>
            Your own layout lives in local/config.json, apart from the files that came with Open Macro Builder. It
            starts as a copy of the bundled example, config.json, which is left as it is.
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
          <p className="mt-3">
            AutoHotkey is a free program you install yourself. PowerShell is already part of Windows. You can change this
            later under <Strong>I run</Strong>.
          </p>
        </ConfirmDialog>
      )}
    </Frame>
  )
}
