// Bundles the Electron main process and preload into dist-electron/.
// Run after `vite build`, which fills dist/ with the page Electron loads.
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: {
    main: join(root, 'electron', 'main.ts'),
    preload: join(root, 'electron', 'preload.ts'),
  },
  outdir: join(root, 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
})
