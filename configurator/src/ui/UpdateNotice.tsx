import { useEditor } from '../state/store'
import { updateSentence } from '../state/updateActions'

/**
 * The update bar: the folder's scripts are older than the app's, or some are missing. It stays until it
 * is answered, and no other message replaces it; Review the update opens the dialog behind it. Once the
 * update has run, the dialog says what came of it and the bar is gone.
 */
export function UpdateNotice() {
  const { state, actions } = useEditor()
  // No bar without an offer, nor once its update has run.
  if (state.update?.result !== null) return null
  // An <output> is a status (a polite live region). It is inserted already filled, which some screen
  // readers do not announce.
  return (
    <output className="flex items-center gap-3 border-b border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sky-200">
      <span className="flex-1">{updateSentence(state.update.plan)}</span>
      <button
        type="button"
        className="rounded-md border border-sky-500/40 px-2 py-0.5 text-[12px] hover:bg-sky-500/20"
        onClick={actions.reviewUpdate}
      >
        Review the update
      </button>
      <button
        type="button"
        className="rounded-md px-2 text-[12px] opacity-80 hover:opacity-100"
        onClick={actions.dismissUpdate}
      >
        Not now
      </button>
    </output>
  )
}
