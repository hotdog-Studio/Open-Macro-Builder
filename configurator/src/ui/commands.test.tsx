/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transaction } from '@codemirror/state'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renameKey } from '../core/config/ops'
import type { MemoryFolder } from '../core/folder/memory'
import { isCommand, LANGUAGES, type LangId } from '../core/languages'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider, useApp } from '../state/store'
import { editorView, replaceAll, typeAt, undo } from '../../test/codeEditor'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

const CONFIG = 'local/config.json'
const EXAMPLE = readRepoText('config.json')
const CHROME_AHK = 'ahk/commands/custom/chrome.ahk'
const CHROME_PS = 'powershell/commands/custom/chrome.ps1'
const SSH_AHK = 'ahk/commands/custom/ssh.ahk'
const enc = new TextEncoder()
const BOM = [0xef, 0xbb, 0xbf]

let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useEffect(() => {
    seen = app
  })
  return null
}

function editor() {
  if (seen.state.screen !== 'edit') throw new Error('expected the editor')
  return seen.state
}

interface Setup {
  languages?: LangId[]
  /** Extra files for the folder, as text or raw bytes. */
  files?: Record<string, string | Uint8Array>
  /** Extra platform members, such as watch. */
  platform?: Partial<Platform>
}

/** Opens the folder and shows the Commands tab. */
async function start({ languages = ['ahk', 'ps'], files = {}, platform: extra = {} }: Setup = {}) {
  const folder: MemoryFolder = memoryFolderFromRepo([
    'config.json',
    'ahk/main.ahk',
    'ahk/config.ahk',
    'ahk/commands',
    'powershell/commands',
    'img',
  ])
  await folder.writeBytes(CONFIG, enc.encode(EXAMPLE))
  await folder.writeBytes(SETTINGS_PATH, enc.encode(JSON.stringify({ languages }) + '\n'))
  for (const [path, content] of Object.entries(files)) {
    await folder.writeBytes(path, typeof content === 'string' ? enc.encode(content) : content)
  }
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null, ...extra }
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
  return { user, folder }
}

type User = ReturnType<typeof userEvent.setup>

const fileList = () => screen.getByRole('navigation', { name: 'Command files' })
/** The button of a file pair in the left panel, by its pair name. */
const pairButton = (pair: string) => within(fileList()).getByText(pair, { exact: true }).closest('button')!
const langButton = (label: 'AutoHotkey' | 'PowerShell') => screen.getByRole('button', { name: new RegExp(`^${label}`) })
const saveButton = (name: string) => screen.getByRole('button', { name: `Save ${name}` }) as HTMLButtonElement
const toolbarReload = () => within(screen.getByRole('toolbar')).getByRole('button', { name: 'Reload from disk' })
const text = () => editorView().state.doc.toString()
const docEnd = () => editorView().state.doc.length

/** How many commands a repository file defines, worked out here from the file itself. */
const repoCount = (path: string, lang: LangId) => LANGUAGES[lang].findFunctions(readRepoText(path)).filter(isCommand).length

/** The line ending the folder's copy of a file uses. */
const eolOf = (folder: MemoryFolder, path: string) => (folder.text(path)!.includes('\r\n') ? '\r\n' : '\n')

async function bytesOf(folder: MemoryFolder, path: string): Promise<number[] | null> {
  const raw = await folder.readBytes(path)
  return raw ? Array.from(raw) : null
}

/** Clicks Save and waits until the save has gone through. */
async function save(user: User, name: string) {
  await user.click(saveButton(name))
  await waitFor(() => expect(saveButton(name).disabled).toBe(true))
}

const MINE = {
  'local/ahk/mine.ahk': 'Mine(Macro)\n{\n}\n',
  'local/powershell/commands/mine.ps1': 'function Mine {\n    param($Macro)\n}\n',
}

