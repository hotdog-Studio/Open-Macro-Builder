/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../core/config/model'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider, useApp } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'
import { useAsset } from './useAsset'

/** jsdom has no object URLs: hand out numbered ones and remember which are alive. */
const made = new Map<string, Blob>()
const revoked: string[] = []
let counter = 0

beforeEach(() => {
  made.clear()
  revoked.length = 0
  counter = 0
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${++counter}`
    made.set(url, blob)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  })
})

afterEach(cleanup)

/** Hands the test whatever useApp() gives the components. */
let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useEffect(() => {
    seen = app
  })
  return null
}

function ws(): Workspace {
  if (seen.state.screen !== 'edit') throw new Error('expected the editor')
  return seen.state.ws
}

function folderFromRepo() {
  return memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
}

async function start(folder = folderFromRepo(), extra: React.ReactNode = null) {
  const enc = new TextEncoder()
  await folder.writeBytes('local/config.json', enc.encode(readRepoText('config.json')))
  await folder.writeBytes(SETTINGS_PATH, enc.encode('{ "languages": ["ahk"] }\n'))
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
      <App />
      <Probe />
      {extra}
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  return { user, folder }
}

async function openLayers() {
  const app = await start()
  await app.user.click(screen.getByRole('tab', { name: 'Layers' }))
  return app
}

/** A key button by its layer title, with or without the start star in its name. */
const layerKey = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}( Start layer)?$`) })
const shelf = () => screen.getByRole('group', { name: 'Parked' })

