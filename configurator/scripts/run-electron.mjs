// Starts the configurator in Electron. Run after build-electron.mjs.
// VS Code's integrated terminal passes on ELECTRON_RUN_AS_NODE=1, which makes
// electron.exe behave as plain Node; this launcher drops it for the child.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** A copy of `env` without ELECTRON_RUN_AS_NODE. */
export function electronEnv(env) {
  const copy = { ...env }
  delete copy.ELECTRON_RUN_AS_NODE
  return copy
}

function run() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  // Under Node, the electron package exports the path of its binary.
  const binary = createRequire(import.meta.url)('electron')
  const child = spawn(binary, ['.'], { cwd: root, env: electronEnv(process.env), stdio: 'inherit' })
  let exited = false

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!exited) child.kill(signal)
    })
  }

  child.on('error', (error) => {
    console.error(`Could not start Electron: ${error.message}`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    exited = true
    process.exit(code ?? (signal ? 1 : 0))
  })
}

// Only start Electron when run as a script, not when a test imports electronEnv.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run()
