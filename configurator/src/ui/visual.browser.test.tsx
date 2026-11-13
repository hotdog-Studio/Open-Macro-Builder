import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from 'vitest/browser'
import { carry, cell, click, drag, drop, padKey, startApp, unmount } from '../../test/browser/harness'

// Pictures of the pad compared with reference pictures kept beside this file (__screenshots__/):
// a change in how the grid looks fails here even when every behaviour test still passes.
//
// Text is drawn with the fonts of the machine, so a reference made on Windows does not match
// Linux. The references in the repository are Windows ones, and the suite skips itself elsewhere.
// After a deliberate change to the look, remake them with:
//   npx vitest run --config vitest.browser.config.ts src/ui/visual.browser.test.tsx --update
const here = describe.skipIf(server.platform !== 'win32')

afterEach(unmount)

/** The framed grid, once every icon in it has loaded. */
async function pad(): Promise<HTMLElement> {
  const frame = screen.getByRole('list', { name: 'Keys' }).parentElement!.parentElement!
  await waitFor(() => {
    for (const img of frame.querySelectorAll('img')) expect(img.complete && img.naturalWidth > 0).toBe(true)
    // An icon still loading is a labelled placeholder with nothing in it.
    expect(frame.querySelector('span[role="img"]:empty')).toBeNull()
  })
  return frame
}

// A few pixels of anti-aliasing may differ from run to run; a moved or recoloured key is thousands.
const loose = { comparatorOptions: { allowedMismatchedPixelRatio: 0.01 } }

here('how the pad looks', () => {
  it('Pad shape tab', async () => {
    await startApp()
    await expect(await pad()).toMatchScreenshot('shape', loose)
  })

  it('Pad shape tab with a key selected and the label strips off', async () => {
    await startApp()
    await click(screen.getByRole('checkbox', { name: 'Show labels above keys' }))
    await click(padKey('F22'))
    await expect(await pad()).toMatchScreenshot('shape-no-labels-selected', loose)
  })

  it('Pad shape tab while a key is carried over a free square', async () => {
    await startApp()
    await carry(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(cell(5, 1).className).toContain('border-sky-400'))
    await expect(await pad()).toMatchScreenshot('shape-carrying', loose)
    await drop()
  })

  it('Layers tab', async () => {
    await startApp('Layers')
    await expect(await pad()).toMatchScreenshot('layers', loose)
  })

  it('Layers tab after a layer is parked', async () => {
    await startApp('Layers')
    const chrome = within(screen.getByRole('list', { name: 'Keys' })).getByRole('button', { name: 'Chrome' })
    await drag(chrome, screen.getByRole('group', { name: 'Parked' }))
    await waitFor(() => expect(padKey('F15')).toBeTruthy())
    await expect(await pad()).toMatchScreenshot('layers-parked', loose)
  })

  it('Macros tab', async () => {
    await startApp('Macros')
    await expect(await pad()).toMatchScreenshot('macros', loose)
  })
})
