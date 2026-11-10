import type { ReactNode } from 'react'
import { LANG_IDS, LANGUAGES } from '../core/languages'
import { useApp } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'

const PRIMARY = 'rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500'
const PLAIN = 'rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-800'

function Frame({ message, children }: { message: string | null; children?: ReactNode }) {
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

/** A browser that cannot open folders: only the explanation. */
export function Unsupported({ message }: { message: string }) {
  return <Frame message={message} />
}

/** No folder open yet, or one being opened: Open folder, Reopen <name>, and the first-run prompts. */
export function OpenScreen() {
  const { state, actions } = useApp()
  if (state.screen === 'edit') return null
  const open = state.screen === 'open' ? state : null

  return (
    <Frame message={open?.message ?? null}>
      <div className="flex gap-3">
        <button type="button" className={PRIMARY} onClick={() => void actions.openFolder()}>
          Open folder
        </button>
        {open?.reopen && (
          <button type="button" className={PLAIN} onClick={() => void actions.reopen()}>
            Reopen {open.reopen}
          </button>
        )}
      </div>
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
