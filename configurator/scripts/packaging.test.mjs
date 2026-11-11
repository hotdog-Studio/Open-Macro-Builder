// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const here = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url))
const builderConfig = () => yaml.load(readFileSync(here('electron-builder.yml'), 'utf8'))
const packageJson = () => JSON.parse(readFileSync(here('package.json'), 'utf8'))

describe('Windows packaging', () => {
  it('packs only the built app', () => {
    const { files } = builderConfig()
    expect(files).toEqual(['dist/**', 'dist-electron/**', 'package.json', '!**/*.map'])
    expect(files.some((entry) => entry.includes('local'))).toBe(false)
  })

  it('writes into an ignored folder', () => {
    expect(builderConfig().directories.output).toBe('release')
    // Exit code 0 means git ignores the path; 1 makes execFileSync throw.
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', 'configurator/release/x'], { cwd: repoRoot }),
    ).not.toThrow()
  })

  it('builds both Windows targets', () => {
    const pkg = packageJson()
    expect(pkg.scripts.dist).toContain('--win nsis portable')
    expect(pkg.main).toBe('dist-electron/main.cjs')
  })
})
