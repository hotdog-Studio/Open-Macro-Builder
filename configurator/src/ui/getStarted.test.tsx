/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryFolder } from '../core/folder/memory'
import type { LangId } from '../core/languages'
import { LINKS } from '../core/links'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'
import { GetStarted } from './GetStarted'

afterEach(cleanup)

const EXAMPLE = readRepoText('config.json')
const enc = new TextEncoder()

/** A folder that opens straight onto the tabs, running the given versions. */
async function readyFolder(languages: LangId[] = ['ahk']): Promise<MemoryFolder> {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  await folder.writeBytes('local/config.json', enc.encode(EXAMPLE))
  await folder.writeBytes(SETTINGS_PATH, enc.encode(JSON.stringify({ languages }, null, 2) + '\n'))
  return folder
}

function fakePlatform(folder: MemoryFolder | null, more: Partial<Platform> = {}): Platform {
  return {
    kind: 'browser',
    openFolder: async () => folder,
    createFolder: async () => null,
    restoreFolder: async () => null,
    ...more,
  }
}

/** Opens the folder and the Get started tab. */
async function startGuide(languages: LangId[] = ['ahk'], more: Partial<Platform> = {}) {
  const platform = fakePlatform(await readyFolder(languages), more)
  render(
    <AppProvider platform={platform} updateSource={null}>
      <App />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  await user.click(screen.getByRole('tab', { name: 'Get started' }))
  return { user, guide: await screen.findByRole('article', { name: 'Get started' }) }
}

/** The text of each paragraph and list item of the guide, so a sentence is asserted whole. */
const blocks = (guide: HTMLElement) => Array.from(guide.querySelectorAll('p, li'), (el) => el.textContent)
const headings = (guide: HTMLElement, level: string) => Array.from(guide.querySelectorAll(level), (el) => el.textContent)

const AUTOHOTKEY_PARAGRAPH =
  'AutoHotkey is a free program for automating Windows. It does not come with Windows or with this app, so you install it yourself before you start the macropad. Download it from autohotkey.com/download and run the installer. Get version 2: the macropad does not run on version 1.'
const FOUND = 'AutoHotkey v2 is already installed on this PC.'
const NOT_FOUND = 'AutoHotkey v2 was not found on this PC.'
const RELOAD_SENTENCE =
  'While a macropad started from your folder is running, saving in this app offers Reload macropad, which restarts it for you. A macropad started from another folder is not found.'
const STEP_5 = 'Open your folder in File Explorer.'
const STEP_5_AHK = 'For AutoHotkey, open the ahk folder and double-click main.ahk.'
const STEP_5_PS = 'For PowerShell, open the powershell folder and double-click launch.vbs.'
const HIDE_AHK = 'Windows may hide the ending and show the file as main.'
const HIDE_PS = 'Windows may hide the ending and show the file as launch.'
const HIDE_BOTH = 'Windows may hide the endings and show the files as main and launch.'
const NOTEPAD =
  'Double-clicking main.ahk opens Notepad, or Windows asks which app to use. That means Windows does not know the file, usually because AutoHotkey is not installed.'
const UPDATES =
  'When a later version of this app carries newer scripts than your folder, it offers to update them, and it replaces a script you changed only if you tick it.'
const step8 = (file: string) =>
  `Press Windows + R, type shell:startup and press Enter. A folder opens, and whatever is in it starts when you sign in. Drag ${file} into that folder with the right mouse button and choose Create shortcuts here.`

describe('the Get started tab', () => {
  it('is the first tab, and a folder still opens on Pad shape', async () => {
    const platform = fakePlatform(await readyFolder())
    render(
      <AppProvider platform={platform} updateSource={null}>
        <App />
      </AppProvider>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open folder' }))
    await screen.findByRole('list', { name: 'Keys' })
    const tabs = within(screen.getByRole('tablist', { name: 'Views' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Get started', 'Pad shape', 'Layers', 'Macros', 'Icons', 'Commands'])
    expect(screen.getByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Get started' })).toBeNull()
  })

  it("shows the guide, with the open folder's name", async () => {
    const { guide } = await startGuide()
    expect(screen.getByRole('tab', { name: 'Get started', selected: true })).toBeTruthy()
    expect(within(guide).getByRole('heading', { level: 2, name: 'Get started' })).toBeTruthy()
    expect(headings(guide, 'h3')).toEqual([
      '1. What you need',
      '2. Choose a version',
      '3. Set up your keypad',
      '4. Design your pad',
      '5. Start the macropad',
      '6. Try it',
      '7. After you change something',
      '8. Start it with Windows, if you like',
      'If something does not work',
      'Share a command',
    ])
    expect(headings(guide, 'h4')).toEqual(['AutoHotkey', 'PowerShell'])
    expect(blocks(guide)).toContain(`A folder for Open Macro Builder to live in. You have one open: repo. ${UPDATES}`)
    expect(blocks(guide)).not.toContain(
      `A folder for Open Macro Builder to live in. Press Create new folder… and the app makes one, with the scripts, the icons and an example layout in it. ${UPDATES}`,
    )
  })

  it('tells the story of the pad in the same words as the brief', async () => {
    const { guide } = await startGuide()
    expect(blocks(guide)).toEqual(
      expect.arrayContaining([
        'Open Macro Builder turns a spare keypad into a pad of shortcuts. A key can open a program or press a keyboard shortcut for you, and the pad has several layers of keys to switch between.',
        'It has two parts. This app is where you design the pad. The macropad is a small program that sits in the background and does the work when you press a key. This app presses nothing itself, so the macropad has to be running for your keys to do anything.',
        'A PC with Windows.',
        "A keypad, or a spare keyboard, whose keys can be set to send F13 to F24. Those are function keys past F12. Windows knows them but ordinary keyboards do not have them, so they are free for the macropad to use. Keypads sold as programmable can usually do this, with VIA, QMK or the maker's own software.",
        'The macropad comes in two versions. They do the same job and read the same layout, so you can change your mind later. Run one at a time, because both take the same keys.',
        AUTOHOTKEY_PARAGRAPH,
        'PowerShell is already part of Windows. There is nothing to install.',
        'Tick the one you chose under I run, at the top of this window.',
        'Open the software that came with your keypad and set each key to send one of F13 to F24. Set one more key to send Scroll Lock. That is the Fn key, the one you hold to switch layers. Another key will do: you can change it on the Pad shape tab.',
        'Your folder starts with an example layout, so you can skip this step and try the example first.',
        'On Pad shape, arrange the keys the way they sit on your keypad. Select a key to say which keyboard key it sends, or press Capture by pressing it and then the key on your pad. On Layers, choose which key selects each layer. A layer is one set of macros, such as Media or Chrome. On Macros, pick a layer and drag commands from the list onto its keys.',
        'Press Save config.json when you are done.',
        'A hotdog icon appears beside the clock, at the right-hand end of the taskbar. It may be hidden behind the small ^ arrow there. While the icon is there, the macropad is running.',
        'Hold the Fn key. An overlay appears with your layers on it. Still holding Fn, press the key of the layer you want, then let go. Each key now runs the macro it has on that layer.',
        'The macropad reads your layout when it starts, so it needs a restart to pick up a change. Save here, then start the macropad again as in step 5. The new one replaces the one that was running.',
        'A key does nothing. Check that the hotdog icon is beside the clock, and that the key on your keypad sends one of F13 to F24.',
        'You switched version and the keys still act as before. Both versions may be running. Right-click each hotdog icon and choose Exit, then start the one you want.',
        'The Commands tab shows the code behind every command, and you can write your own there. If you write one that other people could use, the project would like to have it.',
        'A folder this app set up is a plain copy, so it cannot send changes back. To contribute you need git, the tool the project uses to keep and share its changes. Clone the project with it:',
        'Drop your local folder into the clone, and your layout and your own commands come with you. Open the clone here with Open folder, create your command with New file as a Shared file, and send it as a pull request on GitHub. The contributing guide says how.',
      ]),
    )
  })

  it('sets apart names on screen, keys to press and files to open', async () => {
    const { guide } = await startGuide(['ahk', 'ps'])
    const texts = (selector: string) => Array.from(guide.querySelectorAll(selector), (el) => el.textContent)
    expect(texts('strong')).toEqual(
      expect.arrayContaining([
        'I run',
        'Pad shape',
        'Layers',
        'Macros',
        'Save config.json',
        'Capture by pressing it',
        'Commands',
        'New file',
        'Shared',
        'Open folder',
        'Exit',
        'Create shortcuts here',
      ]),
    )
    expect(texts('kbd')).toEqual(expect.arrayContaining(['Fn', 'Windows', 'R', 'Enter']))
    expect(texts('code')).toEqual(
      expect.arrayContaining(['main.ahk', 'launch.vbs', 'ahk', 'powershell', 'shell:startup']),
    )
  })

  it('gives the instructions of the version ticked under I run', async () => {
    const { user, guide } = await startGuide(['ahk'])
    // Choosing a version always shows both, whatever is ticked.
    expect(blocks(guide)).toContain(AUTOHOTKEY_PARAGRAPH)
    expect(blocks(guide)).toContain('PowerShell is already part of Windows. There is nothing to install.')
    expect(blocks(guide)).toContain(`${STEP_5} ${STEP_5_AHK} ${HIDE_AHK}`)
    expect(blocks(guide)).toContain(step8('main.ahk'))
    expect(blocks(guide)).toContain(NOTEPAD)
    expect(guide.textContent).not.toContain('launch.vbs')

    // Tick PowerShell too: both versions' sentences, and step 8 names both files.
    await user.click(screen.getByRole('checkbox', { name: 'PowerShell' }))
    await waitFor(() => expect(blocks(guide)).toContain(`${STEP_5} ${STEP_5_AHK} ${STEP_5_PS} ${HIDE_BOTH}`))
    expect(blocks(guide)).toContain(step8('main.ahk (or launch.vbs)'))
    expect(blocks(guide)).toContain(NOTEPAD)

    // Untick AutoHotkey: PowerShell alone.
    await user.click(screen.getByRole('checkbox', { name: 'AutoHotkey' }))
    await waitFor(() => expect(blocks(guide)).toContain(`${STEP_5} ${STEP_5_PS} ${HIDE_PS}`))
    expect(blocks(guide)).toContain(step8('launch.vbs'))
    expect(blocks(guide)).not.toContain(NOTEPAD)
    expect(guide.textContent).not.toContain('Notepad')
    expect(guide.textContent).not.toContain('main.ahk')
  })

  it('shows PowerShell alone for a folder run with PowerShell', async () => {
    const { guide } = await startGuide(['ps'])
    expect(blocks(guide)).toContain(`${STEP_5} ${STEP_5_PS} ${HIDE_PS}`)
    expect(blocks(guide)).toContain(step8('launch.vbs'))
    expect(guide.textContent).not.toContain('main.ahk')
    expect(guide.textContent).not.toContain('Notepad')
  })

  it('links to the AutoHotkey download page and the contributing guide, each in a new tab', async () => {
    const { guide } = await startGuide()
    const download = within(guide).getByRole('link', { name: 'autohotkey.com/download' })
    expect(download.getAttribute('href')).toBe(LINKS.autohotkey)
    expect(download.getAttribute('target')).toBe('_blank')
    expect(download.getAttribute('rel')).toBe('noreferrer')
    const contributing = within(guide).getByRole('link', { name: 'contributing guide' })
    expect(contributing.getAttribute('href')).toBe(LINKS.contributing)
    expect(contributing.getAttribute('target')).toBe('_blank')
    expect(contributing.getAttribute('rel')).toBe('noreferrer')
    expect(within(guide).getAllByRole('link')).toHaveLength(2)
  })

  it('in the desktop app, says whether AutoHotkey v2 was found, and offers Reload macropad', async () => {
    const found = await startGuide(['ahk'], { kind: 'electron', installedLanguages: async () => ['ahk', 'ps'] })
    expect(await within(found.guide).findByText(FOUND)).toBeTruthy()
    expect(within(found.guide).getByText('Reload macropad').tagName).toBe('STRONG')
    expect(blocks(found.guide)).toContain(FOUND)
    expect(blocks(found.guide)).not.toContain(NOT_FOUND)
    expect(blocks(found.guide)).toContain(`The macropad reads your layout when it starts, so it needs a restart to pick up a change. Save here, then start the macropad again as in step 5. The new one replaces the one that was running. ${RELOAD_SENTENCE}`)
    cleanup()

    const missing = await startGuide(['ps'], { kind: 'electron', installedLanguages: async () => ['ps'] })
    expect(await within(missing.guide).findByText(NOT_FOUND)).toBeTruthy()
    expect(blocks(missing.guide)).not.toContain(FOUND)
    expect(blocks(missing.guide).some((text) => text?.endsWith(RELOAD_SENTENCE))).toBe(true)
  })

  it('after AutoHotkey is installed, the "was not found" sentence becomes "already installed" when the window gets the focus back', async () => {
    let found: LangId[] = ['ps']
    const { guide } = await startGuide(['ps'], { kind: 'electron', installedLanguages: async () => found })
    expect(await within(guide).findByText(NOT_FOUND)).toBeTruthy()
    found = ['ahk', 'ps']
    fireEvent.focus(window)
    expect(await within(guide).findByText(FOUND)).toBeTruthy()
    expect(blocks(guide)).not.toContain(NOT_FOUND)
  })

  it('keeps the newer answer when an older check answers last', async () => {
    const answers: Array<(languages: LangId[]) => void> = []
    const installedLanguages = vi.fn(() => new Promise<LangId[]>((done) => answers.push(done)))
    const { guide } = await startGuide(['ps'], { kind: 'electron', installedLanguages })
    await waitFor(() => expect(answers).toHaveLength(1))
    fireEvent.focus(window)
    await waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => {
      answers[1](['ahk'])
    })
    expect(await within(guide).findByText(FOUND)).toBeTruthy()
    await act(async () => {
      answers[0](['ps'])
    })
    expect(blocks(guide)).toContain(FOUND)
    expect(blocks(guide)).not.toContain(NOT_FOUND)
  })

  it('in the browser, says nothing about what is installed or about Reload macropad', async () => {
    const { guide } = await startGuide(['ahk'])
    // The browser platform has no installedLanguages, so nothing is asked and there is no answer to
    // wait for: once the guide has rendered, the sentences are either there or they never will be.
    expect(guide.textContent).not.toContain('AutoHotkey v2 is already installed')
    expect(guide.textContent).not.toContain('AutoHotkey v2 was not found')
    expect(guide.textContent).not.toContain('Reload macropad')
  })

  it('says nothing about what is installed when the check fails', async () => {
    const installedLanguages = vi.fn().mockRejectedValue(new Error('no PowerShell here'))
    const { guide } = await startGuide(['ahk'], { kind: 'electron', installedLanguages })
    await waitFor(() => expect(installedLanguages).toHaveBeenCalled())
    // The check has failed once the promise it was given has rejected; let React finish what follows.
    await act(async () => {
      await installedLanguages.mock.results[0].value.catch(() => {})
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(guide.textContent).not.toContain('AutoHotkey v2 is already installed')
    expect(guide.textContent).not.toContain('AutoHotkey v2 was not found')
  })

  // React itself drops an update that comes after unmount, without a word, so this test cannot tell
  // whether the guard in GetStarted is there. It checks that the guide asks once, and that an answer
  // arriving after the reader has left the tab makes no error.
  it('asks once, and a late answer after leaving the tab causes no error', async () => {
    let answer: (languages: LangId[]) => void = () => {}
    const installedLanguages = vi.fn(() => new Promise<LangId[]>((done) => (answer = done)))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = await startGuide(['ahk'], { kind: 'electron', installedLanguages })
    expect(installedLanguages).toHaveBeenCalledTimes(1)
    // Leaving the tab takes the guide away before the answer comes.
    await user.click(screen.getByRole('tab', { name: 'Pad shape' }))
    await act(async () => {
      answer(['ahk'])
    })
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('says how to contribute: clone the project and drop your local folder in', async () => {
    const { guide } = await startGuide()
    const line = within(guide).getByText('git clone https://github.com/hotdog-Studio/Open-Macro-Builder.git')
    expect(line.tagName).toBe('CODE')
    // A line of its own: the code is the whole of its paragraph.
    expect(line.parentElement?.textContent).toBe(line.textContent)
    expect(blocks(guide)).toContain(
      'Drop your local folder into the clone, and your layout and your own commands come with you. Open the clone here with Open folder, create your command with New file as a Shared file, and send it as a pull request on GitHub. The contributing guide says how.',
    )
  })

  it('a reload from disk stays on Get started', async () => {
    const platform = fakePlatform(await readyFolder())
    const folder = (await platform.openFolder()) as MemoryFolder
    render(
      <AppProvider platform={platform} updateSource={null}>
        <App />
      </AppProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await screen.findByRole('list', { name: 'Keys' })
    await user.click(screen.getByRole('tab', { name: 'Get started' }))
    await folder.writeBytes('local/config.json', enc.encode(EXAMPLE + '\n\n'))
    fireEvent.focus(window)
    const banner = (await screen.findByText('config.json changed on disk.')).closest('[role]') as HTMLElement
    await user.click(within(banner).getByRole('button', { name: 'Reload from disk' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reload from disk' })).toBeNull())
    expect(screen.getByRole('tab', { name: 'Get started', selected: true })).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Get started' })).toBeTruthy()
  })
})

describe('the guide with no folder open', () => {
  function renderGuide(languages: readonly LangId[], more: Partial<Platform> = {}) {
    render(
      <AppProvider platform={fakePlatform(null, more)} updateSource={null}>
        <GetStarted folderName={null} languages={languages} />
      </AppProvider>,
    )
    return screen.getByRole('article', { name: 'Get started' })
  }

  it('says to press Create new folder…, and has no folder to name or tick under I run', () => {
    const guide = renderGuide(['ahk', 'ps'])
    expect(blocks(guide)).toContain(
      `A folder for Open Macro Builder to live in. Press Create new folder… and the app makes one, with the scripts, the icons and an example layout in it. ${UPDATES}`,
    )
    expect(guide.textContent).not.toContain('You have one open')
    expect(guide.textContent).not.toContain('Tick the one you chose')
    // Choosing a version is still what step 2 is for.
    expect(blocks(guide)).toContain(AUTOHOTKEY_PARAGRAPH)
    expect(blocks(guide)).toContain(step8('main.ahk (or launch.vbs)'))
  })

  it('still says whether AutoHotkey v2 was found in the desktop app', async () => {
    const guide = renderGuide(['ahk'], { kind: 'electron', installedLanguages: async () => [] })
    expect(await within(guide).findByText(NOT_FOUND)).toBeTruthy()
  })
})
