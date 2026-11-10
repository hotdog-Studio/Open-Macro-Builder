import { LANG_IDS, LANGUAGES, type LangId } from '../core/languages'
import { useEditor, type Tab } from '../state/store'

const TABS: [Tab, string][] = [
  ['shape', 'Pad shape'],
  ['layers', 'Layers'],
  ['macros', 'Macros'],
]

export function Header() {
  const { state, dispatch, actions } = useEditor()
  const running = state.settings.languages

  const toggle = (lang: LangId, on: boolean) => {
    const next = LANG_IDS.filter((l) => (l === lang ? on : running.includes(l)))
    // At least one language stays ticked.
    if (next.length > 0) void actions.setLanguages(next)
  }

  return (
    <header className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
      <span className="mr-4 font-semibold">Open Macro Builder</span>
      <nav role="tablist" aria-label="Views" className="flex gap-1">
        {TABS.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state.tab === tab}
            className={`rounded-md px-3 py-1.5 ${
              state.tab === tab ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => dispatch({ type: 'tab', tab })}
          >
            {label}
          </button>
        ))}
      </nav>
      <span className="flex-1" />
      <span className="mr-4 flex items-baseline gap-2 text-[12px]">
        <span className="text-zinc-200">{state.folder.name}</span>
        <span className="font-mono text-[11px] text-zinc-500">{state.configFile.path}</span>
      </span>
      <fieldset className="mr-3 flex items-center gap-3 text-[12px] text-zinc-400">
        <legend className="float-left mr-1">I run</legend>
        {LANG_IDS.map((lang) => (
          <label key={lang} className="flex items-center gap-1.5 text-zinc-200">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={running.includes(lang)}
              onChange={(e) => toggle(lang, e.target.checked)}
            />
            {LANGUAGES[lang].label}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        disabled
        className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save config.json
      </button>
    </header>
  )
}