describe('Commands tab', () => {
  it('lists each file pair once, yours first, with command counts', async () => {
    await start({ files: MINE })
    const buttons = within(fileList()).getAllByRole('button')
    expect(within(buttons[0]).getByText('mine')).toBeTruthy()
    expect(buttons[0].textContent).toContain('AHK 1 · PS 1')
    expect(within(fileList()).getAllByText('mine')).toHaveLength(1)
    expect(within(fileList()).getByText('Yours')).toBeTruthy()
    expect(within(fileList()).getByText('Shared')).toBeTruthy()

    const chrome = pairButton('custom/chrome')
    const ahk = repoCount(CHROME_AHK, 'ahk')
    const ps = repoCount(CHROME_PS, 'ps')
    expect(ahk).toBeGreaterThan(0)
    expect(chrome.textContent).toContain(`AHK ${ahk} · PS ${ps}`)
    expect(within(fileList()).getAllByText('custom/chrome')).toHaveLength(1)
    // The first pair is shown until another is chosen.
    expect(buttons[0].getAttribute('aria-current')).toBe('true')
    expect(chrome.getAttribute('aria-current')).toBeNull()
  })

  it('marks a pair whose languages differ', async () => {
    await start({ files: { ...MINE, 'local/ahk/odd.ahk': 'Odd(Macro)\n{\n}\n' } })
    const odd = pairButton('odd')
    expect(within(odd).getByLabelText('languages differ')).toBeTruthy()
    // A missing file shows a dash.
    expect(odd.textContent).toContain('AHK 1 · PS —')
    expect(within(pairButton('mine')).queryByLabelText('languages differ')).toBeNull()
  })

  it('opens on the language you run', async () => {
    const { user } = await start({ languages: ['ps'] })
    await user.click(pairButton('custom/chrome'))
    expect(langButton('PowerShell').getAttribute('aria-pressed')).toBe('true')
    expect(langButton('AutoHotkey').getAttribute('aria-pressed')).toBe('false')
    expect(text()).toBe(readRepoText(CHROME_PS))
    expect(editorView().contentDOM.getAttribute('aria-label')).toBe('PowerShell code')
    expect(within(screen.getByRole('toolbar')).getByText(CHROME_PS)).toBeTruthy()
  })

  it('saves exactly the edited text and keeps a missing final newline', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const before = folder.text(CHROME_AHK)!
    expect(before.endsWith('\n')).toBe(false)
    const eol = eolOf(folder, CHROME_AHK)

    typeAt(0, '; x\n')
    await save(user, 'chrome.ahk')
    expect(folder.text(CHROME_AHK)).toBe(`; x${eol}${before}`)
    expect(await folder.readBytes(`${CHROME_AHK}.bak`)).toBeNull()
    expect(screen.getByText('Saved chrome.ahk.').getAttribute('role')).toBe('status')

    // The next edit of the file hides the note.
    typeAt(0, ';')
    expect(screen.queryByText('Saved chrome.ahk.')).toBeNull()
  })

  it('keeps what is typed during the write, and a second click joins the save', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const write = folder.writeBytes.bind(folder)
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let writes = 0
    folder.writeBytes = async (path, data) => {
      if (path === CHROME_AHK) {
        writes++
        await gate
      }
      return write(path, data)
    }

    typeAt(0, '; one\n')
    const first = seen.actions.saveCommandFile(CHROME_AHK)
    await user.click(saveButton('chrome.ahk'))
    expect(seen.actions.saveCommandFile(CHROME_AHK)).toBe(first)
    typeAt(0, ';')
    await act(async () => {
      release()
      expect(await first).toBe('saved')
    })
    expect(writes).toBe(1)
    expect(folder.text(CHROME_AHK)).toBe(`; one${eol}${original}`)
    // The later typing is still unsaved.
    expect(text()).toBe(`;; one\n${original.replaceAll('\r\n', '\n')}`)
    expect(saveButton('chrome.ahk').disabled).toBe(false)
    // It is now made on what was written, so its own save goes through.
    await save(user, 'chrome.ahk')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(folder.text(CHROME_AHK)).toBe(`;; one${eol}${original}`)
  })

  it('keeps CRLF and BOM when saving', async () => {
    const path = 'local/ahk/crlf.ahk'
    const { user, folder } = await start({
      files: { [path]: new Uint8Array([...BOM, ...enc.encode('A(Macro)\r\n{\r\n}\r\n')]) },
    })
    await user.click(pairButton('crlf'))
    expect(text()).toBe('A(Macro)\n{\n}\n')
    typeAt(0, '; x\n')
    // Ctrl+S in the editor saves too.
    fireEvent.keyDown(editorView().contentDOM, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => expect(saveButton('crlf.ahk').disabled).toBe(true))
    expect(await bytesOf(folder, path)).toEqual([...BOM, ...enc.encode('; x\r\nA(Macro)\r\n{\r\n}\r\n')])
  })

  it('Save is disabled until the text changes, and again after undoing the change', async () => {
    const { user } = await start()
    await user.click(pairButton('custom/chrome'))
    expect(saveButton('chrome.ahk').disabled).toBe(true)
    typeAt(0, '; x\n')
    expect(saveButton('chrome.ahk').disabled).toBe(false)
    expect(within(langButton('AutoHotkey')).getByLabelText('unsaved changes')).toBeTruthy()
    expect(within(pairButton('custom/chrome')).getByLabelText('unsaved changes')).toBeTruthy()
    undo()
    expect(saveButton('chrome.ahk').disabled).toBe(true)
    expect(within(langButton('AutoHotkey')).queryByLabelText('unsaved changes')).toBeNull()
    expect(editor().commands.drafts).toEqual({})
  })

  it('refuses to save over an outside change and offers Reload from disk or Overwrite anyway', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    typeAt(0, '; mine\n')
    const outside = enc.encode(`; theirs${eol}${original}`)
    await folder.writeBytes(CHROME_AHK, outside)

    await user.click(saveButton('chrome.ahk'))
    const dialog = await screen.findByRole('dialog', { name: 'chrome.ahk changed on disk since you opened it.' })
    expect(dialog.textContent).toContain(
      `Something else edited ${CHROME_AHK} after the configurator loaded it, so nothing was saved.`,
    )
    expect(within(dialog).getByRole('button', { name: 'Reload from disk' })).toBeTruthy()
    // A refused save writes nothing, not even the .bak.
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(outside))
    expect(await folder.readBytes(`${CHROME_AHK}.bak`)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Overwrite anyway' }))
    const confirm = await screen.findByRole('dialog', { name: 'Overwrite anyway?' })
    expect(confirm.textContent).toContain(`A copy of it is kept as ${CHROME_AHK}.bak.`)
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(outside))
    await user.click(within(confirm).getByRole('button', { name: 'Overwrite anyway' }))

    await waitFor(() => expect(saveButton('chrome.ahk').disabled).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(folder.text(CHROME_AHK)).toBe(`; mine${eol}${original}`)
    expect(await bytesOf(folder, `${CHROME_AHK}.bak`)).toEqual(Array.from(outside))

    // The overwritten version is now the one held, so the next save goes through.
    typeAt(0, ';')
    await save(user, 'chrome.ahk')
    expect(folder.text(CHROME_AHK)).toBe(`;; mine${eol}${original}`)
  })

  it('Overwrite anyway refuses when the file changes again after the copy to .bak', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    typeAt(0, '; mine\n')
    const outside = enc.encode(`; theirs${eol}${original}`)
    const newer = enc.encode(`; newer${eol}${original}`)
    await folder.writeBytes(CHROME_AHK, outside)
    const write = folder.writeBytes.bind(folder)
    folder.writeBytes = async (path, data) => {
      await write(path, data)
      // Another program writes the file again right after the copy.
      if (path === `${CHROME_AHK}.bak`) await write(CHROME_AHK, newer)
    }

    await user.click(saveButton('chrome.ahk'))
    const conflict = 'chrome.ahk changed on disk since you opened it.'
    await user.click(within(await screen.findByRole('dialog', { name: conflict })).getByRole('button', { name: 'Overwrite anyway' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Overwrite anyway?' })).getByRole('button', { name: 'Overwrite anyway' }),
    )
    // The newer edit is not in the .bak, so it is not overwritten: the conflict dialog comes back.
    expect(await screen.findByRole('dialog', { name: conflict })).toBeTruthy()
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(newer))
    expect(await bytesOf(folder, `${CHROME_AHK}.bak`)).toEqual(Array.from(outside))
    expect(saveButton('chrome.ahk').disabled).toBe(false)
  })

  it('Overwrite anyway writes nothing when the .bak cannot be written', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    typeAt(0, '; mine\n')
    const outside = enc.encode(`; theirs${eol}${original}`)
    await folder.writeBytes(CHROME_AHK, outside)
    const write = folder.writeBytes.bind(folder)
    folder.writeBytes = async (path, data) => {
      if (path === `${CHROME_AHK}.bak`) throw new Error('Access is denied.')
      return write(path, data)
    }

    await user.click(saveButton('chrome.ahk'))
    const conflict = 'chrome.ahk changed on disk since you opened it.'
    await user.click(within(await screen.findByRole('dialog', { name: conflict })).getByRole('button', { name: 'Overwrite anyway' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Overwrite anyway?' })).getByRole('button', { name: 'Overwrite anyway' }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(`${CHROME_AHK} was not saved: Access is denied.`)
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(outside))
    expect(await folder.readBytes(`${CHROME_AHK}.bak`)).toBeNull()
    expect(saveButton('chrome.ahk').disabled).toBe(false)
  })

  it('Reload from disk asks before dropping unsaved changes', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    typeAt(0, '; mine\n')
    await folder.writeBytes(CHROME_AHK, enc.encode(`; theirs${eol}${original}`))

    await user.click(toolbarReload())
    let dialog = screen.getByRole('dialog', { name: 'Discard your changes to chrome.ahk?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(text().startsWith('; mine\n')).toBe(true)
    expect(saveButton('chrome.ahk').disabled).toBe(false)

    await user.click(toolbarReload())
    dialog = screen.getByRole('dialog', { name: 'Discard your changes to chrome.ahk?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard and reload' }))
    await waitFor(() => expect(text()).toBe(`; theirs\n${original.replaceAll('\r\n', '\n')}`))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saveButton('chrome.ahk').disabled).toBe(true)

    // The reloaded version is the one the next save checks against.
    typeAt(0, ';')
    await save(user, 'chrome.ahk')
    expect(folder.text(CHROME_AHK)).toBe(`;; theirs${eol}${original}`)

    // Without unsaved changes it reloads straight away.
    await folder.writeBytes(CHROME_AHK, enc.encode('Fresh(Macro)\n{\n}\n'))
    await user.click(toolbarReload())
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(text()).toBe('Fresh(Macro)\n{\n}\n'))
  })

  it('keeps unsaved edits per file while switching files, languages and tabs', async () => {
    const { user } = await start()
    await user.click(pairButton('custom/chrome'))
    typeAt(0, '; ahk edit\n')
    await user.click(langButton('PowerShell'))
    expect(text()).toBe(readRepoText(CHROME_PS))
    expect(within(langButton('AutoHotkey')).getByLabelText('unsaved changes')).toBeTruthy()
    typeAt(0, '# ps edit\n')

    await user.click(pairButton('custom/ssh'))
    expect(langButton('PowerShell').getAttribute('aria-pressed')).toBe('true')
    expect(text()).toBe(readRepoText('powershell/commands/custom/ssh.ps1'))
    expect(within(pairButton('custom/chrome')).getByLabelText('unsaved changes')).toBeTruthy()
    expect(within(pairButton('custom/ssh')).queryByLabelText('unsaved changes')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Macros' }))
    await user.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(pairButton('custom/ssh').getAttribute('aria-current')).toBe('true')
    await user.click(pairButton('custom/chrome'))
    expect(text()).toBe(`# ps edit\n${readRepoText(CHROME_PS)}`)
    expect(saveButton('chrome.ps1').disabled).toBe(false)
    await user.click(langButton('AutoHotkey'))
    expect(text()).toBe(`; ahk edit\n${readRepoText(CHROME_AHK)}`)
    expect(saveButton('chrome.ahk').disabled).toBe(false)
  })

  it('a save updates the Macros palette at once', async () => {
    const { user } = await start({ files: MINE })
    await user.click(pairButton('mine'))
    typeAt(docEnd(), '\nNewOne(Macro)\n{\n}')
    await save(user, 'mine.ahk')
    expect(pairButton('mine').textContent).toContain('AHK 2 · PS 1')
    await user.click(screen.getByRole('tab', { name: 'Macros' }))
    const palette = screen.getByRole('region', { name: 'Commands' })
    expect(palette.querySelector('[data-command="NewOne"]')).not.toBeNull()
  })

  it('does not edit a file that is not UTF-8', async () => {
    const path = 'local/ahk/latin.ahk'
    const raw = new Uint8Array([...enc.encode('L(Macro)\n{\n; caf'), 0xe9, ...enc.encode('\n}\n')])
    const { user, folder } = await start({ files: { [path]: raw } })
    await user.click(pairButton('latin'))
    expect(editorView().state.readOnly).toBe(true)
    expect(screen.getByText(`${path} is not UTF-8 text, so the configurator will not edit it.`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save latin.ahk' })).toBeNull()

    // Even a draft sent by hand is refused, and so is a save.
    act(() => seen.dispatch({ type: 'draft', path, text: 'x', base: null }))
    expect(editor().commands.drafts).toEqual({})
    let result: string | undefined
    await act(async () => {
      result = await seen.actions.saveCommandFile(path)
    })
    expect(result).toBe('blocked')
    expect(await bytesOf(folder, path)).toEqual(Array.from(raw))
  })

  it('keeps command edits when config.json is reloaded from disk', async () => {
    const { user, folder } = await start()
    const reloadConfig = async (title: string) => {
      await folder.writeBytes(CONFIG, enc.encode(EXAMPLE.replace('"title": "Media"', `"title": "${title}"`)))
      fireEvent.focus(window)
      const banner = (await screen.findByText('config.json changed on disk.')).closest('[role]') as HTMLElement
      await user.click(within(banner).getByRole('button', { name: 'Reload from disk' }))
      await waitFor(() => expect(editor().ws.slots.k1.title).toBe(title))
    }
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const lf = original.replaceAll('\r\n', '\n')
    typeAt(0, '; mine\n')
    // An outside edit of a file without unsaved changes is picked up by the reload.
    await folder.writeBytes(SSH_AHK, enc.encode('Ssh(Macro)\n{\n}\n'))
    await reloadConfig('Music')

    expect(text()).toBe(`; mine\n${lf}`)
    expect(saveButton('chrome.ahk').disabled).toBe(false)
    // Undoing the edit still compares with the text it was made on.
    undo()
    expect(saveButton('chrome.ahk').disabled).toBe(true)
    typeAt(0, '; mine\n')
    await save(user, 'chrome.ahk')
    expect(folder.text(CHROME_AHK)).toBe(`; mine${eol}${original}`)

    // An edit made before an outside change is still checked against the version it was made on.
    typeAt(0, ';')
    await folder.writeBytes(CHROME_AHK, enc.encode(`; theirs${eol}${original}`))
    await reloadConfig('Tunes')
    expect(text()).toBe(`;; mine\n${lf}`)
    await user.click(saveButton('chrome.ahk'))
    expect(await screen.findByRole('dialog', { name: 'chrome.ahk changed on disk since you opened it.' })).toBeTruthy()
    expect(folder.text(CHROME_AHK)).toBe(`; theirs${eol}${original}`)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    // Typing back the text the edit was made on leaves nothing to save.
    replaceAll(`; mine\n${lf}`)
    expect(saveButton('chrome.ahk').disabled).toBe(true)

    await user.click(pairButton('custom/ssh'))
    expect(text()).toBe('Ssh(Macro)\n{\n}\n')
  })

  it('a config.json reload in the same tick as an edit still checks the edit against its version', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const outside = enc.encode(`; theirs${eol}${original}`)
    await folder.writeBytes(CHROME_AHK, outside)
    const view = editorView()
    await act(async () => {
      // The user types, and the reload reads the folder before React commits the edit.
      view.dispatch({ changes: { from: 0, insert: '; mine\n' }, annotations: Transaction.userEvent.of('input.type') })
      await seen.actions.reloadFromDisk()
    })
    expect(text()).toBe(`; mine\n${original.replaceAll('\r\n', '\n')}`)

    await user.click(saveButton('chrome.ahk'))
    expect(await screen.findByRole('dialog', { name: 'chrome.ahk changed on disk since you opened it.' })).toBeTruthy()
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(outside))
  })

  it('a command save that lands during a config.json reload keeps the saved version', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const lf = original.replaceAll('\r\n', '\n')
    typeAt(0, '; mine\n')

    // The reload's scan pauses on a file it reads after chrome.ahk.
    const read = folder.readBytes.bind(folder)
    let armed = true
    let reached = () => {}
    const atGate = new Promise<void>((resolve) => (reached = resolve))
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    folder.readBytes = async (path) => {
      const bytes = await read(path)
      if (armed && path === 'ahk/commands/custom/examples.ahk') {
        armed = false
        reached()
        await gate
      }
      return bytes
    }
    let reload: Promise<void> | undefined
    await act(async () => {
      reload = seen.actions.reloadFromDisk()
      await atGate
    })
    // The scan already holds chrome.ahk as it was; now the save writes it.
    await act(async () => {
      expect(await seen.actions.saveCommandFile(CHROME_AHK)).toBe('saved')
    })
    await act(async () => {
      release()
      await reload
    })

    expect(text()).toBe(`; mine\n${lf}`)
    expect(saveButton('chrome.ahk').disabled).toBe(true)
    typeAt(0, ';')
    await save(user, 'chrome.ahk')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(folder.text(CHROME_AHK)).toBe(`;; mine${eol}${original}`)
  })

  it('choosing the file already shown keeps a pending jump', async () => {
    const { user } = await start()
    const path = 'ahk/commands/custom/automation.ahk'
    // The first pair is shown without being chosen.
    expect(pairButton('custom/automation').getAttribute('aria-current')).toBe('true')
    act(() => seen.dispatch({ type: 'jump', path, line: 3 }))
    await user.click(pairButton('custom/automation'))
    await user.click(langButton('AutoHotkey'))
    expect(editor().commands.jump).toEqual({ path, line: 3, n: 1 })

    // Another file drops it, so coming back does not jump again.
    await user.click(langButton('PowerShell'))
    expect(editor().commands.jump).toBeNull()
  })

  it('asks before opening another folder with unsaved command edits', async () => {
    const { user } = await start()
    await user.click(pairButton('custom/chrome'))
    typeAt(0, '; x\n')
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    let dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' })
    expect(dialog.textContent).toContain(
      `Your changes to ${CHROME_AHK} have not been saved. Opening another folder discards them.`,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // With config.json unsaved too, both are named.
    act(() => seen.dispatch({ type: 'edit', ws: renameKey(editor().ws, 'k1', 'F1') }))
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' })
    expect(dialog.textContent).toContain(`Your changes to ${CONFIG}, ${CHROME_AHK} have not been saved.`)
  })

  it('asks before closing the window with unsaved command edits', async () => {
    const leaveIsStopped = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    const { user } = await start()
    await user.click(pairButton('custom/chrome'))
    expect(leaveIsStopped()).toBe(false)
    typeAt(0, '; x\n')
    expect(leaveIsStopped()).toBe(true)
    await save(user, 'chrome.ahk')
    expect(leaveIsStopped()).toBe(false)
  })

  it('says when the chosen language has no file', async () => {
    const files = { 'local/ahk/odd.ahk': 'Odd(Macro)\n{\n}\n' }
    const a = await start({ files })
    await a.user.click(pairButton('odd'))
    await a.user.click(langButton('PowerShell'))
    expect(
      screen.getByText('There is no PowerShell file for odd yet. Its commands will not load in PowerShell, which you run.'),
    ).toBeTruthy()
    expect(document.querySelector('.cm-editor')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Save odd/ })).toBeNull()
    cleanup()

    const b = await start({ languages: ['ahk'], files })
    await b.user.click(pairButton('odd'))
    await b.user.click(langButton('PowerShell'))
    expect(screen.getByText("There is no PowerShell file for odd. That's fine: you don't run PowerShell.")).toBeTruthy()
    // The other language is one click away.
    await b.user.click(langButton('AutoHotkey'))
    expect(text()).toBe('Odd(Macro)\n{\n}\n')
  })
})

