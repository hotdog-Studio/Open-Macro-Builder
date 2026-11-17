import { useEffect, useRef, useState } from 'react'
import { folderNameError } from '../core/folder/name'
import { ConfirmDialog } from './ConfirmDialog'
import { STYLE } from './Panels'

/**
 * Create new folder: a name, then Choose where… hands it on. `onCreate` runs straight from the click
 * or the Enter key, so the browser's location picker still has its user gesture.
 */
export function NewFolderDialog({
  onCreate,
  onCancel,
}: Readonly<{ onCreate: (name: string) => void; onCancel: () => void }>) {
  const [value, setValue] = useState('Open Macro Builder')
  // Trailing spaces go; leading ones stay, so the error explains them.
  const name = value.trimEnd()
  const error = folderNameError(name)
  const nameField = useRef<HTMLInputElement>(null)
  // After the dialog's own focus, so typing replaces the suggested name.
  useEffect(() => {
    nameField.current?.focus()
    nameField.current?.select()
  }, [])

  /** True once the name is handed on, so a second click does not ask for a location again. */
  const busy = useRef(false)
  const create = () => {
    if (error || busy.current) return
    busy.current = true
    onCreate(name)
  }
  return (
    <ConfirmDialog
      title="Create new folder"
      onCancel={onCancel}
      choices={[{ label: 'Choose where…', primary: true, disabled: error !== null, onChoose: create }]}
    >
      <label className={STYLE.label} htmlFor="new-folder-name">
        Folder name
      </label>
      <input
        id="new-folder-name"
        ref={nameField}
        className={STYLE.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create()
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
    </ConfirmDialog>
  )
}
