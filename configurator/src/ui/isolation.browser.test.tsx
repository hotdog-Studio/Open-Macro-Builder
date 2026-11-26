import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanUp, click, hoverPath, keyboard, rest, startApp, startOpenScreen, type Point } from '../../test/browser/harness'
import { editorView } from '../../test/codeEditor'

// What the harness promises between tests: a test that ends early, here by running past its time limit,
// leaves nothing behind for the next. Its body goes on running once what it awaited ends; it must stop at
// that wait instead of sending its next key into the next test's editor, and its clean-up must not take
// the next test's app away. Each pair is a test that runs past its limit on purpose (it.fails: running
// past it is the outcome it expects), then the test that runs after it and looks.
//
// The app is opened in a beforeEach, which has its own time limit, so that the first test's body does
// nothing but go into the wait it is to run past its limit in, on a machine of any speed. It notes that it
// got there, and the test after it checks the note: a run past the limit anywhere else fails out loud.

/** How long the clean-up may wait for input still in flight before Vitest goes on to the next test. */
const HOOK_LIMIT = 500
afterEach(cleanUp, HOOK_LIMIT)

/** The time limit of the tests that run past it. */
const LIMIT = 500
/** How long their wait lasts: past their limit, their clean-up and the next test's start. */
const LATE = 2000
/** How long the pointer path of the third pair lasts: past its test's limit and its clean-up's. */
const PATH_TIME = 2500

type Place = 'waitFor' | 'rest' | 'path'
/** The places the tests that run past their limit got to, each noted right before it goes in. */
const reached = new Set<Place>()
/** What stopped each one's body: the error its wait threw when it ended after the test. */
const stoppedBy = new Map<Place, string>()
/** Whether the pointer path of the third pair has ended. */
let pathEnded = false

const editorEl = () => document.querySelector<HTMLElement>('.cm-content')!
const text = () => editorView().state.doc.toString()
/** The text of the file shown, as it was opened. */
let opened = ''

/** The Commands tab, with the caret at the end of the first file. */
async function editorAtEnd(): Promise<void> {
  await startApp('Commands')
  opened = text()
  await click(editorEl())
  await keyboard('{Control>}{End}{/Control}')
}

/** Notes that the body got to `place`, then waits there, and notes what stopped it if the wait throws. */
async function runsPastItsLimitIn(place: Place, wait: () => Promise<unknown>): Promise<void> {
  reached.add(place)
  try {
    await wait()
  } catch (error) {
    stoppedBy.set(place, (error as Error).message)
    throw error
  }
}

/**
 * The test before ran past its limit in `place`. Types at the end of the file, rests past the moment that
 * wait ended, and finds only its own typing, in its own app, and the body before stopped by its wait.
 */
async function onlyItsOwnTyping(place: Place): Promise<void> {
  expect(reached.has(place)).toBe(true)
  const root = document.getElementById('root')
  await keyboard('Mine')
  await rest(LATE)
  expect(text()).toBe(opened + 'Mine')
  expect(document.getElementById('root')).toBe(root)
  expect(stoppedBy.get(place)).toBe('this test ended while it waited')
}

/**
 * Points back and forth across the editor, as many as this machine moves the pointer through in about
 * `ms`: the time of a move is that of a short path less that of a shorter one.
 */
async function pathLasting(ms: number): Promise<Point[]> {
  const box = editorEl().getBoundingClientRect()
  const across = (n: number) => Array.from({ length: n }, (_, i) => ({ x: box.left + 20 + (i % 2) * 40, y: box.top + 20 }))
  const timed = async (n: number) => {
    const start = performance.now()
    await hoverPath(across(n))
    return performance.now() - start
  }
  const short = await timed(10)
  const move = Math.max((await timed(60)) - short, 1) / 50
  return across(Math.ceil(ms / move))
}

describe('a test that runs past its limit while it waits in waitFor', () => {
  beforeEach(editorAtEnd)

  it.fails(
    'stops at the end of the wait, before its next key',
    async () => {
      await runsPastItsLimitIn('waitFor', () => {
        const until = performance.now() + LATE
        return waitFor(() => expect(performance.now()).toBeGreaterThan(until), { timeout: 2 * LATE })
      })
      await keyboard('stray')
    },
    LIMIT,
  )

  it('leaves the next test only its own typing, and its app', () => onlyItsOwnTyping('waitFor'))
})

describe('a test that runs past its limit while it rests', () => {
  beforeEach(editorAtEnd)

  it.fails(
    'stops at the end of the rest, before its next key',
    async () => {
      await runsPastItsLimitIn('rest', () => rest(LATE))
      await keyboard('stray')
    },
    LIMIT,
  )

  it('leaves the next test only its own typing, and its app', () => onlyItsOwnTyping('rest'))
})

describe('a test that runs past its limit with a pointer path still going after its clean-up gave up', () => {
  describe('the test that runs past its limit', () => {
    let points: Point[] = []
    beforeEach(async () => {
      await editorAtEnd()
      points = await pathLasting(PATH_TIME)
    })

    it.fails(
      'is ended by Vitest while the path goes on',
      async () => {
        await runsPastItsLimitIn('path', () => {
          const going = hoverPath(points)
          const ended = () => {
            pathEnded = true
          }
          void going.then(ended, ended)
          return going
        })
      },
      LIMIT,
    )
  })

  // No beforeEach and no startApp, which would wait for the path to end: the app is mounted while the
  // path still goes on, before the clean-up of the test before has ended.
  it('keeps its app when that clean-up ends after it has started', async () => {
    startOpenScreen()
    expect(reached.has('path')).toBe(true)
    expect(pathEnded).toBe(false)
    const root = document.getElementById('root')
    // A click waits for every earlier command to end, so the clean-up before has ended by then.
    await click(screen.getByRole('button', { name: 'Open folder' }))
    expect(pathEnded).toBe(true)
    expect(document.getElementById('root')).toBe(root)
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
  })
})
