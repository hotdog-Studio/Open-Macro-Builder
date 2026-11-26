import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { starterPlugin } from './scripts/starter.mjs'

export default defineConfig({
  // Electron loads dist/index.html from disk, so assets need relative URLs.
  base: './',
  // starterPlugin carries the repository's scripts and icons in the page (virtual:omb-starter).
  plugins: [react(), tailwindcss(), starterPlugin(resolve(import.meta.dirname, '..'))],
  build: {
    // Served from the user's own PC (localhost or Electron's file load): one large chunk costs no network time.
    // The starter copy (loadStarter's chunk, about 1.2 MB of scripts and icons) is fetched only when a
    // fresh folder is set up, so it sits above the old 1000 kB limit without slowing the page.
    chunkSizeWarningLimit: 2000,
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
      // scripts/ holds the build scripts, starter.mjs among them (it decides which files go into every
      // folder the app sets up). build-electron.mjs (one call to esbuild) and make-icon.mjs (drives headless
      // Chromium, and holds about 60 lines of .ico file-format code that no test reaches) have no test and
      // show as uncovered here; sonar.coverage.exclusions leaves them out of SonarQube's figure.
      include: ['src/**', 'electron/**', 'scripts/**'],
      // A declaration file beside plain JavaScript (src/core/update/canonical.d.mts) holds no code, and the
      // provider would try to parse it as JavaScript. Test files are not code under test.
      exclude: ['**/*.d.mts', '**/*.test.*'],
      // projectRoot makes the SF: lines repo-root-relative (configurator/src/...), which is how
      // SonarQube, whose project root is the repo root, finds the files.
      reporter: ['text', ['lcov', { projectRoot: '..' }]],
      reportsDirectory: '../coverage/configurator',
    },
  },
})
