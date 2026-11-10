import { useEffect } from 'react'
import { useApp, useEditor } from '../state/store'
import { Banner } from './Banner'
import { Header } from './Header'
import { LayersTab } from './LayersTab'
import { MacrosTab } from './MacrosTab'
import { OpenScreen } from './OpenScreen'
import { ShapeTab } from './ShapeTab'

function Editor() {
  const { state } = useEditor()
  return (
    <div className="flex h-full flex-col">
      <Header />
      <Banner />
      <div className="flex min-h-0 flex-1">
        {state.tab === 'shape' && <ShapeTab />}
        {state.tab === 'layers' && <LayersTab />}
        {state.tab === 'macros' && <MacrosTab />}
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
