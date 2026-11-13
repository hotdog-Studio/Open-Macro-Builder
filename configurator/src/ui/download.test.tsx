/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'
import { RELEASES_URL } from './DownloadLink'
import { Unsupported } from './OpenScreen'

afterEach(cleanup)

/** The app on the start screen, in a browser tab or in the desktop app. */
async function start(kind: Platform['kind']) {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  const enc = new TextEncoder()
  await folder.writeBytes('local/config.json', enc.encode(readRepoText('config.json')))
  await folder.writeBytes(SETTINGS_PATH, enc.encode('{ "languages": ["ahk"] }\n'))
  const platform: Platform = { kind, openFolder: async () => folder, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
      <App />
    </AppProvider>,
  )
  await screen.findByRole('button', { name: 'Open folder' })
  return userEvent.setup()
}

async function openEditor(kind: Platform['kind']) {
  const user = await start(kind)
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
}

/** A link that leaves for the releases page in a new tab, without telling GitHub where from. */
function expectReleasesLink(link: HTMLElement) {
  expect(link.getAttribute('href')).toBe(RELEASES_URL)
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noreferrer')
}

describe('the Download link', () => {
  it('points at the GitHub releases page of this project', () => {
    expect(RELEASES_URL).toBe('https://github.com/hotdog-Studio/Open-Macro-Builder/releases')
  })

  it('is on the start screen in a browser', async () => {
    await start('browser')
    expectReleasesLink(screen.getByRole('link', { name: 'Download the desktop app for Windows' }))
  })

  it('is in the header in a browser, once a folder is open', async () => {
    await openEditor('browser')
    const link = screen.getByRole('link', { name: 'Download' })
    expectReleasesLink(link)
    // Beside Open folder, in the header.
    expect(link.closest('header')).toBe(screen.getByRole('button', { name: 'Open folder' }).closest('header'))
  })

  it('opens in a new tab, so it never costs unsaved edits', async () => {
    await openEditor('browser')
    // A link that replaced the page would run into the unsaved-changes prompt; this one cannot.
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('target')).toBe('_blank')
  })

  it('is not shown in the desktop app, on the start screen or in the header', async () => {
    await start('electron')
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()
    await openEditor('electron')
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
  })

  it('is offered to a browser that cannot open folders', () => {
    render(<Unsupported message="needs Chrome or Edge" />)
    expectReleasesLink(screen.getByRole('link', { name: 'Or download the desktop app for Windows' }))
  })
})
