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

  /*
   * The regression this guards: the script used to delete Next's icon link,
   * which React owns. React's next unmount of it threw on the detached node and
   * abandoned the navigation after the URL had changed — every first click after
   * a load left the old page on screen.
   */
  it('never detaches the icon link React rendered', () => {
    const head = fakeHead()
    const served = head.add({ rel: 'icon', href: '/icon.svg' })

    const { accent } = runScript(head, '#12A594')

    assert.equal(served.parentNode, head, 'the served link was removed')
    assert.deepEqual(head.removed, [])
    assert.equal(head.icons().length, 2)
    assert.equal(head.icons().at(-1)!.getAttribute('data-kie-icon'), '')

    // A later accent change repaints the same link rather than adding another.
    accent.apply('#E5484D')
    assert.equal(head.icons().length, 2)
    assert.ok(head.icons().at(-1)!.getAttribute('href')!.includes(encodeURIComponent('#E5484D')))
  })

  it('stays the last icon when React inserts one after it', () => {
    const head = fakeHead()
    runScript(head, null)

    // What hydration or a client navigation does: a fresh React-owned link,
    // appended to the end of <head>.
    const inserted = head.add({ rel: 'icon', href: '/icon.svg' })

    assert.equal(inserted.parentNode, head)
    assert.equal(head.icons().at(-1)!.getAttribute('data-kie-icon'), '')
    assert.deepEqual(head.removed, [])
  })
})

type FakeNode = {
  parentNode: unknown
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

/**
 * The smallest <head> the icon code touches. Observers fire synchronously, so a
 * script that reacted to its own append by appending again would overflow the
 * stack here rather than spin quietly in a browser.
 */
function fakeHead() {
  const children: FakeNode[] = []
  const observers: (() => void)[] = []
  const removed: FakeNode[] = []

  const node = (attrs: Record<string, string> = {}): FakeNode => {
    const map = new Map(Object.entries(attrs))
    return {
      parentNode: null,
      getAttribute: (name) => map.get(name) ?? null,
      setAttribute: (name, value) => void map.set(name, value),
    }
  }

  const head = {
    removed,
    observers,
    node,
    icons: () => children.filter((c) => /\bicon\b/.test(c.getAttribute('rel') ?? '')),
    querySelectorAll: () => head.icons(),
    appendChild(child: FakeNode) {
      const at = children.indexOf(child)
      if (at >= 0) children.splice(at, 1)
      children.push(child)
      child.parentNode = head
      for (const notify of observers) notify()
      return child
    },
    removeChild(child: FakeNode) {
      children.splice(children.indexOf(child), 1)
      child.parentNode = null
      removed.push(child)
      return child
    },
    add(attrs: Record<string, string>) {
      return head.appendChild(node(attrs))
    },
  }
  return head
}

function runScript(head: ReturnType<typeof fakeHead>, stored: string | null) {
  const win: Record<string, any> = {}
  const doc = {
    documentElement: { style: { setProperty() {} }, setAttribute() {} },
    readyState: 'complete',
    addEventListener() {},
    createElement: () => head.node(),
    querySelectorAll: () => head.icons(),
    head,
  }
  function Observer(this: { observe(): void }, callback: () => void) {
    this.observe = () => void head.observers.push(callback)
  }
  new Function('window', 'document', 'localStorage', 'MutationObserver', ACCENT_SCRIPT)(
    win,
    doc,
    { getItem: () => stored },
    Observer,
  )
  return { accent: win.__kieAccent }
}

/**
 * Runs `ACCENT_SCRIPT` the way a browser would, against the smallest DOM it
 * touches, and returns the ramp for the default accent. Re-implementing the
 * OKLCH maths here would defeat the point of the test.
 */
function buildDefault(): Record<string, string> {
  return runScript(fakeHead(), null).accent.build(DEFAULT_ACCENT)
}
