import { useEffect } from 'react'
import type { Workspace } from '../core/config/model'
import { dropOverflow } from '../core/config/ops'
import { useEditor, type SaveDialog } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'

/** A list of checkWorkspace messages. */
function Messages({ items }: Readonly<{ items: string[] }>) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  )
}

/** Each layer, slotted then parked, that has macros past the last key, as a line for the user. */
function overflowLines(ws: Workspace): string[] {
  const layers = [...ws.keys.map((k) => ws.slots[k.id]).filter(Boolean), ...ws.parked]
  return layers
    .filter((l) => l.overflowMacros.length > 0)
    .map((l) => {
      const n = l.overflowMacros.length
      return `Layer "${l.title}": ${n} ${n === 1 ? 'macro' : 'macros'} past the last key`
    })
}

/** The dialogs of a save. The side effects are in actions.save / reloadFromDisk. */
function SaveDialogView({ dialog }: Readonly<{ dialog: SaveDialog }>) {
  const { state, dispatch, actions } = useEditor()
  const path = state.configFile.path
  const close = () => dispatch({ type: 'save-dialog', dialog: null })
  const ok = [{ label: 'OK', primary: true, onChoose: close }]

  switch (dialog.kind) {
    case 'blocked': {
      // Macros past the last key always block the save; dropping them is one edit, and the user saves again.
      const overflow = overflowLines(state.ws)
      const drop = {
        label: 'Drop the macros past the last key',
        onChoose: () => {
          dispatch({ type: 'edit', ws: dropOverflow(state.ws) })
          close()
        },
      }
      return (
        <ConfirmDialog title="Can't save yet" choices={overflow.length > 0 ? [drop, ...ok] : ok} onCancel={close}>
          <p className="mb-2">Fix these first. Nothing was written.</p>
          <Messages items={dialog.errors} />
          {overflow.length > 0 && (
            <>
              <p className="mt-3 mb-2">These layers have more macros than keys:</p>
              <Messages items={overflow} />
            </>
          )}
        </ConfirmDialog>
      )
    }
    case 'saved': {
      // The after-save dialog: notes about the other language and, in Electron, Reload macropad.
      const choices = dialog.macropad
        ? [{ label: 'Reload macropad', primary: true, onChoose: () => void actions.reloadMacropad() }, ...ok.map((c) => ({ ...c, primary: false }))]
        : ok
      return (
        <ConfirmDialog
          title={dialog.warnings.length > 0 ? 'Saved, with notes about the other language' : 'Saved'}
          choices={choices}
          onCancel={close}
        >
          {dialog.warnings.length > 0 && (
            <>
              <p className="mb-2">These only matter if you switch to the version you do not run:</p>
              <Messages items={dialog.warnings} />
            </>
          )}
          {dialog.macropad && <p className="mt-2">The macropad is running. Reload it to use these changes.</p>}
          {dialog.note && <p className="mt-2">{dialog.note}</p>}
        </ConfirmDialog>
      )
    }
    case 'conflict':
      return (
        <ConfirmDialog
          title="config.json changed on disk since you opened it."
          onCancel={close}
          choices={[
            { label: 'Reload from disk', onChoose: () => void actions.reloadFromDisk() },
            {
              label: 'Overwrite anyway',
              danger: true,
              onChoose: () => dispatch({ type: 'save-dialog', dialog: { kind: 'confirm-overwrite' } }),
            },
          ]}
        >
          <p>
            Something else edited <code className="font-mono">{path}</code> after the configurator loaded it, so
            nothing was saved. Reload from disk shows that version and drops your unsaved edits; Overwrite anyway
            replaces it with yours.
          </p>
        </ConfirmDialog>
      )
    case 'confirm-overwrite':
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
                void actions.save({ force: true })
              },
            },
          ]}
        >
          <p>
            The other edit to <code className="font-mono">{path}</code> is replaced by yours. A copy of it is kept
            as <code className="font-mono">{path}.bak</code>.
          </p>
        </ConfirmDialog>
      )
  }
}

/** The changed-on-disk banner; the unsaved edits stay until the user chooses. */
function OutsideChangeBanner() {
  const { dispatch, actions } = useEditor()
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-200">
      <p className="flex-1">config.json changed on disk.</p>
      <button
        type="button"
        className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[12px] hover:bg-amber-500/20"
        onClick={() => void actions.reloadFromDisk()}
      >
        Reload from disk
      </button>
      <button
        type="button"
        className="rounded-md px-2 text-[12px] opacity-80 hover:opacity-100"
        onClick={() => dispatch({ type: 'dismiss-disk' })}
      >
        Dismiss
      </button>
    </div>
  )
}

/**
 * Save dialogs and the outside-change banner; rechecks config.json and the command files when the
 * window regains focus.
 */
export function SaveFlow() {
  const { state, actions } = useEditor()

  useEffect(() => {
    const onFocus = () => {
      void actions.recheck()
      void actions.recheckCommands()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [actions])

  return (
    <>
      {state.outsideChange && !state.outsideChange.dismissed && <OutsideChangeBanner />}
      {state.saveDialog && <SaveDialogView dialog={state.saveDialog} />}
    </>
  )
}
