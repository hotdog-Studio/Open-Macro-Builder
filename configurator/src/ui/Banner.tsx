import { useApp } from '../state/store'

/** Load notices and errors above the editor; the user dismisses them. */
export function Banner() {
  const { state, dispatch } = useApp()
  if (state.screen !== 'edit' || !state.banner) return null
  const { text, kind } = state.banner
  const tone =
    kind === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 border-b px-4 py-2 ${tone}`}>
      <p className="flex-1 whitespace-pre-line">{text}</p>
      <button
        type="button"
        className="rounded-md px-2 text-[12px] opacity-80 hover:opacity-100"
        onClick={() => dispatch({ type: 'banner', banner: null })}
      >
        Dismiss
      </button>
    </div>
  )
}
