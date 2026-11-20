import { useEffect } from 'react'
import { useApp, useEditor } from '../state/store'
import { CommandsTab } from './CommandsTab'
import { GetStarted } from './GetStarted'
import { Header } from './Header'
import { LayersTab } from './LayersTab'
import { MacrosTab } from './MacrosTab'
import { OpenScreen } from './OpenScreen'
import { SaveFlow } from './SaveFlow'
import { ShapeTab } from './ShapeTab'
import { Toast } from './Toast'
import { UpdateNotice } from './UpdateNotice'
import { useUnsavedGuard } from './useUnsavedGuard'

function Editor() {
  const { state } = useEditor()
  return (
    <div className="flex h-full flex-col">
      <Header />
      <SaveFlow />
      {/* Under the changed-on-disk bar when both show; neither replaces the other. */}
      <UpdateNotice />
      {/* The relative wrapper is where messages float: over the tabs, taking no room. */}
      <div className="relative flex min-h-0 flex-1">
        <Toast />
        {state.tab === 'start' && (
          <main className="min-w-0 flex-1 overflow-y-auto p-5">
            <GetStarted folderName={state.folder.name} languages={state.settings.languages} />
          </main>
        )}
        {state.tab === 'shape' && <ShapeTab />}
        {state.tab === 'layers' && <LayersTab />}
        {state.tab === 'macros' && <MacrosTab />}
        {state.tab === 'commands' && <CommandsTab />}
      </div>
    </div>
  )
}

export function App() {
  const { state, actions } = useApp()
  useUnsavedGuard(state.screen === 'edit' && (state.dirty || Object.keys(state.commands.drafts).length > 0))
  // On start: reopen the folder remembered from last time, if any.
  useEffect(() => {
    void actions.restore()
  }, [actions])
  return state.screen === 'edit' ? <Editor /> : <OpenScreen />
}