describe('outside changes', () => {
  const CHANGED = 'chrome.ahk changed on disk.'
  /** The Commands tab's banner for chrome.ahk, if it shows. */
  const queryBanner = () => (screen.queryByText(CHANGED)?.closest('[role]') ?? null) as HTMLElement | null
  const chromeDot = () => within(pairButton('custom/chrome')).queryByLabelText('changed on disk')
  /** Runs a recheck of the command files and waits for it. */
  const recheckCommands = () =>
    act(async () => {
      await seen.actions.recheckCommands()
    })
  /** Lets every promise chain that waits on nothing run to its end. */
  const drain = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

  it('shows an outside edit of a file without unsaved changes', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const count = repoCount(CHROME_AHK, 'ahk')
    const theirs = `; theirs${eol}${original}${eol}Theirs(Macro)${eol}{${eol}}${eol}`
    await folder.writeBytes(CHROME_AHK, enc.encode(theirs))

    fireEvent.focus(window)
    await waitFor(() => expect(text()).toBe(theirs.replaceAll('\r\n', '\n')))
    expect(queryBanner()).toBeNull()
    expect(chromeDot()).toBeNull()
    expect(saveButton('chrome.ahk').disabled).toBe(true)
    // The palette stays current.
    expect(pairButton('custom/chrome').textContent).toContain(`AHK ${count + 1}`)

    // The new version is the one the next save checks against.
    typeAt(0, ';')
    await save(user, 'chrome.ahk')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(folder.text(CHROME_AHK)).toBe(`;${theirs}`)
  })

  it('keeps unsaved edits when the file changes on disk and says so', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const lf = original.replaceAll('\r\n', '\n')
    typeAt(0, '; mine\n')
    const outside = enc.encode(`; theirs${eol}${original}`)
    await folder.writeBytes(CHROME_AHK, outside)

    fireEvent.focus(window)
    expect(await screen.findByText(CHANGED)).toBeTruthy()
    expect(queryBanner()!.getAttribute('role')).toBe('alert')
    expect(text()).toBe(`; mine\n${lf}`)
    expect(saveButton('chrome.ahk').disabled).toBe(false)
    expect(chromeDot()).toBeTruthy()
    expect(within(pairButton('custom/ssh')).queryByLabelText('changed on disk')).toBeNull()

    // The edit is still checked against the version it was made on.
    await user.click(saveButton('chrome.ahk'))
    const conflict = await screen.findByRole('dialog', { name: 'chrome.ahk changed on disk since you opened it.' })
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(outside))
    await user.click(within(conflict).getByRole('button', { name: 'Cancel' }))
    expect(queryBanner()).toBeTruthy()

    // The banner's Reload from disk asks first, like the toolbar's.
    await user.click(within(queryBanner()!).getByRole('button', { name: 'Reload from disk' }))
    let confirm = screen.getByRole('dialog', { name: 'Discard your changes to chrome.ahk?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(text()).toBe(`; mine\n${lf}`)
    await user.click(within(queryBanner()!).getByRole('button', { name: 'Reload from disk' }))
    confirm = screen.getByRole('dialog', { name: 'Discard your changes to chrome.ahk?' })
    await user.click(within(confirm).getByRole('button', { name: 'Discard and reload' }))
    await waitFor(() => expect(text()).toBe(`; theirs\n${lf}`))
    expect(queryBanner()).toBeNull()
    expect(chromeDot()).toBeNull()
    expect(saveButton('chrome.ahk').disabled).toBe(true)
  })

  it('a dismissed banner returns only for a newer change', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    typeAt(0, '; mine\n')
    await folder.writeBytes(CHROME_AHK, enc.encode(`; theirs${eol}${original}`))
    await recheckCommands()
    await user.click(within(queryBanner()!).getByRole('button', { name: 'Dismiss' }))
    expect(queryBanner()).toBeNull()
    // The file still differs from the disk.
    expect(chromeDot()).toBeTruthy()

    await recheckCommands()
    fireEvent.focus(window)
    await drain()
    expect(queryBanner()).toBeNull()

    await folder.writeBytes(CHROME_AHK, enc.encode(`; newer${eol}${original}`))
    await recheckCommands()
    expect(queryBanner()).toBeTruthy()
    expect(text().startsWith('; mine\n')).toBe(true)
  })

  it('lists a command file created outside the app', async () => {
    const { folder } = await start()
    expect(within(fileList()).queryByText('fresh')).toBeNull()
    await folder.writeBytes('local/ahk/fresh.ahk', enc.encode('Fresh(Macro)\n{\n}\n'))
    fireEvent.focus(window)
    expect(await within(fileList()).findByText('fresh')).toBeTruthy()
    expect(pairButton('fresh').textContent).toContain('AHK 1 · PS —')
  })

  it('drops a file deleted outside the app that has no unsaved changes', async () => {
    const { user, folder } = await start({ files: MINE })
    await user.click(pairButton('custom/chrome'))
    const lf = folder.text(CHROME_AHK)!.replaceAll('\r\n', '\n')
    typeAt(0, '; mine\n')
    await folder.remove('local/ahk/mine.ahk')
    await folder.remove('local/powershell/commands/mine.ps1')
    await folder.remove(CHROME_AHK)

    fireEvent.focus(window)
    await waitFor(() => expect(within(fileList()).queryByText('mine')).toBeNull())
    // A deleted file with unsaved edits stays, edits and all, and says so.
    expect(text()).toBe(`; mine\n${lf}`)
    expect(queryBanner()).toBeTruthy()
    expect(chromeDot()).toBeTruthy()
  })

  it('watches command files in Electron', async () => {
    const watch = { paths: [] as string[][], stops: 0, onChange: null as ((path: string) => void) | null }
    /** Fires the last watch for `path` and waits for the recheck it starts. */
    const fire = (path: string) =>
      act(async () => {
        await (watch.onChange?.(path) as unknown as Promise<void>)
      })
    const platform: Partial<Platform> = {
      watch: (paths, onChange) => {
        watch.paths.push(paths)
        watch.onChange = onChange
        return () => {
          watch.stops++
        }
      },
    }
    const { user, folder } = await start({ platform })
    expect(watch.paths).toHaveLength(1)
    expect(watch.paths[0]).toContain(CONFIG)
    expect(watch.paths[0]).toContain(CHROME_AHK)
    expect(watch.paths[0]).toContain(CHROME_PS)

    await user.click(pairButton('custom/chrome'))
    await folder.writeBytes(CHROME_AHK, enc.encode('Changed(Macro)\n{\n}\n'))
    await fire(CHROME_AHK)
    expect(text()).toBe('Changed(Macro)\n{\n}\n')
    // The same files: the watch stays as it is.
    expect(watch.paths).toHaveLength(1)
    expect(watch.stops).toBe(0)

    // config.json's own event rechecks config.json.
    await folder.writeBytes(CONFIG, enc.encode(EXAMPLE.replace('"title": "Media"', '"title": "Music"')))
    await fire(CONFIG)
    expect(screen.getByText('config.json changed on disk.')).toBeTruthy()

    // A file created outside is watched once a recheck finds it.
    await folder.writeBytes('local/ahk/fresh.ahk', enc.encode('Fresh(Macro)\n{\n}\n'))
    fireEvent.focus(window)
    await waitFor(() => expect(watch.paths).toHaveLength(2))
    expect(watch.paths[1]).toContain('local/ahk/fresh.ahk')
    expect(watch.paths[1]).toContain(CONFIG)
    expect(watch.stops).toBe(1)
  })

  it('never mistakes its own save for an outside change', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    typeAt(0, '; mine\n')
    const click = user.click(saveButton('chrome.ahk'))
    fireEvent.focus(window)
    await click
    await waitFor(() => expect(saveButton('chrome.ahk').disabled).toBe(true))
    await drain()
    await recheckCommands()
    expect(queryBanner()).toBeNull()
    expect(chromeDot()).toBeNull()

    // A save still writing when the window gains focus: the recheck waits for it.
    const write = folder.writeBytes.bind(folder)
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    folder.writeBytes = async (path, data) => {
      await write(path, data)
      if (path === CHROME_AHK) await gate
    }
    typeAt(0, ';')
    let saving: Promise<string> | undefined
    act(() => {
      saving = seen.actions.saveCommandFile(CHROME_AHK)
    })
    fireEvent.focus(window)
    // A recheck that did not wait would have seen the new bytes on disk by now.
    await drain()
    expect(queryBanner()).toBeNull()
    expect(chromeDot()).toBeNull()
    await act(async () => {
      release()
      expect(await saving).toBe('saved')
    })
    await drain()
    await recheckCommands()
    expect(queryBanner()).toBeNull()
    expect(chromeDot()).toBeNull()
    expect(saveButton('chrome.ahk').disabled).toBe(true)

    // A save that starts while a recheck is scanning, and is still writing when the scan ends.
    const read = folder.readBytes.bind(folder)
    let reached = () => {}
    const atScanGate = new Promise<void>((resolve) => (reached = resolve))
    let releaseScan = () => {}
    const scanGate = new Promise<void>((resolve) => (releaseScan = resolve))
    let armed = true
    folder.readBytes = async (path) => {
      // automation.ahk is read before chrome.ahk, so the scan reads chrome.ahk after the write.
      if (armed && path === 'ahk/commands/custom/automation.ahk') {
        armed = false
        reached()
        await scanGate
      }
      return read(path)
    }
    let releaseWrite = () => {}
    const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve))
    folder.writeBytes = async (path, data) => {
      await write(path, data)
      if (path === CHROME_AHK) await writeGate
    }
    let recheck: Promise<void> | undefined
    await act(async () => {
      recheck = seen.actions.recheckCommands()
      await atScanGate
    })
    typeAt(0, ';')
    act(() => {
      saving = seen.actions.saveCommandFile(CHROME_AHK)
    })
    await act(async () => {
      releaseScan()
      await recheck
    })
    expect(queryBanner()).toBeNull()
    expect(chromeDot()).toBeNull()
    await act(async () => {
      releaseWrite()
      expect(await saving).toBe('saved')
    })
    expect(queryBanner()).toBeNull()
    expect(saveButton('chrome.ahk').disabled).toBe(true)
  })

  it('a recheck that starts during a save waits for it, then picks up other outside edits', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const write = folder.writeBytes.bind(folder)
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    folder.writeBytes = async (path, data) => {
      await write(path, data)
      if (path === CHROME_AHK) await gate
    }
    typeAt(0, '; mine\n')
    let saving: Promise<string> | undefined
    act(() => {
      saving = seen.actions.saveCommandFile(CHROME_AHK)
    })
    await write(SSH_AHK, enc.encode('Ssh(Macro)\n{\n}\n'))
    fireEvent.focus(window)
    await drain()
    await act(async () => {
      release()
      expect(await saving).toBe('saved')
    })
    await drain()
    expect(queryBanner()).toBeNull()
    await user.click(pairButton('custom/ssh'))
    await user.click(langButton('AutoHotkey'))
    expect(text()).toBe('Ssh(Macro)\n{\n}\n')
  })

  it('an edit made on text a recheck just replaced saves against its own version', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const lf = original.replaceAll('\r\n', '\n')
    const oldVersion = editor().commandFiles.find((f) => f.file.path === CHROME_AHK)!.file.version
    const outside = enc.encode(`; theirs${eol}${original}`)
    await folder.writeBytes(CHROME_AHK, outside)

    await act(async () => {
      await seen.actions.recheckCommands()
      // React has not committed the new text yet, so the keystroke lands on the old one.
      seen.actions.editCommand(CHROME_AHK, `${lf}x`, oldVersion)
    })
    expect(text()).toBe(`${lf}x`)
    expect(queryBanner()).toBeTruthy()
    expect(chromeDot()).toBeTruthy()
    // A later recheck still sees the disk differ from the version the edit was made on.
    await recheckCommands()
    expect(queryBanner()).toBeTruthy()
    // Typing on after the commit carries the newer version, but the draft keeps its first one.
    typeAt(docEnd(), 'y')

    await user.click(saveButton('chrome.ahk'))
    expect(await screen.findByRole('dialog', { name: 'chrome.ahk changed on disk since you opened it.' })).toBeTruthy()
    expect(await bytesOf(folder, CHROME_AHK)).toEqual(Array.from(outside))
    expect(text()).toBe(`${lf}xy`)
  })

  it('a save that lands during a recheck keeps the saved version', async () => {
    const { user, folder } = await start()
    await user.click(pairButton('custom/chrome'))
    const eol = eolOf(folder, CHROME_AHK)
    const original = folder.text(CHROME_AHK)!
    const lf = original.replaceAll('\r\n', '\n')
    typeAt(0, '; mine\n')

    // The recheck's scan pauses on a file it reads after chrome.ahk.
    const read = folder.readBytes.bind(folder)
    let armed = true
    let reached = () => {}
    const atGate = new Promise<void>((resolve) => (reached = resolve))
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    folder.readBytes = async (path) => {
      const bytes = await read(path)
      if (armed && path === 'ahk/commands/custom/examples.ahk') {
        armed = false
        reached()
        await gate
      }
      return bytes
    }
    let recheck: Promise<void> | undefined
    await act(async () => {
      recheck = seen.actions.recheckCommands()
      await atGate
    })
    // The scan already holds chrome.ahk as it was; now the save writes it.
    await act(async () => {
      expect(await seen.actions.saveCommandFile(CHROME_AHK)).toBe('saved')
    })
    await act(async () => {
      release()
      await recheck
    })

    expect(text()).toBe(`; mine\n${lf}`)
    expect(saveButton('chrome.ahk').disabled).toBe(true)
    expect(queryBanner()).toBeNull()
    typeAt(0, ';')
    await save(user, 'chrome.ahk')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(folder.text(CHROME_AHK)).toBe(`;; mine${eol}${original}`)
  })
})
