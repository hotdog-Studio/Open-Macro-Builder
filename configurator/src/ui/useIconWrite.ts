import { useState } from 'react'
import { useEditor } from '../state/store'
import { writePlanned, type PlannedFile } from './iconFiles'

/** Files waiting for an answer to "Replace existing files?". */
interface Pending {
  files: PlannedFile[]
  /** Where they go, for the message after. */
  where: string
  /** What the tab does once they are written. */
  done: () => void
}

/** What the writing of an icon set or of empty key frames needs: the question about replacing, and the writing itself. */
export interface IconWrite {
  /** The files that wait for an answer; null when nothing does. */
  asking: PlannedFile[] | null
  busy: boolean
  /**
   * Plans the files `build` gives and writes them, or asks first when some are already there. After a write the icon
   * lists are read again and `done` runs. A failure is shown as an error message that says `what` was not written.
   */
  start(what: string, where: string, build: () => Promise<PlannedFile[]>, done: () => void): Promise<void>
  replace(): Promise<void>
  cancel(): void
}

export function useIconWrite(): IconWrite {
  const { state, dispatch, actions } = useEditor()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  const guarded = async (what: string, run: () => Promise<void>) => {
    setBusy(true)
    try {
      await run()
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      dispatch({ type: 'banner', banner: { text: `${what} was not written: ${reason}`, kind: 'error' } })
    } finally {
      setBusy(false)
    }
  }

  const commit = async (p: Pending) => {
    await writePlanned(state.folder, p.files)
    await actions.rescanIcons()
    dispatch({ type: 'banner', banner: { text: `Wrote ${p.files.length} files to ${p.where}.`, kind: 'info' } })
    setPending(null)
    p.done()
  }

  return {
    asking: pending?.files ?? null,
    busy,
    start: (what, where, build, done) =>
      guarded(what, async () => {
        const files = await build()
        const next = { files, where, done }
        if (files.some((f) => f.replaces)) setPending(next)
        else await commit(next)
      }),
    replace: async () => {
      if (pending) await guarded('The files', () => commit(pending))
    },
    cancel: () => setPending(null),
  }
}
