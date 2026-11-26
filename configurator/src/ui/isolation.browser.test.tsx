import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanUp, click, hoverPath, keyboard, rest, startApp, startOpenScreen } from '../../test/browser/harness'
import { editorView } from '../../test/codeEditor'

// What the harness promises between tests: a test that ends early, here by running past its time limit,
// leaves nothing behind for the next. Its body goes on running once what it awaited ends; it must stop at
// that wait instead of sending its next key into the next test's editor, and its clean-up must not take
// the next test's app away. Each pair is a test that runs past its limit on purpose (it.fails: running
// past it is the outcome it expects), then the test that runs after it and looks.

/** How long the clean-up may wait for input still in flight before Vitest goes on to the next test. */
const HOOK_LIMIT = 500
afterEach(cleanUp, HOOK_LIMIT)

/** The time limit of the tests that run past it. */
const LIMIT = 1000
/** How long their body waits before it would type: past their limit, their clean-up and the next test's start. */
const LATE = 3000

const text = () => editorView().state.doc.toString()

/** The Commands tab, with the caret at the end of the first file. */
async function editorAtEnd(): Promise<void> {
  await startApp('Commands')
  await click(document.querySelector<HTMLElement>('.cm-content')!)
  await keyboard('{Control>}{End}{/Control}')
}

/** Types at the end of the file, rests past the moment the body before would have typed, and finds only its own typing, in its own app. */
async function onlyItsOwnTyping(): Promise<void> {
  await editorAtEnd()
  const root = document.getElementById('root')
  const before = text()
  await keyboard('Mine')
  await rest(LATE)
  expect(text()).toBe(before + 'Mine')
  expect(document.getElementById('root')).toBe(root)
}

describe('a test that runs past its limit while it waits in waitFor', () => {
  it.fails(
    'stops at the end of the wait, before its next key',
    async () => {
      await editorAtEnd()
      const until = performance.now() + LATE
      await waitFor(() => expect(performance.now()).toBeGreaterThan(until), { timeout: 2 * LATE })
      await keyboard('stray')
    },
    LIMIT,
  )

  it('leaves the next test only its own typing, and its app', onlyItsOwnTyping)
})

describe('a test that runs past its limit while it rests', () => {
  it.fails(
    'stops at the end of the rest, before its next key',
    async () => {
      await editorAtEnd()
      await rest(LATE)
      await keyboard('stray')
    },
    LIMIT,
  )

  it('leaves the next test only its own typing, and its app', onlyItsOwnTyping)
})

describe('a test that runs past its limit with a pointer path still going after its clean-up gave up', () => {
  it.fails(
    'is ended by Vitest while the path goes on',
    async () => {
      await editorAtEnd()
      const box = document.querySelector('.cm-content')!.getBoundingClientRect()
      // Back and forth across the editor, long enough to outlast the test and its clean-up's limit.
      const points = Array.from({ length: 400 }, (_, i) => ({ x: box.left + 20 + (i % 2) * 40, y: box.top + 20 }))
      await hoverPath(points)
    },
    LIMIT,
  )

  it('keeps its app when that clean-up ends after it has started', async () => {
    startOpenScreen()
    const root = document.getElementById('root')
    // A click waits for every earlier command to end, so the clean-up before has ended by then.
    await click(screen.getByRole('button', { name: 'Open folder' }))
    expect(document.getElementById('root')).toBe(root)
  })
})
