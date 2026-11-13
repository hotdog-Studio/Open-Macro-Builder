import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  // Electron loads dist/index.html from disk, so assets need relative URLs.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // Served from the user's own PC (localhost or Electron's file load): one large chunk costs no network time.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // core imports ../scripts/validate-config-core.mjs, outside this folder.
    fs: { allow: ['..'] },
  },
  test: {
    setupFiles: ['./test/setup.ts'],
    // The *.browser.test.tsx files need a real browser: vitest.browser.config.ts runs those.
    // And e2e/ launches the desktop app: vitest.electron.config.ts runs that.
    exclude: [...configDefaults.exclude, '**/*.browser.test.*', '**/*.e2e.test.*'],
    // The UI tests render the whole app and press real keys through user-event. The slowest
    // (save.test.tsx's first test: two edit-and-save rounds) takes about 3.6 s on an idle machine
    // with coverage on, so the 5 s default left no margin on a loaded CI agent.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**', 'electron/**'],
      // projectRoot makes the SF: lines repo-root-relative (configurator/src/...), which is how
      // SonarQube, whose project root is the repo root, finds the files.
      reporter: ['text', ['lcov', { projectRoot: '..' }]],
      reportsDirectory: '../coverage/configurator',
    },
  },
})
