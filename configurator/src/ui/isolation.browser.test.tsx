import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { carry, cell, checked, cleanUp, dirty, drag, hover, hoverPath, keyboard, LONGEST_COMMAND, padKey, rest, startApp, startOpenScreen, touchDrag, type Point } from '../../test/browser/harness'

// What the harness promises between tests: a test that ends early, here by running past its time limit,
// leaves nothing behind for the next. Its body goes on running once what it awaited ends; it must stop
// there instead of sending its next key into the next test's page, a command it left going must have
// ended before the next test starts, and so must a mouse button it left down be up, and the page's
// timers be on the real clock. Each pair is a test that runs past its limit on purpose (it.fails: running
// past it is the outcome it expects), then the test that runs after it and looks.
//
// No pair can fail on a slow machine for being slow:
// - the body of a test that runs past its limit does nothing before the wait or the command it is to be
//   ended in (the one that needs the pad sets it up in a beforeEach, which has its own time limit, the
//   ordinary one), and its limit is far shorter than that wait, which lasts by the real clock, and than
//   that command, which a slower machine only makes longer;
// - the test after it looks at what the test before left, not at the time: what its clean-up left is
//   noted the moment the clean-up ended, and where the test before would have typed later, the test
//   after waits for that body to end, with no limit but its own.
// Each body notes where it got to, and the test after checks the note: a run past the limit anywhere
// else fails out loud. The clean-up has the ordinary time limit of a hook.

/** The time limit of the tests that run past it. */
const LIMIT = 100
/** How long their wait lasts: past their limit, their clean-up and, on this PC, the next test's typing. */
const LATE = 1000

type Place = 'waitFor' | 'rest' | 'path' | 'the key after the path' | 'carry' | 'clock'
/** The places the tests that run past their limit got to, each noted right before it goes in. */
const reached = new Set<Place>()
/** What stopped each one's body there: the error thrown to it when what it waited for ended after the test. */
const stoppedBy = new Map<Place, string>()
/** The end of each body that types after its wait, however it ended. */
const bodyEnded = new Map<Place, Promise<void>>()
/** Whether the pointer path of the third pair is going. */
let pathGoing = false

/**
 * Whether a click on the page reaches what is clicked. Not while dnd-kit is in a drag, nor for 50 ms
 * after one: it then stops every click on its way down from the document.
 */
function aClickGetsThrough(): boolean {
  const button = document.createElement('button')
  let got = false
  button.addEventListener('click', () => {
    got = true
  })
  document.body.append(button)
  button.click()
  button.remove()
  return got
}

/**
 * Makes every timer the page starts from now on last `times` as long, until the function it returns is
 * called. A timer started after another, for a longer time, still ends after it.
 */
function slowTimers(times: number): () => void {
  const real = window.setTimeout
  const slow = (run: TimerHandler, ms = 0, ...args: unknown[]) => real(run, ms * times, ...args)
  window.setTimeout = slow as typeof window.setTimeout
  return () => {
    window.setTimeout = real
  }
}

/** Set by a test whose clean-up is to run with the page's timers slowed; the clean-up takes it back. */
let slowTheNextCleanUp = false
/** What the last clean-up found when it began, and what it left the moment it ended: what the next test starts with. */
let cleanUpBegan = { pathGoing: false }
let cleanUpEnded: { pathGoing: boolean; clicksGetThrough: boolean } | null = null
afterEach(async () => {
  cleanUpBegan = { pathGoing }
  cleanUpEnded = null
  const timersBack = slowTheNextCleanUp ? slowTimers(20) : () => {}
  slowTheNextCleanUp = false
  try {
    await cleanUp()
    cleanUpEnded = { pathGoing, clicksGetThrough: aClickGetsThrough() }
  } finally {
    timersBack()
  }
})

/** Runs `step`, and notes under `place` the error it throws. */
async function noting(place: Place, step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch (error) {
    stoppedBy.set(place, (error as Error).message)
    throw error
  }
}

/** Notes that the body got to `place`, then waits there, and notes what stopped it if the wait throws. */
function runsPastItsLimitIn(place: Place, wait: () => Promise<unknown>): Promise<void> {
  reached.add(place)
  return noting(place, wait)
}

/** The body of a test that runs past its limit in `wait` and would then type; its end is kept in bodyEnded. */
function typesAfter(place: Place, wait: () => Promise<unknown>): () => Promise<void> {
  return () => {
    const body = runsPastItsLimitIn(place, wait).then(() => keyboard('stray'))
    const ended = () => {}
    bodyEnded.set(place, body.then(ended, ended))
    return body
  }
}

/**
 * The test before ran past its limit in `place`. Types into a field of its own, which holds the focus
 * from its first moment, so that every key sent to the page is typed into it; waits until the body of
 * the test before has ended, and finds only its own typing, and that body stopped by its wait.
 */
async function onlyItsOwnTyping(place: Place): Promise<void> {
  expect(reached.has(place)).toBe(true)
  // An app, so that input is open.
  startOpenScreen()
  const field = document.createElement('textarea')
  document.body.append(field)
  field.focus()
  try {
    await keyboard('Mine')
    await checked(bodyEnded.get(place)!)
    expect(field.value).toBe('Mine')
  } finally {
    field.remove()
  }
  expect(stoppedBy.get(place)).toBe('this test ended while it waited')
}

