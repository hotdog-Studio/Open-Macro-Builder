// Runs in the browser before every browser test file (vitest.browser.config.ts, test.setupFiles).
// The real stylesheet: without it nothing has the size or place the drags aim at.
import '../../src/index.css'
import { configure } from '@testing-library/dom'

// Same margin as test/setup.ts gives the jsdom tests.
configure({ asyncUtilTimeout: 5000 })
