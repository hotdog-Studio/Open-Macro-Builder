import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { vi } from 'vitest'
import type { MemoryFolder } from '../src/core/folder/memory'
import type { LangId } from '../src/core/languages'
import { SETTINGS_PATH } from '../src/core/settings'
import type { Platform } from '../src/platform/types'
import { AppProvider, useApp, type EditState } from '../src/state/store'
import { App } from '../src/ui/App'
import { memoryFolderFromRepo, readRepoText } from './repo'

export interface StartOptions {
  languages?: LangId[]
  /** Extra files for the folder, as text. */
  files?: Record<string, string>
  /** Also copy the repository's powershell/lib into the folder. Default false. */
  library?: boolean
}

const EXAMPLE = readRepoText('config.json')
const enc = new TextEncoder()

let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useLayoutEffect(() => {
    seen = app
  })
  return null
}

/** Opens the example repository in memory and shows the Commands tab: what start() in src/ui/commands.test.tsx does. */
export async function startCommands({ languages = ['ahk', 'ps'], files = {}, library = false }: StartOptions = {}) {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
  const folder: MemoryFolder = memoryFolderFromRepo([
    'config.json',
    'ahk/main.ahk',
    'ahk/config.ahk',
    'ahk/commands',
    'powershell/commands',
    'img',
    ...(library ? ['powershell/lib'] : []),
  ])
  await folder.writeBytes('local/config.json', enc.encode(EXAMPLE))
  await folder.writeBytes(SETTINGS_PATH, enc.encode(JSON.stringify({ languages }) + '\n'))
  for (const [path, content] of Object.entries(files)) await folder.writeBytes(path, enc.encode(content))
  const platform: Platform = {
    kind: 'browser',
    openFolder: async () => folder,
    createFolder: async () => null,
    restoreFolder: async () => null,
  }
  render(
    <AppProvider platform={platform}>
      <App />
      <Probe />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  await user.click(screen.getByRole('tab', { name: 'Commands' }))
  return {
    user,
    folder,
    /** What useApp() gives now. */
    app: () => seen,
    /** The editor's state; throws on any other screen. */
    editor: (): EditState => {
      if (seen.state.screen !== 'edit') throw new Error('expected the editor')
      return seen.state
    },
  }
}

const fileList = () => screen.getByRole('navigation', { name: 'Command files' })
/** The button of a file pair in the left panel, by its pair name. */
export const pairButton = (pair: string) => within(fileList()).getByText(pair, { exact: true }).closest('button')!
export const langButton = (label: 'AutoHotkey' | 'PowerShell') =>
  screen.getByRole('button', { name: new RegExp(`^${label}`) })
