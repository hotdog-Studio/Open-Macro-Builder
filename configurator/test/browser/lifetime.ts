// Which test is running, as the browser tests' harness counts them, so that a test that has ended can
// tell. Vitest ends a test that runs past its time limit, but its body goes on running once what it
// awaited ends; each wait of the harness (testing-library's waitFor and findBy* through
// test/browser/setup.ts, rest() below, and the harness's input and other calls that wait on the browser
// or on Node) then stops that body before it acts on the next test's page.

let generation = 0

/** The number of the test now running; it changes when a test ends. */
export const currentTest = (): number => generation

/** Marks the end of a test: from now on every wait that began in it throws when it ends. */
export function endTest(): void {
  generation++
}

/** Throws when the test that was running at `since` has ended meanwhile. */
export function stillRunning(since: number): void {
  if (since !== generation) throw new Error('this test ended while it waited')
}

/** Waits for `wait`, kept or broken; a test that ended meanwhile stops here. */
export async function checked<T>(wait: PromiseLike<T>): Promise<T> {
  const since = generation
  let result: T
  try {
    result = await wait
  } catch (error) {
    stillRunning(since)
    throw error
  }
  stillRunning(since)
  return result
}

/** Waits `ms` by the real clock; a test that ended meanwhile stops here. */
export const rest = (ms: number): Promise<void> => checked(new Promise<void>((done) => setTimeout(done, ms)))
