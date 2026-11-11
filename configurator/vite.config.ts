/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Electron loads dist/index.html from disk, so assets need relative URLs.
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // core imports ../scripts/validate-config-core.mjs, outside this folder.
    fs: { allow: ['..'] },
  },
  test: {
    setupFiles: ['./test/setup.ts'],
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
