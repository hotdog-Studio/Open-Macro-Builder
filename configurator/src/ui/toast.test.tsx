/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider, useApp, type Banner } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'
import { toastLifetime } from './Toast'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useLayoutEffect(() => {
    seen = app
  })
  return null
}

const enc = new TextEncoder()

/**
 * The example pad open on the Pad shape tab, with real timers; the test turns fake ones on when time
 * matters. From then on it acts with fireEvent: Testing Library's own waiting after a user-event
 * action never ends under Vitest's fake timers.
 */
async function openPad(options: { failWrites?: boolean } = {}) {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  await folder.writeBytes('local/config.json', enc.encode(readRepoText('config.json')))
  await folder.writeBytes(SETTINGS_PATH, enc.encode('{ "languages": ["ahk"] }\n'))
  if (options.failWrites) {
    folder.writeBytes = async () => {
      throw new Error('Access is denied.')
    }
  }
  const platform: Platform = { kind: 'browser', openFolder: async () => folder, createFolder: async () => null, restoreFolder: async () => null }
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

const show = (banner: Banner | null) => act(() => seen.dispatch({ type: 'banner', banner }))
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const noticeShowing = () => screen.queryByText('Select a key first.')

/** F13 moved right onto F14's square, from the keyboard. */
const moveOntoTakenSquare = () => {
  const f13 = screen.getByRole('button', { name: /^F13 \d×\d$/ })
  fireEvent.keyDown(f13, { key: 'ArrowRight', altKey: true })
}

describe('toastLifetime', () => {
  it('an error stays until it is dismissed', () => {
    expect(toastLifetime({ text: 'It broke.', kind: 'error' })).toBeNull()
  })

  it('a short warning leaves after four seconds and a bit', () => {
    expect(toastLifetime({ text: 'That space is taken.', kind: 'warning' })).toBe(4800)
  })

  it('a long notice leaves after fifteen seconds at most', () => {
    expect(toastLifetime({ text: 'x'.repeat(400), kind: 'info' })).toBe(15000)
  })
})

describe('messages as toasts', () => {
  it('a refused action shows an amber message that leaves by itself', async () => {
    await openPad()
    vi.useFakeTimers()
    moveOntoTakenSquare()
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('That space is taken.')).toBeTruthy()
    expect(alert.className).toContain('border-amber-500')
    expect(alert.className).toContain('text-amber-200')
    expect(alert.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    wait(4799)
    expect(screen.queryByRole('alert')).toBeTruthy()
    wait(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed save shows a red message that stays until dismissed', async () => {
    const { user } = await openPad({ failWrites: true })
    fireEvent.keyDown(screen.getByRole('button', { name: /^F24 \d×\d$/ }), { key: 'ArrowDown', altKey: true })
    await user.click(screen.getByRole('button', { name: 'Save config.json' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Access is denied.')
    expect(alert.className).toContain('border-red-500')
    expect(alert.className).toContain('text-red-200')
    vi.useFakeTimers()
    wait(10 * 60 * 1000)
    expect(screen.queryByRole('alert')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a notice is sky blue, announced politely, and leaves by itself', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'Select a key first.', kind: 'info' })
    // Other parts of the editor are status regions too, so the notice is found by its text.
    const notice = screen.getByText('Select a key first.').parentElement!
    expect(notice.tagName).toBe('OUTPUT')
    expect(notice.className).toContain('border-sky-500')
    expect(notice.className).toContain('text-sky-200')
    expect(screen.queryByRole('alert')).toBeNull()
    wait(toastLifetime({ text: 'Select a key first.', kind: 'info' })!)
    expect(noticeShowing()).toBeNull()
  })

  it('the message stays while the pointer rests on it, and while the focus is in it', async () => {
    await openPad()
    vi.useFakeTimers()
    const banner: Banner = { text: 'That space is taken.', kind: 'warning' }
    show(banner)
    const alert = screen.getByRole('alert')

    // The pointer rests on it for far longer than its time.
    fireEvent.pointerEnter(alert)
    wait(20000)
    expect(screen.queryByRole('alert')).toBeTruthy()
    // It leaves, and the whole time starts again.
    fireEvent.pointerLeave(alert)
    wait(4799)
    expect(screen.queryByRole('alert')).toBeTruthy()
    wait(1)
    expect(screen.queryByRole('alert')).toBeNull()

    // The same for the focus.
    show(banner)
    const again = screen.getByRole('alert')
    const dismiss = within(again).getByRole('button', { name: 'Dismiss' })
    act(() => dismiss.focus())
    wait(20000)
    expect(screen.queryByRole('alert')).toBeTruthy()
    act(() => dismiss.blur())
    wait(4799)
    expect(screen.queryByRole('alert')).toBeTruthy()
    wait(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a message of another kind that replaces one under the resting pointer stays until the pointer leaves', async () => {
    // A guard, not RED evidence: it already passed before the handlers moved to the frame, and it catches a hold that is lost with the replaced element.
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    fireEvent.pointerEnter(screen.getByRole('alert'))
    wait(1000)

    // The notice is another kind of element, drawn where the pointer already is.
    const notice: Banner = { text: 'Select a key first.', kind: 'info' }
    show(notice)
    expect(screen.queryByRole('alert')).toBeNull()
    wait(60000)
    expect(screen.queryByText('Select a key first.')).toBeTruthy()

    // Once the pointer leaves, the notice has its whole time.
    fireEvent.pointerLeave(screen.getByText('Select a key first.').parentElement!)
    wait(toastLifetime(notice)! - 1)
    expect(screen.queryByText('Select a key first.')).toBeTruthy()
    wait(1)
    expect(screen.queryByText('Select a key first.')).toBeNull()
  })

  it('a message of the same kind that replaces one with the focus in it keeps the hold', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus())
    show({ text: 'Keys start at row 1 and column 1.', kind: 'warning' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }))
    wait(60000)
    expect(screen.queryByText('Keys start at row 1 and column 1.')).toBeTruthy()
    act(() => screen.getByRole('button', { name: 'Dismiss' }).blur())
    wait(toastLifetime({ text: 'Keys start at row 1 and column 1.', kind: 'warning' })!)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a message of another kind that replaces one with the focus in it counts down, as the focus is gone', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus())
    const notice: Banner = { text: 'Select a key first.', kind: 'info' }
    // The button that had the focus is replaced, so the focus falls back to the page.
    show(notice)
    expect(document.activeElement).toBe(document.body)
    wait(toastLifetime(notice)!)
    expect(screen.queryByText('Select a key first.')).toBeNull()
  })

  it('the focus that comes back to a replacement holds it, and its leaving starts the whole time again', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus())
    const notice: Banner = { text: 'Select a key first.', kind: 'info' }
    show(notice)
    expect(document.activeElement).toBe(document.body)
    // The user tabs onto the new message's own button.
    wait(1000)
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    act(() => dismiss.focus())
    wait(toastLifetime(notice)! * 4)
    expect(screen.queryByText('Select a key first.')).toBeTruthy()
    act(() => dismiss.blur())
    wait(toastLifetime(notice)! - 1)
    expect(screen.queryByText('Select a key first.')).toBeTruthy()
    wait(1)
    expect(screen.queryByText('Select a key first.')).toBeNull()
  })

  it('a new message replaces the old one and gets its own time', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    wait(4000)
    show({ text: 'Keys start at row 1 and column 1.', kind: 'warning' })
    expect(screen.queryByText('That space is taken.')).toBeNull()
    // The first message's time is up here, and it must not close the second.
    wait(800)
    expect(screen.queryByText('Keys start at row 1 and column 1.')).toBeTruthy()
    wait(toastLifetime({ text: 'Keys start at row 1 and column 1.', kind: 'warning' })! - 800)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a message that was dismissed does not close the next one', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    wait(3000)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    show({ text: 'Keys start at row 1 and column 1.', kind: 'warning' })
    wait(2000)
    expect(screen.queryByText('Keys start at row 1 and column 1.')).toBeTruthy()
  })

  it('Dismiss closes it at once', async () => {
    await openPad()
    vi.useFakeTimers()
    show({ text: 'That space is taken.', kind: 'warning' })
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('floats over the editor without taking part in its layout', async () => {
    await openPad()
    show({ text: 'That space is taken.', kind: 'warning' })
    const toast = screen.getByRole('alert').parentElement!
    const holder = toast.parentElement!
    expect(holder.className).toContain('absolute')
    expect(holder.className).toContain('pointer-events-none')
    expect(toast.className).toContain('pointer-events-auto')
    expect(screen.getByRole('alert').className).toContain('rounded-[1.25rem]')
  })
})
