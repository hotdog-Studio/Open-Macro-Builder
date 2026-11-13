/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../core/config/model'
import { overlayCells, overlaySize } from '../core/overlay'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider, useApp } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

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

async function start(config?: (c: { layers: unknown[] }) => void) {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  const enc = new TextEncoder()
  const parsed = JSON.parse(readRepoText('config.json'))
  config?.(parsed)
  await folder.writeBytes('local/config.json', enc.encode(JSON.stringify(parsed, null, 2) + '\n'))
  await folder.writeBytes(SETTINGS_PATH, enc.encode('{ "languages": ["ahk"] }\n'))
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null }
  render(
    <AppProvider platform={platform}>
      <App />
      <Probe />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  return { user }
}

const preview = () => screen.getByRole('region', { name: 'Overlay preview' })
const images = () => Array.from(preview().querySelectorAll<HTMLImageElement>('img[data-path]'))

describe('Overlay preview', () => {
  it('draws one image per cell at the overlay positions', async () => {
    await start()
    // The example starts on the first layer, which sits on k1.
    const cells = overlayCells(ws(), 'k1')
    expect(cells).toHaveLength(13) // 12 keys and Fn
    expect(images()).toHaveLength(cells.length)
    cells.forEach((cell, i) => {
      const img = images()[i]
      expect(img.getAttribute('data-path')).toBe(cell.image)
      expect(img.style.left).toBe(`${cell.key.x}px`)
      expect(img.style.top).toBe(`${cell.key.y}px`)
      expect(img.style.width).toBe(`${cell.key.w}px`)
      expect(img.style.height).toBe(`${cell.key.h}px`)
    })
    // The picture itself is the folder's file, as an object URL.
    await waitFor(() => expect(images()[0].getAttribute('src')).toMatch(/^blob:/))
    // The overlay window is as large as the cells need.
    const { w, h } = overlaySize(ws())
    const canvas = images()[0].parentElement as HTMLElement
    expect(canvas.style.width).toBe(`${w}px`)
    expect(canvas.style.height).toBe(`${h}px`)
  })

  it("shows the selected layer's macro names in the label strips", async () => {
    await start()
    const p = within(preview())
    expect(p.getByText('Prev')).toBeTruthy()
    expect(p.getByText('Play')).toBeTruthy()
    expect(p.getByText('Vol +')).toBeTruthy()
    expect(p.queryByText('YouTube')).toBeNull()
    const strip = p.getByText('Prev')
    expect(strip.style.fontFamily).toMatch(/Consolas/)
    expect(strip.style.fontWeight).toBe('bold')
    expect(strip.style.fontStyle).toBe('italic')
    expect(strip.style.color).toBe('rgb(254, 254, 254)')
    expect(strip.style.backgroundColor).toBe('rgb(16, 16, 16)')
  })

  it('follows the layer chosen on the Macros tab', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('tab', { name: 'Macros' }))
    await user.click(screen.getByRole('button', { name: 'Chrome' }))
    const p = within(preview())
    expect(p.getByText('YouTube')).toBeTruthy()
    expect(p.queryByText('Prev')).toBeNull()
    const cells = overlayCells(ws(), 'k3')
    expect(images().map((i) => i.getAttribute('data-path'))).toEqual(cells.map((c) => c.image))
  })

  it("follows the Layers tab's selected key, and falls back to the start layer", async () => {
    const { user } = await start()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    expect(within(preview()).getByText('Prev')).toBeTruthy() // nothing selected: the start layer
    await user.click(screen.getByRole('button', { name: /^Programs/ }))
    expect(within(preview()).getByText('Explorer')).toBeTruthy()
    expect(within(preview()).queryByText('Prev')).toBeNull()
    // A key without a layer does not blank the preview: it falls back to the start layer.
    await user.click(screen.getByRole('button', { name: /^F24/ }))
    expect(within(preview()).getByText('Prev')).toBeTruthy()
  })

  it('is on every tab, and hides and shows', async () => {
    const { user } = await start()
    expect(within(preview()).getByText('Overlay preview · real size')).toBeTruthy()
    for (const tab of ['Layers', 'Macros', 'Pad shape']) {
      await user.click(screen.getByRole('tab', { name: tab }))
      expect(preview()).toBeTruthy()
    }
    await user.click(screen.getByRole('button', { name: 'hide' }))
    expect(images()).toHaveLength(0)
    expect(within(preview()).getByText('Overlay preview · real size')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'show' }))
    expect(images()).toHaveLength(13)
  })

  it('updates as the workspace is edited', async () => {
    const { user } = await start()
    expect(images()).toHaveLength(13)
    await user.click(screen.getByRole('button', { name: /^F24/ }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove key' }))
    await waitFor(() => expect(images()).toHaveLength(12))
  })

  it('says so when no layer is on a key', async () => {
    await start((c) => {
      c.layers = []
    })
    expect(images()).toHaveLength(0)
    expect(within(preview()).getByText('No layer is on a key yet.')).toBeTruthy()
  })
})
