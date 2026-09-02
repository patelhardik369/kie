/**
 * The Phase 5 exit criteria, checked against a real SQLite database.
 *
 * "Every generation is findable, its exact parameters are visible, and one
 * click reproduces it. A sweep of 5 seeds yields 5 rows sharing a batch_id and
 * one parent_id. Failed generations are visible as cards, not gaps."
 *
 * Requires --conditions=react-server, which resolves `server-only` to its
 * no-op build. See package.json's test script.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kie-gallery-test-'))
process.env.KIE_API_KEY = 'test-key-not-a-real-one'
process.env.DATABASE_URL = `file:${path.join(ROOT, 'gallery.db')}`
process.env.KIE_OUTPUT_DIR = path.join(ROOT, 'outputs')
delete process.env.KIE_PUBLIC_URL
delete process.env.KIE_WEBHOOK_HMAC_KEY

const { assets, generations, getDb, runMigrations } = await import('../db/index.ts')
const { requireModel } = await import('../kie/registry/index.ts')
const { submitBatch, newBatchId } = await import('../jobs/submit.ts')
const { parseGalleryFilter } = await import('./filters.ts')
const { getGalleryFacets, getGenerationDetail, listGenerations } = await import(
  './queries.ts'
)

const filter = (query: string) => parseGalleryFilter(new URLSearchParams(query))

/** No test here should reach the network; the runner is stubbed into failing fast. */
let realFetch: typeof globalThis.fetch

before(async () => {
  realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: 422, msg: 'stubbed: no network in tests' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

  await runMigrations()
})

after(() => {
  globalThis.fetch = realFetch
  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    // Windows holds the SQLite handle until the process exits; the OS reaps it.
  }
})

let seq = 0

interface SeedOptions {
  modelSlug?: string
  family?: 'kling' | 'bytedance' | 'wan'
  capability?: string
  state?: string
  prompt?: string
  favorite?: boolean
  createdAt?: number
  parentId?: string
  batchId?: string
  failCode?: string
  failMsg?: string
  withAsset?: boolean
}

async function seed(options: SeedOptions = {}): Promise<string> {
  const id = `g-${String(++seq).padStart(3, '0')}`
  await getDb()
    .insert(generations)
    .values({
      id,
      modelSlug: options.modelSlug ?? 'kling-2.6/text-to-video',
      family: options.family ?? 'kling',
      capability: options.capability ?? 'text-to-video',
      inputJson: JSON.stringify({ prompt: options.prompt ?? 'a lemon', duration: '5' }),
      state: (options.state ?? 'complete') as never,
      favorite: options.favorite ?? false,
      createdAt: options.createdAt ?? Date.now() + seq,
      parentId: options.parentId ?? null,
      batchId: options.batchId ?? null,
      failCode: options.failCode ?? null,
      failMsg: options.failMsg ?? null,
    })

  if (options.withAsset !== false && (options.state ?? 'complete') === 'complete') {
    await getDb().insert(assets).values({
      id: `${id}-0`,
      generationId: id,
      kind: 'video',
      localPath: `2026-09-01/kling/model/${id}-0.mp4`,
      remoteUrl: 'https://cdn.test.invalid/x.mp4',
      mime: 'video/mp4',
      bytes: 1024,
      idx: 0,
    })
  }
  return id
}

async function clear() {
  await getDb().delete(assets)
  await getDb().delete(generations)
}

