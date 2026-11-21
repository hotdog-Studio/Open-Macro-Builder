import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadAhkReference } from './ahkReference'

// The AutoHotkey reference is about 110 kB of text and a parse of it. It must be a chunk of its own,
// fetched with the Commands tab, so nothing the page imports statically may import it.

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The relative modules a source file imports statically (`import ... from`, `export ... from`, `import '...'`), without a query. */
function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const specs = [...text.matchAll(/\bfrom\s+'(\.{1,2}\/[^']+)'/g), ...text.matchAll(/^import\s+'(\.{1,2}\/[^']+)'/gm)].map((m) => m[1])
  return specs.map((spec) => resolve(dirname(file), spec.split('?')[0]))
}

/** The file a module path names: itself, or with .ts, .tsx or /index.ts after it. */
function fileOf(path: string): string | null {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find((p) => existsSync(p) && statSync(p).isFile()) ?? null
}

/** Every source file reached from `entry` by static imports. */
function reachedFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const todo = [entry]
  for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(?:ts|tsx)$/.test(file)) continue
    for (const path of staticImports(file)) {
      const found = fileOf(path)
      if (found) todo.push(found)
    }
  }
  return seen
}

describe('the AutoHotkey reference', () => {
  it('loads on demand, with its entries', async () => {
    const reference = await loadAhkReference()
    expect(reference.lang).toBe('ahk')
    expect(reference.entries.length).toBeGreaterThan(100)
  })

  it('is not imported statically by the page, only by its loader', () => {
    const reached = [...reachedFrom(resolve(src, 'main.tsx'))].map((f) => f.slice(src.length + 1).split(sep).join('/'))
    // The walk does reach the tab and the loader, so a miss below is no broken walk.
    expect(reached).toEqual(expect.arrayContaining(['ui/CommandsTab.tsx', 'state/ahkReference.ts', 'core/commands/reference.ts']))
    expect(reached.filter((f) => f === 'core/commands/ahkReference.ts' || f.endsWith('.ahk'))).toEqual([])
  })
})
