/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

// jsdom has no canvas: the boundary where pictures are decoded and PNGs encoded is replaced. A decoded
// picture is a 4x4 red square; an encoded PNG is two bytes holding the picture's size.
vi.mock('./iconCodec', () => {
  const square = (side: number) => ({ width: side, height: side, data: new Uint8ClampedArray(side * side * 4).fill(255) })
  return {
    decodePicture: vi.fn(async () => square(4)),
    decodePng: vi.fn(async () => square(64)),
    encodePng: vi.fn(async (image: { width: number; height: number }) => new Uint8Array([image.width % 256, image.height % 256])),
  }
})

beforeEach(() => {
  let counter = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++counter}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

function folderFromRepo() {
  return memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
}

async function openIcons() {
  const folder = folderFromRepo()
  const enc = new TextEncoder()
  await folder.writeBytes('local/config.json', enc.encode(readRepoText('config.json')))
  await folder.writeBytes(SETTINGS_PATH, enc.encode('{ "languages": ["ahk"] }\n'))
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, createFolder: async () => null, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform} updateSource={null}>
      <App />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  await user.click(screen.getByRole('tab', { name: 'Icons' }))
  return { user, folder }
}

const PICTURE = () => new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })

/** Starts a new icon set with a picture and the name typed. */
async function startNew(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: '+ New icon set' }))
  await user.type(screen.getByLabelText('Name (the folder)'), name)
  await user.upload(screen.getByLabelText(/^Picture/), PICTURE())
  await screen.findByRole('img', { name: 'Layer 1x1' })
}

const create = () => screen.getByRole('button', { name: 'Create icon set' })

const FOUR = ['layer.png', 'macro.png', 'selected.png', 'selected_macro.png']

describe('the Icons tab', () => {
  it('lists the icon sets and the generated empty key frames', async () => {
    await openIcons()
    const list = screen.getByRole('list', { name: 'Icon sets' })
    for (const name of ['chrome', 'media', 'windows']) expect(within(list).getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Empty key frames' })).toBeTruthy()
  })

  it('writes a new set to local/img with its source picture and recipe', async () => {
    const { user, folder } = await openIcons()
    await startNew(user, 'my_set')
    await user.click(create())
    await waitFor(async () => expect(await folder.readBytes('local/img/my_set/icon.json')).not.toBeNull())
    for (const f of [...FOUR, 'source.png']) expect(await folder.readBytes(`local/img/my_set/${f}`)).not.toBeNull()
    expect(JSON.parse(folder.text('local/img/my_set/icon.json') ?? '')).toEqual({
      fit: 'contain',
      padding: 8,
      background: '#8e8cd8',
      outline: '#000000',
      sizes: ['1x1'],
    })
    // The rest of the app sees the set at once.
    const list = await screen.findByRole('list', { name: 'Icon sets' })
    expect(within(list).getByRole('button', { name: /^my_set/ })).toBeTruthy()
    expect(await folder.readBytes('img/my_set/layer.png')).toBeNull()
  })

  it('writes to img when Shared is chosen, and makes the other sizes that were ticked', async () => {
    const { user, folder } = await openIcons()
    await startNew(user, 'tall')
    await user.click(screen.getByRole('radio', { name: /Shared/ }))
    await user.click(screen.getByRole('checkbox', { name: /1×2/ }))
    await user.click(create())
    await waitFor(async () => expect(await folder.readBytes('img/tall/icon.json')).not.toBeNull())
    for (const f of ['layer_1x2.png', 'macro_1x2.png', 'selected_1x2.png', 'selected_macro_1x2.png', ...FOUR]) {
      expect(await folder.readBytes(`img/tall/${f}`), f).not.toBeNull()
    }
    expect(await folder.readBytes('local/img/tall/layer.png')).toBeNull()
    expect(JSON.parse(folder.text('img/tall/icon.json') ?? '').sizes).toEqual(['1x1', '1x2'])
  })

  it('refuses a name with anything but a to z, 0 to 9 and _', async () => {
    const { user, folder } = await openIcons()
    await startNew(user, 'My Set')
    expect(screen.getByText(/Use only a to z/)).toBeTruthy()
    expect((create() as HTMLButtonElement).disabled).toBe(true)
    expect(await folder.readBytes('local/img/My Set/layer.png')).toBeNull()
  })

  it('needs a name and a picture', async () => {
    const { user } = await openIcons()
    await user.click(screen.getByRole('button', { name: '+ New icon set' }))
    expect((create() as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Name (the folder)'), 'ok_name')
    expect((create() as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks before it replaces files, and leaves them when asked not to', async () => {
    const { user, folder } = await openIcons()
    await folder.writeBytes('local/img/again/layer.png', new Uint8Array([1]))
    await startNew(user, 'again')
    await user.click(create())
    const dialog = await screen.findByRole('dialog', { name: 'Replace existing files?' })
    expect(within(dialog).getByText('local/img/again/layer.png')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect([...((await folder.readBytes('local/img/again/layer.png')) ?? [])]).toEqual([1])
    expect(await folder.readBytes('local/img/again/macro.png')).toBeNull()

    await user.click(create())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace' }))
    await waitFor(async () => expect(await folder.readBytes('local/img/again/macro.png')).not.toBeNull())
    expect([...((await folder.readBytes('local/img/again/layer.png')) ?? [])]).toEqual([64, 64])
  })

  it('shows a shipped set with its recipe missing, where it is used and what is on disk now', async () => {
    const { user } = await openIcons()
    await user.click(screen.getByRole('button', { name: /^chrome/ }))
    expect(await screen.findByText(/No icon.json/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Used by' })).toBeTruthy()
    expect(await screen.findByRole('img', { name: 'On disk Layer 1x1' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Layer 1x1' })).toBeTruthy()
  })

  it('redraws a shipped set from its layer.png with no padding, and keeps that picture as source.png', async () => {
    const { user, folder } = await openIcons()
    await user.click(screen.getByRole('button', { name: /^chrome/ }))
    await screen.findByRole('img', { name: 'Layer 1x1' })
    await user.click(screen.getByRole('button', { name: 'Save icon set' }))
    const dialog = await screen.findByRole('dialog', { name: 'Replace existing files?' })
    expect(within(dialog).getByText('img/chrome/macro.png')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }))
    await waitFor(async () => expect(await folder.readBytes('img/chrome/source.png')).not.toBeNull())
    expect(JSON.parse(folder.text('img/chrome/icon.json') ?? '')).toMatchObject({ padding: 0, sizes: expect.arrayContaining(['1x1']) })
    // The recipe is now shown in the right panel, read again after the write.
    expect(await screen.findByText(/"padding": 0/)).toBeTruthy()
  })

  it('writes empty key frames of the chosen sizes to img', async () => {
    const { user, folder } = await openIcons()
    await user.click(screen.getByRole('button', { name: 'Empty key frames' }))
    expect(await screen.findByRole('img', { name: 'Frame 1x1' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Write empty key frames' }))
    // The shipped frames are there: the answer is asked first.
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace' }))
    await waitFor(async () => expect(await folder.readBytes('img/empty_1x1.png')).toEqual(new Uint8Array([64, 64])))

    // The size to add is 3 wide and 1 high to begin with.
    await user.click(screen.getByRole('button', { name: 'Add size' }))
    await user.click(screen.getByRole('button', { name: 'Write empty key frames' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace' }))
    await waitFor(async () => expect(await folder.readBytes('img/empty_3x1.png')).toEqual(new Uint8Array([192, 64])))
  })
})