describe('Layers tab', () => {
  it("shows each key's layer and marks the start layer", async () => {
    await openLayers()
    expect(screen.getByText('What each key selects while Fn is held.')).toBeTruthy()
    // The title sits in the label strip above the key, the icon inside it.
    expect(screen.getByText('Media')).toBeTruthy()
    expect(screen.getByText('Programs')).toBeTruthy()
    await waitFor(() => expect(within(layerKey('Media')).getByRole('img', { name: 'Media' }).getAttribute('src')).toMatch(/^blob:/))
    // The example starts on the first layer.
    expect(ws().options.defaultKey).toBe('k1')
    expect(screen.getAllByLabelText('Start layer')).toHaveLength(1)
    expect(within(layerKey('Media')).getByLabelText('Start layer')).toBeTruthy()
    expect(within(layerKey('Programs')).queryByLabelText('Start layer')).toBeNull()
  })

  it('draws the icon from the layer.png of its icon set', async () => {
    const { folder } = await openLayers()
    const bytes = await folder.readBytes('img/media/layer.png')
    const src = await waitFor(() => {
      const s = within(layerKey('Media')).getByRole('img', { name: 'Media' }).getAttribute('src')
      expect(s).toMatch(/^blob:/)
      return s as string
    })
    const blob = made.get(src)
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBe(bytes?.length)
  })

  it('renaming and changing the icon update the layer', async () => {
    const { user } = await openLayers()
    await user.click(layerKey('Programs'))
    const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    expect(title.value).toBe('Programs')
    await user.clear(title)
    await user.type(title, 'Apps')
    expect(ws().slots.k2.title).toBe('Apps')
    expect(screen.getByText('Apps')).toBeTruthy()

    expect(ws().slots.k2.icon).toBe('programs')
    await user.click(screen.getByRole('button', { name: 'windows' }))
    expect(ws().slots.k2.icon).toBe('windows')
    expect(screen.getByRole('button', { name: 'windows' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'programs' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('Start on this layer moves the star', async () => {
    const { user } = await openLayers()
    await user.click(layerKey('Programs'))
    await user.click(screen.getByRole('button', { name: 'Start on this layer' }))
    expect(ws().options.defaultKey).toBe('k2')
    expect(screen.getAllByLabelText('Start layer')).toHaveLength(1)
    expect(within(layerKey('Programs')).getByLabelText('Start layer')).toBeTruthy()
    expect(within(layerKey('Media')).queryByLabelText('Start layer')).toBeNull()
  })

  it('New layer appears on the Parked shelf', async () => {
    const { user } = await openLayers()
    expect(within(shelf()).queryByText('New layer')).toBeNull()
    expect(within(shelf()).getByText('Saved as "disabled": true.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '+ New layer' }))
    expect(within(shelf()).getByText('New layer')).toBeTruthy()
    expect(ws().parked).toHaveLength(1)
    expect(ws().parked[0].title).toBe('New layer')
    expect(ws().parked[0].icon).toBe('default_commands')
  })

  it('Park layer moves it to the shelf and clears the star when it was the start layer', async () => {
    const { user } = await openLayers()
    await user.click(layerKey('Media'))
    await user.click(screen.getByRole('button', { name: 'Park layer' }))
    expect(ws().slots.k1).toBeUndefined()
    expect(ws().parked.map((l) => l.title)).toEqual(['Media'])
    expect(ws().options.defaultKey).toBeNull()
    expect(screen.queryAllByLabelText('Start layer')).toHaveLength(0)
    expect(within(shelf()).getByText('Media')).toBeTruthy()
    // The key is empty now and has no layer to edit.
    expect(screen.getByText('No layer on this key.')).toBeTruthy()
  })

  it('Edit macros opens the Macros tab on that layer', async () => {
    const { user } = await openLayers()
    await user.click(layerKey('Programs'))
    const id = ws().slots.k2.id
    await user.click(screen.getByRole('button', { name: 'Edit macros →' }))
    expect(seen.state.screen === 'edit' && seen.state.tab).toBe('macros')
    expect(seen.state.screen === 'edit' && seen.state.selectedLayer).toBe(id)
    expect(screen.getByRole('tab', { name: 'Macros' }).getAttribute('aria-selected')).toBe('true')
  })

  it('says so when nothing is selected, and for a key without a layer', async () => {
    const { user } = await openLayers()
    expect(screen.getByText('Select a key.')).toBeTruthy()
    await user.click(layerKey('Media'))
    await user.click(screen.getByRole('button', { name: 'Park layer' }))
    expect(screen.getByText('No layer on this key.')).toBeTruthy()
  })
})

function Show({ path }: Readonly<{ path: string | null }>) {
  const url = useAsset(path)
  return <output data-testid={`asset-${path}`}>{url ?? 'none'}</output>
}

describe('useAsset', () => {
  it('gives an object URL for a file in the folder, and shares it between users of the same path', async () => {
    await start(folderFromRepo(), (
      <>
        <Show path="img/media/layer.png" />
        <Show path="img/media/layer.png" />
      </>
    ))
    const [a, b] = await waitFor(() => {
      const out = screen.getAllByTestId('asset-img/media/layer.png').map((o) => o.textContent)
      expect(out[0]).toMatch(/^blob:/)
      return out
    })
    expect(a).toBe(b)
    // Twice on screen, one object URL made.
    expect(made.size).toBe(1)
    expect(made.get(a)?.type).toBe('image/png')
  })

  it('gives null for a missing file or no path', async () => {
    await start(folderFromRepo(), (
      <>
        <Show path="img/media/layer.png" />
        <Show path="img/nope/layer.png" />
        <Show path={null} />
        <Show path="../outside.png" />
      </>
    ))
    // The real file has loaded, so the reads of the others have had their turn too.
    await waitFor(() => expect(screen.getByTestId('asset-img/media/layer.png').textContent).toMatch(/^blob:/))
    expect(screen.getByTestId('asset-img/nope/layer.png').textContent).toBe('none')
    expect(screen.getByTestId('asset-null').textContent).toBe('none')
    expect(screen.getByTestId('asset-../outside.png').textContent).toBe('none')
    expect(made.size).toBe(1)
  })

  it('revokes the URLs it made when the component goes away', async () => {
    const { user } = await openLayers()
    await waitFor(() =>
      expect(within(layerKey('Media')).getByRole('img', { name: 'Media' }).getAttribute('src')).toMatch(/^blob:/),
    )
    const live = [...made.keys()]
    expect(live.length).toBeGreaterThan(0)
    // Back to Pad shape: the Layers tab unmounts, and nothing else uses these files.
    await user.click(screen.getByRole('tab', { name: 'Pad shape' }))
    await waitFor(() => expect(new Set(revoked)).toEqual(new Set(live)))
  })

  describe('never returns a revoked URL', () => {
    const A = 'img/media/layer.png'
    const B = 'img/chrome/layer.png'
    /** Every value the hook returned in a committed render, with the revoked set at that moment. */
    let returned: { value: string | null; revokedThen: string[] }[] = []

    function Follow() {
      const [path, setPath] = useState<string | null>(A)
      const url = useAsset(path)
      useEffect(() => {
        returned.push({ value: url, revokedThen: [...revoked] })
      })
      return (
        <>
          <button onClick={() => setPath(A)}>to A</button>
          <button onClick={() => setPath(B)}>to B</button>
          <button onClick={() => setPath(null)}>to none</button>
          <output data-testid="followed">{url ?? 'none'}</output>
        </>
      )
    }

    const nothingRevokedWasReturned = () => {
      for (const r of returned) if (r.value !== null) expect(r.revokedThen).not.toContain(r.value)
    }
    const followed = () => screen.getByTestId('followed').textContent ?? ''
    const liveNow = (url: string) => expect(made.has(url) && !revoked.includes(url)).toBe(true)

    beforeEach(() => {
      returned = []
    })

    it('when the path goes away and comes back', async () => {
      const { user } = await start(folderFromRepo(), <Follow />)
      await waitFor(() => expect(followed()).toMatch(/^blob:/))
      const first = followed()

      await user.click(screen.getByRole('button', { name: 'to none' }))
      expect(followed()).toBe('none')
      expect(revoked).toContain(first)

      await user.click(screen.getByRole('button', { name: 'to A' }))
      // Until the new read lands there is nothing, not the URL that was revoked.
      expect(followed()).not.toBe(first)
      await waitFor(() => expect(followed()).toMatch(/^blob:/))
      expect(followed()).not.toBe(first)
      liveNow(followed())
      nothingRevokedWasReturned()
    })

    it('when it moves to a file that is still loading and back', async () => {
      const folder = folderFromRepo()
      const real = folder.readBytes.bind(folder)
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      folder.readBytes = async (path: string) => {
        if (path === B) await gate
        return real(path)
      }
      const { user } = await start(folder, <Follow />)
      await waitFor(() => expect(followed()).toMatch(/^blob:/))
      const first = followed()

      await user.click(screen.getByRole('button', { name: 'to B' }))
      expect(followed()).toBe('none')
      expect(revoked).toContain(first)
      // B has not resolved when the path returns to A.
      await user.click(screen.getByRole('button', { name: 'to A' }))
      expect(followed()).not.toBe(first)
      await waitFor(() => expect(followed()).toMatch(/^blob:/))
      liveNow(followed())

      release()
      await new Promise((r) => setTimeout(r, 0))
      expect(followed()).toMatch(/^blob:/)
      liveNow(followed())
      nothingRevokedWasReturned()
    })
  })
})
