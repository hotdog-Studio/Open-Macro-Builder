import { useEffect } from 'react'
import { useApp, useEditor } from '../state/store'
import { CommandsTab } from './CommandsTab'
import { GetStarted } from './GetStarted'
import { Header } from './Header'
import { IconsTab } from './IconsTab'
import { LayersTab } from './LayersTab'
import { MacrosTab } from './MacrosTab'
import { OpenScreen } from './OpenScreen'
import { OutsideChangeBar, SaveFlow } from './SaveFlow'
import { ShapeTab } from './ShapeTab'
import { Toast } from './Toast'
import { UpdateDialog } from './UpdateDialog'
import { UpdateNotice } from './UpdateNotice'
import { useUnsavedGuard } from './useUnsavedGuard'

function Editor() {
  const { state } = useEditor()
  const updating = state.update?.dialog === true
  return (
    <>
      {/* Everything behind the update's dialog is inert while it is open: no key or click reaches it. */}
      <div className="flex h-full flex-col" inert={updating}>
        <Header />
        <SaveFlow />
        {/* The relative wrapper is where the bars and messages float: over the tabs, taking no room. */}
        <div className="relative flex min-h-0 flex-1">
          {/*
            The changed-on-disk bar, the update bar under it and the message under both, stacked at the top
            centre; none replaces another. The stack takes no clicks, only what is in it does, so the space
            beside them reaches the tab under it.
          */}
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center gap-2 p-2">
            <OutsideChangeBar />
            <UpdateNotice />
            <Toast />
          </div>
          {state.tab === 'start' && (
            <main className="min-w-0 flex-1 overflow-y-auto p-5">
              <GetStarted folderName={state.folder.name} languages={state.settings.languages} />
            </main>
          )}
          {state.tab === 'shape' && <ShapeTab />}
          {state.tab === 'layers' && <LayersTab />}
          {state.tab === 'macros' && <MacrosTab />}
          {state.tab === 'icons' && <IconsTab />}
          {state.tab === 'commands' && <CommandsTab />}
        </div>
      </div>
      {/* Mounted only while open, so a new offer starts with nothing ticked. */}
      {updating && <UpdateDialog />}
    </>
  )
}

export function App() {
  const { state, actions } = useApp()
  // An update under way asks too: it stops part-way when the window goes.
  useUnsavedGuard(
    state.screen === 'edit' &&
      (state.dirty || Object.keys(state.commands.drafts).length > 0 || state.iconDraft !== null || state.update?.busy === true),
  )
  // On start: reopen the folder remembered from last time, if any.
  useEffect(() => {
    void actions.restore()
  }, [actions])
  return state.screen === 'edit' ? <Editor /> : <OpenScreen />
}
