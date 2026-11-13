import { useEffect } from 'react'

/**
 * While `dirty`, asks before the window or tab closes or reloads. The browser shows its own
 * question; in Electron the main process turns it into a Leave / Stay dialog.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
