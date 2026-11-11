// Runs before every test file (vite.config.ts, test.setupFiles).
//
// Testing Library's findBy* and waitFor give up after 1 s by default. That is plenty on an idle
// machine, but the UI tests run in parallel under coverage instrumentation, and on a busy CI agent
// the app can take longer than a second to settle. A wait that is about to succeed should not fail
// the build, so give them 5 s. They return as soon as the condition holds, so a passing test does
// not wait longer; only a test that really fails does. Stays well under test.testTimeout.
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/dom')
  configure({ asyncUtilTimeout: 5000 })
}

export {}
