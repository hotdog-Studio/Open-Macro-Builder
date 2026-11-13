/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vite'
import { pointerPath, touchPath, validateSavedConfig } from './test/browser/commands.ts'

// The browser tests (src/**/*.browser.test.tsx): the app in headless Chromium, so elements have
// real sizes and a drag is a real mouse press, move and release. jsdom lays nothing out, which is
// why the tests under vite.config.ts cannot drag. Run with `npm run test:browser`; needs
// `npx playwright install chromium` once.
//
// Not merged with vite.config.ts: mergeConfig joins the two `exclude` lists, and that one
// excludes these files.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // Every package the app and the tests import, bundled before the first test. Left to find them
  // one test file at a time, Vite re-bundles and reloads the page mid-run (always, on a fresh CI
  // checkout), and a reloaded test can end up with two copies of React.
  optimizeDeps: {
    include: [
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom',
      'react-dom/client',
      '@dnd-kit/core',
      'idb-keyval',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/legacy-modes/mode/powershell',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/theme-one-dark',
      '@codemirror/view',
      '@testing-library/dom',
      '@testing-library/react',
    ],
  },
  server: {
    // The tests read the example config, commands and icons from the repository root.
    fs: { allow: ['..'] },
  },
  test: {
    include: ['src/**/*.browser.test.{ts,tsx}'],
    setupFiles: ['./test/browser/setup.ts'],
    testTimeout: 30000,
    // With --coverage: its own lcov file, which SonarQube adds to the unit tests' one (both are
    // listed in sonar-project.properties). This is where PadGrid.tsx, the drag code, gets counted.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['**/*.test.*', '**/*.css'],
      reporter: ['text-summary', ['lcov', { projectRoot: '..' }]],
      reportsDirectory: '../coverage/configurator-browser',
    },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      // Wide and tall enough that the whole pad is on screen on every tab.
      viewport: { width: 1280, height: 900 },
      screenshotFailures: false,
      commands: { pointerPath, touchPath, validateSavedConfig },
    },
  },
})
