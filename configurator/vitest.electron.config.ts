import { defineConfig } from 'vitest/config'

// Launches the built desktop app with Playwright. Run by hand or by its own CI stage:
//   npx vitest run --config vitest.electron.config.ts
// `npm test` (vite.config.ts) must not pick these up: its exclude list needs '**/*.e2e.test.*'.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    // A cold build plus an Electron start and a few UI steps.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    // One app at a time: the tests share the build and the machine's display.
    fileParallelism: false,
  },
})
