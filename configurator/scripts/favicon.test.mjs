// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = fileURLToPath(new URL('../index.html', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

// The page's icons in the order it lists them: their type and the file each one points at.
function icons() {
  const links = readFileSync(page, 'utf8').match(/<link\s[^>]*>/g) ?? []
  return links
    .filter((tag) => attribute(tag, 'rel') === 'icon')
    .map((tag) => ({ type: attribute(tag, 'type'), file: resolve(dirname(page), attribute(tag, 'href')) }))
}

describe('the page icon', () => {
  it('is the project logo: a PNG first, then the SVG that browsers able to show one take', () => {
    expect(icons()).toEqual([
      { type: 'image/png', file: resolve(repoRoot, 'img/logo.png') },
      { type: 'image/svg+xml', file: resolve(repoRoot, 'img/logo.svg') },
    ])
    for (const { file } of icons()) expect(existsSync(file), file).toBe(true)
  })
})
