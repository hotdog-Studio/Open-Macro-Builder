import { defineConfig } from 'vitest/config'

// Launches the built desktop app with Playwright. Run by hand or by the Jenkins stage 'Windows
// Configurator Tests' (the desktop agent, every branch; it downloads the Electron binary with
// `npx --no install-electron` right after npm ci, and sets OMB_REQUIRE_ELECTRON=1, so a missing
// Electron binary or display fails the run instead of skipping it). Run by hand, the first run
// downloads the binary itself (requiring the electron module does), as npm ci does not:
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
