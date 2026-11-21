import { useEditor } from '../state/store'
import { updateSentence } from '../state/updateActions'
import { FLOATING_BAR } from './floating'

/**
 * The update bar: the folder's scripts are older than the app's, or some are missing. It floats at the top of
 * the content area (App.tsx), and stays until it is answered; no other message replaces it. Review the update
 * opens the dialog behind it. Once the update has run, the dialog says what came of it and the bar is gone.
 */
export function UpdateNotice() {
  const { state, actions } = useEditor()
  // No bar without an offer, nor once its update has run.
  if (state.update?.result !== null) return null
  // An <output> is a status (a polite live region). It is inserted already filled, which some screen
  // readers do not announce.
  return (
    <output className={`${FLOATING_BAR} border-sky-500/60 bg-sky-950 text-sky-200`}>
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
