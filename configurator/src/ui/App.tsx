import { useEffect } from 'react'
import { useApp, useEditor } from '../state/store'
import { Banner } from './Banner'
import { Header } from './Header'
import { OpenScreen } from './OpenScreen'

/** Placeholder until Task 11's grid: the pad's key names. */
function ShapeTab() {
  const { state } = useEditor()
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Keys" className="flex flex-wrap gap-2">
        {state.ws.keys.map((k) => (
          <li key={k.id} className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono">
            {k.key}
          </li>
        ))}
      </ul>
      <p className="text-zinc-400">
        Fn: <span className="font-mono text-zinc-200">{state.ws.fn.key}</span>
      </p>
    </div>
  )
}

function Editor() {
  const { state } = useEditor()
  return (
    <div className="flex h-full flex-col">
      <Header />
      <Banner />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-3" />
        <main className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-auto p-5">
          {state.tab === 'shape' && <ShapeTab />}
        </main>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-3" />
      </div>
    </div>
  )
}

export function App() {
  const { state, actions } = useApp()
  // On start: reopen the folder remembered from last time, if any.
  useEffect(() => {
    void actions.restore()
  }, [actions])
  return state.screen === 'edit' ? <Editor /> : <OpenScreen />
}
