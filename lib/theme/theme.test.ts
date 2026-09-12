import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { ACCENT_KEY, ACCENT_PRESETS, ACCENT_SCRIPT, DEFAULT_ACCENT } from './accent.ts'
import { markSvg } from './mark.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(root + path, 'utf8')

/**
 * The default accent is one constant with three derived copies that a build
 * cannot check for itself: a string of JavaScript, a stylesheet, and an SVG
 * file. Each assertion below is the copy that would otherwise drift silently —
 * the app would keep working and simply theme itself wrong.
 */
describe('accent defaults', () => {
  it('inlines the key and default into the pre-paint script', () => {
    assert.ok(ACCENT_SCRIPT.includes(JSON.stringify(ACCENT_KEY)))
    assert.ok(ACCENT_SCRIPT.includes(JSON.stringify(DEFAULT_ACCENT)))
    // A leftover literal would mean the interpolation was undone.
    assert.ok(!/'#[0-9a-fA-F]{6}'/.test(ACCENT_SCRIPT))
  })

  it('offers the default as a named preset', () => {
    const hit = ACCENT_PRESETS.find(
      (p) => p.hex.toLowerCase() === DEFAULT_ACCENT.toLowerCase(),
    )
    assert.ok(hit, `${DEFAULT_ACCENT} is not in ACCENT_PRESETS`)
  })

  it('matches the no-JavaScript ramp in globals.css', () => {
    // What the script derives for the default, and what :root must already say
    // for the first paint — and a JS-less render — to look the same.
    const css = read('app/globals.css')
    for (const [name, value] of Object.entries(buildDefault())) {
      if (!name.startsWith('--color-')) continue
      assert.ok(
        css.includes(`${name}: ${value};`),
        `globals.css :root is stale — expected "${name}: ${value};"`,
      )
    }
  })
})

describe('the tab icon', () => {
  it('is the shared mark, painted in the default accent', () => {
    assert.equal(read('app/icon.svg').trim(), markSvg(DEFAULT_ACCENT))
  })
})

/**
 * Runs `ACCENT_SCRIPT` the way a browser would, against the smallest DOM it
 * touches, and returns the ramp for the default accent. Re-implementing the
 * OKLCH maths here would defeat the point of the test.
 */
function buildDefault(): Record<string, string> {
  const win: Record<string, any> = {}
  const doc = {
    documentElement: { style: { setProperty() {} }, setAttribute() {} },
    readyState: 'loading',
    addEventListener() {},
    createElement: () => ({ setAttribute() {} }),
    querySelectorAll: () => [],
    head: { appendChild() {} },
  }
  new Function('window', 'document', 'localStorage', ACCENT_SCRIPT)(win, doc, {
    getItem: () => null,
  })
  return win.__kieAccent.build(DEFAULT_ACCENT)
}
