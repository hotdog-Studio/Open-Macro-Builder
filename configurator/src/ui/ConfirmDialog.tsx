import { useEffect, useId, useRef, type ReactNode } from 'react'

export interface Choice {
  label: string
  onChoose: () => void
  /** The highlighted, recommended choice. */
  primary?: boolean
  /** A choice that loses work, shown in red. */
  danger?: boolean
  /** Not available yet, such as while a field in the dialog holds something invalid. */
  disabled?: boolean
}

export interface ConfirmDialogProps {
  title: string
  children?: ReactNode
  choices: Choice[]
  /** Adds a Cancel button; Escape cancels too. */
  onCancel?: () => void
  /**
   * For a dialog whose own buttons say how to leave it: Escape and a press on the backdrop call it, and it
   * adds no button. Left out, as while work is under way, they do nothing.
   */
  onDismiss?: () => void
}

const BUTTON = 'rounded-md px-3 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-50'
const STYLE = {
  primary: `${BUTTON} bg-sky-600 text-white hover:bg-sky-500`,
  danger: `${BUTTON} bg-red-600 text-white hover:bg-red-500`,
  plain: `${BUTTON} border border-zinc-700 hover:bg-zinc-800`,
}

function styleOf(c: Choice): string {
  if (c.danger) return STYLE.danger
  if (c.primary) return STYLE.primary
  return STYLE.plain
}

/** A modal question with a few answers. */
export function ConfirmDialog({ title, children, choices, onCancel, onDismiss }: Readonly<ConfirmDialogProps>) {
  const titleId = useId()
  const backdrop = useRef<HTMLDivElement>(null)
  const onEscape = onCancel ?? onDismiss

  useEffect(() => {
    if (!onEscape) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])

  // On the press, not the click: a click that starts in the dialog and ends on the backdrop (a text
  // selection dragged out of it) is the backdrop's too.
  useEffect(() => {
    if (!onDismiss) return
    const onPress = (e: PointerEvent) => {
      if (e.target === backdrop.current) onDismiss()
    }
    window.addEventListener('pointerdown', onPress)
    return () => window.removeEventListener('pointerdown', onPress)
  }, [onDismiss])

  return (
    <div ref={backdrop} className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8">
      {/* Open and laid out by the page, not shown with showModal(): the classes undo the browser's own dialog box. */}
      <dialog
        open
        aria-modal="true"
        aria-labelledby={titleId}
        className="static m-0 flex max-h-full w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 p-0 text-inherit"
      >
        <h2 id={titleId} className="border-b border-zinc-800 px-4 py-2.5 font-semibold">
          {title}
        </h2>
        {children && <div className="min-h-0 overflow-auto p-4 text-zinc-300">{children}</div>}
        {/* A dialog with nothing to answer (work under way) has no button row. */}
        {(onCancel || choices.length > 0) && (
          <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
            {onCancel && (
              <button type="button" className={STYLE.plain} onClick={onCancel}>
                Cancel
              </button>
            )}
            {choices.map((c) => (
              <button
                key={c.label}
                type="button"
                autoFocus={c.primary}
                disabled={c.disabled}
                className={styleOf(c)}
                onClick={c.onChoose}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </dialog>
    </div>
  )
}
