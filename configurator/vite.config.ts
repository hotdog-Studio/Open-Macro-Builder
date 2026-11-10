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
    coverage: {
      provider: 'v8',
      include: ['src/**', 'electron/**'],
      reporter: ['text', 'lcov'],
      reportsDirectory: '../coverage/configurator',
    },
  },
})