/** `n` points back and forth across the top of the page. */
const across = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: 40 + (i % 2) * 40, y: 40 }))

describe('a test that runs past its limit while it waits in waitFor', () => {
  it.fails(
    'stops at the end of the wait, before its next key',
    typesAfter('waitFor', () => {
      const until = performance.now() + LATE
      return waitFor(() => expect(performance.now()).toBeGreaterThan(until), { timeout: 2 * LATE })
    }),
    LIMIT,
  )

  it('leaves the next test only its own typing', () => onlyItsOwnTyping('waitFor'))
})

describe('a test that runs past its limit while it rests', () => {
  it.fails(
    'stops at the end of the rest, before its next key',
    typesAfter('rest', () => rest(LATE)),
    LIMIT,
  )

  it('leaves the next test only its own typing', () => onlyItsOwnTyping('rest'))
})

describe('a test that runs past its limit with a pointer path still going', () => {
  describe('the test that runs past its limit', () => {
    // An app, so that input is open. The path is the longest a command may be: a move takes a frame of the
    // page, so it lasts several times LIMIT on the fastest machine, and longer on a slower one.
    beforeEach(startOpenScreen)

    it.fails(
      'is ended by Vitest while the path goes on',
      async () => {
        pathGoing = true
        try {
          await runsPastItsLimitIn('path', () => hoverPath(across(LONGEST_COMMAND)))
        } finally {
          pathGoing = false
          // As a body does that goes on after what stopped it, in a finally or a catch: its key is refused.
          await noting('the key after the path', () => keyboard('stray'))
        }
      },
      LIMIT,
    )
  })

  it('starts when the path has ended: the clean-up waited for it, the body was stopped there, and its next key was refused', () => {
    expect(reached.has('path')).toBe(true)
    expect(cleanUpBegan.pathGoing).toBe(true)
    expect(cleanUpEnded?.pathGoing).toBe(false)
    expect(stoppedBy.get('path')).toBe('this test ended while it waited')
    expect(stoppedBy.get('the key after the path')).toBe('input sent after its test had ended')
  })
})

describe('a test that runs past its limit with the mouse button held down by a carry', () => {
  describe('the test that runs past its limit', () => {
    beforeEach(async () => {
      await startApp()
      await carry(padKey('F24'), cell(5, 1))
      // dnd-kit stops clicks for 50 ms after the button is let go, and the clean-up waits for a longer
      // timer of its own. On a slow machine those 50 ms can be over before the release has even come back,
      // and a clean-up that did not wait would leave the same; with every timer 20 times as long, what
      // this clean-up leaves shows whether it waited, on a machine of any speed.
      slowTheNextCleanUp = true
    })

    it.fails('is ended by Vitest before its drop', () => runsPastItsLimitIn('carry', () => rest(LATE)), LIMIT)
  })

  it('opens its app and moves over a key with no button down, and nothing is dragged', async () => {
    expect(reached.has('carry')).toBe(true)
    // The app of the test before went in the middle of a drag. When its clean-up ended, the button was up
    // and dnd-kit had stopped stopping clicks.
    expect(cleanUpEnded?.clicksGetThrough).toBe(true)
    // What the browser says of the buttons at every move of this test, its start's click included.
    const buttons: number[] = []
    const note = (e: PointerEvent) => buttons.push(e.buttons)
    document.addEventListener('pointermove', note, true)
    try {
      await startApp()
      await hover(padKey('F13'))
      await hover(padKey('F14'))
    } finally {
      document.removeEventListener('pointermove', note, true)
    }
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.filter((b) => b !== 0)).toEqual([])
    expect(dirty()).toBe(false)
  })
})

describe("a test that runs past its limit with the page's timers on a clock the test turns", () => {
  it.fails(
    'is ended by Vitest with that clock still on',
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      // On that clock, which nothing turns, this rest never ends.
      await runsPastItsLimitIn('clock', () => rest(LATE))
    },
    LIMIT,
  )

  it('leaves the next test the real clock: a timer of the page fires', async () => {
    expect(reached.has('clock')).toBe(true)
    expect(vi.isFakeTimers()).toBe(false)
    await rest(1)
  })
})

// What keeps a clean-up inside its hook's time limit, so that it has ended before the next test starts:
// the harness sends no command of more than LONGEST_COMMAND moves or presses (harness.tsx derives the number).
describe('a command of more moves or presses than one command may make', () => {
  beforeEach(startOpenScreen)

  const from = { x: 40, y: 40 }
  const to = { x: 80, y: 40 }
  it.each<[string, () => Promise<void>]>([
    [`a pointer path through ${LONGEST_COMMAND + 1} points`, () => hoverPath(across(LONGEST_COMMAND + 1))],
    [`a drag in ${LONGEST_COMMAND} steps, after the move to where it starts`, () => drag(from, to, LONGEST_COMMAND)],
    [`a drag with a finger in ${LONGEST_COMMAND} steps, after the touch where it starts`, () => touchDrag(from, to, LONGEST_COMMAND)],
    [`a key pressed ${LONGEST_COMMAND + 1} times`, () => keyboard(`{a>${LONGEST_COMMAND + 1}/}`)],
  ])('%s is refused, and the error says why', async (_name, send) => {
    await expect(send()).rejects.toThrow(`one command may make ${LONGEST_COMMAND} at most, so that the clean-up after a test`)
  })
})
