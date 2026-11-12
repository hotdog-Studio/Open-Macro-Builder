import { useEffect, useRef, useState } from 'react'
import { appendBlock, checkCommandName } from '../core/commands/newCommand'
import { LANGUAGES, type CommandFile } from '../core/languages'
import { useEditor } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'
import { STYLE } from './Panels'

/** New command: a name and a description; the starter is added to the file's unsaved text. */
function NewCommandDialog({ file, onClose }: Readonly<{ file: CommandFile; onClose: () => void }>) {
  const { state, dispatch, actions } = useEditor()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  // After the dialog's own focus, so typing goes straight into the name.
  useEffect(() => nameField.current?.focus(), [])

  /** True once the command is being added, so a second click does not add it again. */
  const busy = useRef(false)
  const add = () => {
    if (busy.current) return
    busy.current = true
    const why = checkCommandName(state.commandFiles, state.commands.drafts, file.lang, name)
    if (why) {
      busy.current = false
      setError(why)
      return
    }
    const language = LANGUAGES[file.lang]
    const path = file.file.path
    const current = state.commands.drafts[path] ?? file.file.text
    const next = appendBlock(current, language.starterCommand(name, description))
    actions.editCommand(path, next, file.file.version)
    const added = language.findFunctions(next).filter((fn) => fn.name.toLowerCase() === name.toLowerCase())
    const line = added.at(-1)?.line
    if (line !== undefined) dispatch({ type: 'jump', path, line })
    onClose()
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') add()
  }
  return (
    <ConfirmDialog title="New command" onCancel={onClose} choices={[{ label: 'Add', primary: true, onChoose: add }]}>
      <label className={STYLE.label} htmlFor="new-command-name">
        Name
      </label>
      <input
        id="new-command-name"
        ref={nameField}
        className={STYLE.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter}
      />
      <label className={STYLE.label} htmlFor="new-command-description">
        Description
      </label>
      <input
        id="new-command-description"
        className={STYLE.input}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onEnter}
      />
      {error && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
    </ConfirmDialog>
  )
}

/**
 * The toolbar's New command button and its dialog. Disabled without a file to add to, or when the
 * file is not editable.
 */
export function NewCommandButton({ file }: Readonly<{ file: CommandFile | undefined }>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" disabled={!file?.editable} className={STYLE.button} onClick={() => setOpen(true)}>
        New command
      </button>
      {open && file && <NewCommandDialog file={file} onClose={() => setOpen(false)} />}
    </>
  )
}