describe('every generation is findable', () => {
  it('lists newest first', async () => {
    await clear()
    const older = await seed({ createdAt: 1_000 })
    const newer = await seed({ createdAt: 2_000 })

    const page = await listGenerations(filter(''))
    assert.deepEqual(page.items.map((i) => i.generation.id), [newer, older])
  })

  it('filters by family, capability and exact model', async () => {
    await clear()
    await seed({ family: 'kling', modelSlug: 'kling-2.6/text-to-video' })
    const wan = await seed({
      family: 'wan',
      modelSlug: 'wan/2-7-image',
      capability: 'text-to-image',
    })

    assert.deepEqual(
      (await listGenerations(filter('family=wan'))).items.map((i) => i.generation.id),
      [wan],
    )
    assert.equal((await listGenerations(filter('capability=text-to-image'))).total, 1)
    assert.equal(
      (await listGenerations(filter('model=wan%2F2-7-image'))).total,
      1,
    )
  })

  it('searches the stored prompt', async () => {
    await clear()
    const lemon = await seed({ prompt: 'a ripe lemon on white' })
    await seed({ prompt: 'a blue car at night' })

    const page = await listGenerations(filter('q=lemon'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [lemon])
  })

  it('treats LIKE wildcards in a search as literal text', async () => {
    await clear()
    await seed({ prompt: 'plain text' })
    const literal = await seed({ prompt: '100% cotton' })

    // Unescaped, "%" would match everything and the filter would look broken.
    const page = await listGenerations(filter('q=100%25'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [literal])
  })

  it('filters by favorite', async () => {
    await clear()
    const starred = await seed({ favorite: true })
    await seed({ favorite: false })

    const page = await listGenerations(filter('favorite=1'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [starred])
  })

  it('filters by an inclusive date range', async () => {
    await clear()
    const onTheDay = await seed({ createdAt: new Date(2026, 8, 1, 23, 59).getTime() })
    await seed({ createdAt: new Date(2026, 8, 2, 0, 1).getTime() })

    // The whole of the `to` day counts, right up to 23:59.
    const page = await listGenerations(filter('from=2026-09-01&to=2026-09-01'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [onTheDay])
  })

  it('paginates without losing or repeating a row', async () => {
    await clear()
    for (let i = 0; i < 7; i++) await seed({ createdAt: 1_000 + i })

    const first = await listGenerations(filter('pageSize=3'))
    const second = await listGenerations(filter('pageSize=3&page=2'))
    const third = await listGenerations(filter('pageSize=3&page=3'))

    assert.equal(first.total, 7)
    assert.equal(first.pageCount, 3)
    assert.deepEqual([first.items.length, second.items.length, third.items.length], [3, 3, 1])

    const seen = [...first.items, ...second.items, ...third.items].map((i) => i.generation.id)
    assert.equal(new Set(seen).size, 7)
  })
})

describe('failed generations are cards, not gaps', () => {
  it('lists a failure that has no assets at all', async () => {
    await clear()
    await seed({ state: 'complete' })
    const failed = await seed({
      state: 'failed',
      failCode: '422',
      failMsg: 'Your prompt was flagged by our content policy.',
    })

    const page = await listGenerations(filter(''))
    // An inner join to assets would silently drop exactly this row.
    assert.equal(page.total, 2)

    const item = page.items.find((i) => i.generation.id === failed)
    assert.ok(item, 'the failed generation is present')
    assert.equal(item.thumbnail, undefined)
    assert.equal(item.assetCount, 0)
    // Verbatim, so the card can show what actually tripped.
    assert.equal(item.generation.failMsg, 'Your prompt was flagged by our content policy.')
  })

  it('finds every stopped-short state under one filter', async () => {
    await clear()
    await seed({ state: 'complete' })
    for (const state of ['failed', 'needs_retry', 'stalled', 'orphaned']) {
      await seed({ state, withAsset: false })
    }

    const page = await listGenerations(filter('state=problem'))
    assert.equal(page.total, 4)
  })

  it('finds everything still in flight under one filter', async () => {
    await clear()
    for (const state of ['waiting', 'queuing', 'generating', 'downloading']) {
      await seed({ state, withAsset: false })
    }
    await seed({ state: 'complete' })

    assert.equal((await listGenerations(filter('state=running'))).total, 4)
    assert.equal((await listGenerations(filter('state=complete'))).total, 1)
  })
})

describe('a sweep of 5 seeds', () => {
  it('yields 5 rows sharing one batch_id and one parent_id', async () => {
    await clear()
    const model = requireModel('wan/2-7-image')
    const parent = await seed({ modelSlug: model.slug, family: 'wan' })

    const batchId = newBatchId()
    const inputs = [11, 22, 33, 44, 55].map((seed) => ({ prompt: 'a lemon', seed }))
    const submitted = await submitBatch(model, inputs, { batchId, parentId: parent })

    assert.equal(submitted.length, 5)

    const rows = await listGenerations(filter('model=wan%2F2-7-image'))
    const sweepRows = rows.items.filter((i) => i.generation.batchId === batchId)

    assert.equal(sweepRows.length, 5)
    assert.equal(new Set(sweepRows.map((r) => r.generation.batchId)).size, 1)
    assert.equal(new Set(sweepRows.map((r) => r.generation.parentId)).size, 1)
    assert.equal(sweepRows[0]!.generation.parentId, parent)

    // Each run stores its OWN seed verbatim, which is what makes the five
    // individually reproducible rather than five copies of one record.
    const seeds = sweepRows
      .map((r) => (JSON.parse(r.generation.inputJson) as { seed: number }).seed)
      .sort((a, b) => a - b)
    assert.deepEqual(seeds, [11, 22, 33, 44, 55])
  })

  it('surfaces the other runs of the sweep from any one of them', async () => {
    await clear()
    const model = requireModel('wan/2-7-image')
    const batchId = newBatchId()
    const submitted = await submitBatch(
      model,
      [1, 2, 3].map((seed) => ({ prompt: 'a lemon', seed })),
      { batchId },
    )

    const detail = await getGenerationDetail(submitted[0]!.id)
    assert.ok(detail)
    assert.equal(detail.siblings.length, 2)
    // The row itself is never listed among its own siblings.
    assert.ok(!detail.siblings.some((s) => s.id === submitted[0]!.id))
  })
})

describe('lineage', () => {
  it('links a re-run back to what it came from, in both directions', async () => {
    await clear()
    const original = await seed({ prompt: 'first attempt' })
    const rerun = await seed({ prompt: 'first attempt', parentId: original })
    const tweak = await seed({ prompt: 'second attempt', parentId: original })

    const parentDetail = await getGenerationDetail(original)
    assert.ok(parentDetail)
    assert.equal(parentDetail.parent, undefined)
    assert.deepEqual(parentDetail.children.map((c) => c.id).sort(), [rerun, tweak].sort())

    const childDetail = await getGenerationDetail(rerun)
    assert.ok(childDetail)
    assert.equal(childDetail.parent?.id, original)
    assert.equal(childDetail.children.length, 0)
  })

  it('returns undefined for an id that does not exist', async () => {
    assert.equal(await getGenerationDetail('nope'), undefined)
  })
})

describe('exact parameters are visible', () => {
  it('hands back the stored input verbatim, with its assets in order', async () => {
    await clear()
    const id = await seed({ prompt: 'a very specific lemon' })
    await getDb().insert(assets).values({
      id: `${id}-1`,
      generationId: id,
      kind: 'video',
      localPath: `2026-09-01/kling/model/${id}-1.mp4`,
      remoteUrl: 'https://cdn.test.invalid/y.mp4',
      idx: 1,
    })

    const detail = await getGenerationDetail(id)
    assert.ok(detail)
    assert.deepEqual(JSON.parse(detail.generation.inputJson), {
      prompt: 'a very specific lemon',
      duration: '5',
    })
    assert.deepEqual(detail.assets.map((a) => a.idx), [0, 1])
  })
})

describe('facets', () => {
  it('counts the whole library, not the current filter', async () => {
    await clear()
    await seed({ family: 'kling', favorite: true })
    await seed({ family: 'wan', modelSlug: 'wan/2-7-image' })
    await seed({ family: 'wan', modelSlug: 'wan/2-7-image', state: 'failed' })

    const facets = await getGalleryFacets()
    assert.equal(facets.total, 3)
    assert.equal(facets.favorites, 1)
    assert.equal(facets.families.find((f) => f.value === 'wan')?.count, 2)
    assert.equal(facets.models.find((m) => m.value === 'wan/2-7-image')?.count, 2)
    assert.equal(facets.states.find((s) => s.value === 'failed')?.count, 1)
  })

  it('reports zero for an empty library rather than failing', async () => {
    await clear()
    const facets = await getGalleryFacets()
    assert.equal(facets.total, 0)
    assert.equal(facets.favorites, 0)
    assert.deepEqual(facets.families, [])
  })
})
