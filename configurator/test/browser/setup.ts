// Runs in the browser before every browser test file (vitest.browser.config.ts, test.setupFiles).
// The real stylesheet: without it nothing has the size or place the drags aim at.
import '../../src/index.css'
// First, so that React's own asyncWrapper is in place before it is wrapped below.
import '@testing-library/react'
import { configure, getConfig } from '@testing-library/dom'
import { checked } from './lifetime'

// Same margin as test/setup.ts gives the jsdom tests.
configure({ asyncUtilTimeout: 5000 })

// Every waitFor and findBy* goes through asyncWrapper, whether it ends by its condition or by its
// time limit: a test that ended while it waited stops here (lifetime.ts says why).
const reactWrapper = getConfig().asyncWrapper
configure({ asyncWrapper: (cb) => checked(reactWrapper(cb)) })
