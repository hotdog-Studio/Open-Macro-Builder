import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { useApp, type Action, type Banner } from '../state/store'

/** Milliseconds until a message leaves by itself, or null when it stays until it is dismissed. */
export function toastLifetime(banner: Banner): number | null {
  if (banner.kind === 'error') return null
  return Math.min(15000, 4000 + 40 * banner.text.length)
}

const TONE: Record<Banner['kind'], string> = {
  info: 'border-sky-500/60 bg-sky-950 text-sky-200',
  warning: 'border-amber-500/60 bg-amber-950 text-amber-200',
  error: 'border-red-500/60 bg-red-950 text-red-200',
}

/** The same "i in a circle" for every kind; the colour comes from the text colour around it. */
function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" />
      <path d="M10 9v5" strokeLinecap="round" />
      <circle cx="10" cy="6.25" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ToastCard({ banner, dispatch }: Readonly<{ banner: Banner; dispatch: (a: Action) => void }>) {
  // The pointer on it or the focus in it holds the countdown; both gone starts the whole time again.
  const [pointerOn, setPointerOn] = useState(false)
  const [focusIn, setFocusIn] = useState(false)
  const held = pointerOn || focusIn

  // The message showing now. A timer that fires after its message was replaced must find another one here.
  const showing = useRef(banner)
  useLayoutEffect(() => {
    showing.current = banner
  }, [banner])

  useEffect(() => {
    const ms = toastLifetime(banner)
    if (ms === null || held) return
    const timer = setTimeout(() => {
      if (showing.current === banner) dispatch({ type: 'banner', banner: null })
    }, ms)
    return () => clearTimeout(timer)
  }, [banner, held, dispatch])

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocusIn(false)
  }
  const props = {
    className: `pointer-events-auto flex w-fit max-h-full max-w-[min(40rem,90vw)] items-start gap-3 overflow-y-auto rounded-[1.25rem] border px-4 py-2.5 shadow-lg shadow-black/50 ${TONE[banner.kind]}`,
    onPointerEnter: () => setPointerOn(true),
    onPointerLeave: () => setPointerOn(false),
    onFocus: () => setFocusIn(true),
    onBlur,
  }
  const body = (
    <>
      <InfoIcon />
      <span className="min-w-0 flex-1 whitespace-pre-line py-0.5">{banner.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="-mr-1 rounded-full px-2 text-lg leading-6 opacity-80 hover:opacity-100"
        onClick={() => dispatch({ type: 'banner', banner: null })}
      >
        ×
      </button>
    </>
  )
  // A refusal or a failure interrupts a screen reader; a notice waits its turn.
  return banner.kind === 'info' ? <output {...props}>{body}</output> : <div role="alert" {...props}>{body}</div>
}

/**
 * The message the app has for the user, floating at the top centre of the area under the header.
 * Its holder takes no room and no clicks, so nothing moves when a message comes or goes.
 */
export function Toast() {
  const { state, dispatch } = useApp()
  if (state.screen !== 'edit' || !state.banner) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center p-2">
      <ToastCard banner={state.banner} dispatch={dispatch} />
    </div>
  )
}
