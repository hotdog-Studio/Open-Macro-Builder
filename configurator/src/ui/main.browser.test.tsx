import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { idbHandleStore } from '../platform/browser'
import { UNSUPPORTED } from '../platform/detect'
import { RELEASES_URL } from './DownloadLink'

// main.tsx itself, the file index.html loads: it looks at the browser it is in and starts the app,
// or only explains itself when the browser cannot open folders (Firefox and Safari cannot).

const realPicker = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker')

let runs = 0
/** Runs main.tsx afresh, as loading the page does. A new query string makes the browser run the module again. */
const runMain = (): Promise<unknown> => import(/* @vite-ignore */ `../main.tsx?run=${++runs}`)

/** Loads the page: an empty #root, then main.tsx. */
async function loadPage(): Promise<void> {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  await runMain()
}

beforeEach(() => idbHandleStore.clear())

afterEach(() => {
  document.getElementById('root')?.remove()
  if (realPicker) Object.defineProperty(window, 'showDirectoryPicker', realPicker)
  else delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
})

describe('loading the page', () => {
  it('in a browser that cannot open folders, shows only why it needs Chrome or Edge', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    await loadPage()

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(UNSUPPORTED))
    expect(screen.getByRole('heading', { name: 'Open Macro Builder' })).toBeTruthy()
    // Nothing to click that could not work; the way out is the desktop app.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'Or download the desktop app for Windows' }).getAttribute('href')).toBe(RELEASES_URL)
  })

  it('in Chromium, shows the start screen with Open folder and no complaint', async () => {
    await loadPage()

    await screen.findByRole('button', { name: 'Open folder' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Reopen/ })).toBeNull()
  })

  it('fills the window, so the panels can scroll inside it', async () => {
    await loadPage()
    await screen.findByRole('button', { name: 'Open folder' })
    const root = document.getElementById('root')!
    expect(root.getBoundingClientRect().height).toBe(window.innerHeight)
    expect(getComputedStyle(document.body).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('refuses to start on a page with no #root', async () => {
    await expect(runMain()).rejects.toThrow('index.html has no #root element')
  })
})
