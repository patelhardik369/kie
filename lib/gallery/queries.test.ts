/**
 * The Phase 5 exit criteria, checked against a real Postgres database.
 *
 * "Every generation is findable, its exact parameters are visible, and one
 * click reproduces it. A sweep of 5 seeds yields 5 rows sharing a batch_id and
 * one parent_id. Failed generations are visible as cards, not gaps."
 *
 * A second criterion was added when the studio went multi-browser, and it is
 * checked here too: **a query never returns another workspace's rows.** The
 * service-role connection bypasses row-level security, so the only thing
 * enforcing that is the WHERE clause in every query — which makes it exactly the
 * kind of thing worth a test rather than a convention.
 *
 * Needs TEST_DATABASE_URL. Without one the suite skips rather than failing; see
 * lib/db/test-support.ts.
 *
 * Requires --conditions=react-server, which resolves `server-only` to its
 * no-op build. See package.json's test script.
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { configureTestEnv, SKIP_REASON, TEST_TABLES } from '../db/test-support.ts'

const configured = configureTestEnv()

const { assets, generations, getDb, getSql, closeDb } = configured
  ? await import('../db/index.ts')
  : ({} as never)
const { requireModel } = await import('../kie/registry/index.ts')
const { submitBatch } = configured ? await import('../jobs/submit.ts') : ({} as never)
const { newBatchId } = configured ? await import('../jobs/submit.ts') : ({} as never)
const { parseGalleryFilter } = await import('./filters.ts')
const { getGalleryFacets, getGenerationDetail, listGenerations, recentGenerations } =
  configured ? await import('./queries.ts') : ({} as never)

const filter = (query: string) => parseGalleryFilter(new URLSearchParams(query))

/** The workspace every fixture below belongs to. */
const WS = 'wk_00000000000000000000000000000001'
/** A second one, used only to prove nothing leaks across the boundary. */
const OTHER_WS = 'wk_00000000000000000000000000000002'

/** No test here should reach the network; Kie is stubbed into failing fast. */
let realFetch: typeof globalThis.fetch

before(async () => {
  realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: 422, msg: 'stubbed: no network in tests' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
})

after(async () => {
  globalThis.fetch = realFetch
  if (configured) await closeDb()
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
  nsfw?: boolean
  /** Defaults to WS. Set only by the isolation tests. */
  workspaceId?: string
}

async function seed(options: SeedOptions = {}): Promise<string> {
  const id = `g-${String(++seq).padStart(3, '0')}`
  const workspaceId = options.workspaceId ?? WS
  await getDb()
    .insert(generations)
    .values({
      id,
      workspaceId,
      modelSlug: options.modelSlug ?? 'kling-2.6/text-to-video',
      family: options.family ?? 'kling',
      capability: options.capability ?? 'text-to-video',
      inputJson: JSON.stringify({ prompt: options.prompt ?? 'a lemon', duration: '5' }),
      state: (options.state ?? 'complete') as never,
      favorite: options.favorite ?? false,
      nsfw: options.nsfw ?? false,
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
      workspaceId,
      kind: 'video',
      storagePath: `${workspaceId}/2026-09-01/kling/model/${id}-0.mp4`,
      remoteUrl: 'https://cdn.test.invalid/x.mp4',
      mime: 'video/mp4',
      bytes: 1024,
      idx: 0,
    })
  }
  return id
}

/**
 * Empties every table between cases.
 *
 * TRUNCATE rather than DELETE: it is one statement, it resets nothing this suite
 * depends on, and CASCADE saves having to get the foreign-key order right by
 * hand every time a table is added.
 */
async function clear() {
  await getSql().unsafe(`truncate ${TEST_TABLES.join(', ')} cascade`)
}

const suite = configured ? describe : describe.skip
if (!configured) console.log(`[skip] lib/gallery/queries.test.ts — ${SKIP_REASON}`)

suite('every generation is findable', () => {
  it('lists newest first', async () => {
    await clear()
    const older = await seed({ createdAt: 1_000 })
    const newer = await seed({ createdAt: 2_000 })

    const page = await listGenerations(WS, filter(''))
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
      (await listGenerations(WS, filter('family=wan'))).items.map((i) => i.generation.id),
      [wan],
    )
    assert.equal((await listGenerations(WS, filter('capability=text-to-image'))).total, 1)
    assert.equal(
      (await listGenerations(WS, filter('model=wan%2F2-7-image'))).total,
      1,
    )
  })

  it('searches the stored prompt', async () => {
    await clear()
    const lemon = await seed({ prompt: 'a ripe lemon on white' })
    await seed({ prompt: 'a blue car at night' })

    const page = await listGenerations(WS, filter('q=lemon'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [lemon])
  })

  it('treats LIKE wildcards in a search as literal text', async () => {
    await clear()
    await seed({ prompt: 'plain text' })
    const literal = await seed({ prompt: '100% cotton' })

    // Unescaped, "%" would match everything and the filter would look broken.
    const page = await listGenerations(WS, filter('q=100%25'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [literal])
  })

  it('filters by favorite', async () => {
    await clear()
    const starred = await seed({ favorite: true })
    await seed({ favorite: false })

    const page = await listGenerations(WS, filter('favorite=1'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [starred])
  })

  it('filters by an inclusive date range', async () => {
    await clear()
    const onTheDay = await seed({ createdAt: new Date(2026, 8, 1, 23, 59).getTime() })
    await seed({ createdAt: new Date(2026, 8, 2, 0, 1).getTime() })

    // The whole of the `to` day counts, right up to 23:59.
    const page = await listGenerations(WS, filter('from=2026-09-01&to=2026-09-01'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [onTheDay])
  })

  it('paginates without losing or repeating a row', async () => {
    await clear()
    for (let i = 0; i < 7; i++) await seed({ createdAt: 1_000 + i })

    const first = await listGenerations(WS, filter('pageSize=3'))
    const second = await listGenerations(WS, filter('pageSize=3&page=2'))
    const third = await listGenerations(WS, filter('pageSize=3&page=3'))

    assert.equal(first.total, 7)
    assert.equal(first.pageCount, 3)
    assert.deepEqual([first.items.length, second.items.length, third.items.length], [3, 3, 1])

    const seen = [...first.items, ...second.items, ...third.items].map((i) => i.generation.id)
    assert.equal(new Set(seen).size, 7)
  })
})

suite('failed generations are cards, not gaps', () => {
  it('lists a failure that has no assets at all', async () => {
    await clear()
    await seed({ state: 'complete' })
    const failed = await seed({
      state: 'failed',
      failCode: '422',
      failMsg: 'Your prompt was flagged by our content policy.',
    })

    const page = await listGenerations(WS, filter(''))
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

    const page = await listGenerations(WS, filter('state=problem'))
    assert.equal(page.total, 4)
  })

  it('finds everything still in flight under one filter', async () => {
    await clear()
    for (const state of ['waiting', 'queuing', 'generating', 'downloading']) {
      await seed({ state, withAsset: false })
    }
    await seed({ state: 'complete' })

    assert.equal((await listGenerations(WS, filter('state=running'))).total, 4)
    assert.equal((await listGenerations(WS, filter('state=complete'))).total, 1)
  })
})

suite('a sweep of 5 seeds', () => {
  it('yields 5 rows sharing one batch_id and one parent_id', async () => {
    await clear()
    const model = requireModel('wan/2-7-image')
    const parent = await seed({ modelSlug: model.slug, family: 'wan' })

    const batchId = newBatchId()
    const inputs = [11, 22, 33, 44, 55].map((seed) => ({ prompt: 'a lemon', seed }))
    const submitted = await submitBatch(WS, model, inputs, { batchId, parentId: parent })

    assert.equal(submitted.length, 5)

    const rows = await listGenerations(WS, filter('model=wan%2F2-7-image'))
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
    const submitted = await submitBatch(WS, model,
      [1, 2, 3].map((seed) => ({ prompt: 'a lemon', seed })),
      { batchId },
    )

    const detail = await getGenerationDetail(WS, submitted[0]!.id)
    assert.ok(detail)
    assert.equal(detail.siblings.length, 2)
    // The row itself is never listed among its own siblings.
    assert.ok(!detail.siblings.some((s) => s.id === submitted[0]!.id))
  })
})

suite('lineage', () => {
  it('links a re-run back to what it came from, in both directions', async () => {
    await clear()
    const original = await seed({ prompt: 'first attempt' })
    const rerun = await seed({ prompt: 'first attempt', parentId: original })
    const tweak = await seed({ prompt: 'second attempt', parentId: original })

    const parentDetail = await getGenerationDetail(WS, original)
    assert.ok(parentDetail)
    assert.equal(parentDetail.parent, undefined)
    assert.deepEqual(parentDetail.children.map((c) => c.id).sort(), [rerun, tweak].sort())

    const childDetail = await getGenerationDetail(WS, rerun)
    assert.ok(childDetail)
    assert.equal(childDetail.parent?.id, original)
    assert.equal(childDetail.children.length, 0)
  })

  it('returns undefined for an id that does not exist', async () => {
    assert.equal(await getGenerationDetail(WS, 'nope'), undefined)
  })
})

suite('exact parameters are visible', () => {
  it('hands back the stored input verbatim, with its assets in order', async () => {
    await clear()
    const id = await seed({ prompt: 'a very specific lemon' })
    await getDb().insert(assets).values({
      id: `${id}-1`,
      generationId: id,
      workspaceId: WS,
      kind: 'video',
      storagePath: `${WS}/2026-09-01/kling/model/${id}-1.mp4`,
      remoteUrl: 'https://cdn.test.invalid/y.mp4',
      idx: 1,
    })

    const detail = await getGenerationDetail(WS, id)
    assert.ok(detail)
    assert.deepEqual(JSON.parse(detail.generation.inputJson), {
      prompt: 'a very specific lemon',
      duration: '5',
    })
    assert.deepEqual(detail.assets.map((a) => a.idx), [0, 1])
  })
})

suite('facets', () => {
  it('counts the whole library, not the current filter', async () => {
    await clear()
    await seed({ family: 'kling', favorite: true })
    await seed({ family: 'wan', modelSlug: 'wan/2-7-image' })
    await seed({ family: 'wan', modelSlug: 'wan/2-7-image', state: 'failed' })

    const facets = await getGalleryFacets(WS)
    assert.equal(facets.total, 3)
    assert.equal(facets.favorites, 1)
    assert.equal(facets.families.find((f) => f.value === 'wan')?.count, 2)
    assert.equal(facets.models.find((m) => m.value === 'wan/2-7-image')?.count, 2)
    assert.equal(facets.states.find((s) => s.value === 'failed')?.count, 1)
  })

  it('reports zero for an empty library rather than failing', async () => {
    await clear()
    const facets = await getGalleryFacets(WS)
    assert.equal(facets.total, 0)
    assert.equal(facets.favorites, 0)
    assert.deepEqual(facets.families, [])
  })
})

suite('generations marked private', () => {
  it('never appear in Recent on the home page', async () => {
    await clear()
    const ordinary = await seed({ prompt: 'a lemon', createdAt: 1_000 })
    // Newest, so it would head the list if it were included at all.
    await seed({ prompt: 'private', nsfw: true, createdAt: 2_000 })

    const recent = await recentGenerations(WS, 10)
    assert.deepEqual(recent.map((r) => r.generation.id), [ordinary])
  })

  it('are absent from an unfiltered gallery', async () => {
    await clear()
    const ordinary = await seed()
    await seed({ nsfw: true })

    const page = await listGenerations(WS, filter(''))
    assert.deepEqual(page.items.map((i) => i.generation.id), [ordinary])
    // The total must agree with the rows, or pagination offers a page that
    // renders empty.
    assert.equal(page.total, 1)
  })

  it('stay absent under every other filter', async () => {
    await clear()
    await seed({ nsfw: true, family: 'wan', modelSlug: 'wan/2-7-image', favorite: true })

    // Each of these would surface it if the exclusion were merely a default
    // rather than unconditional.
    for (const query of ['family=wan', 'model=wan/2-7-image', 'favorite=1', 'q=lemon', 'state=complete']) {
      const page = await listGenerations(WS, filter(query))
      assert.equal(page.items.length, 0, `?${query} leaked a marked generation`)
    }
  })

  it('are the only thing shown once the NSFW filter is on', async () => {
    await clear()
    await seed({ prompt: 'ordinary' })
    const marked = await seed({ prompt: 'marked', nsfw: true })

    const page = await listGenerations(WS, filter('nsfw=1'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [marked])
  })

  it('combine with the other filters rather than overriding them', async () => {
    await clear()
    await seed({ nsfw: true, family: 'wan', modelSlug: 'wan/2-7-image' })
    const marked = await seed({ nsfw: true, family: 'kling' })

    const page = await listGenerations(WS, filter('nsfw=1&family=kling'))
    assert.deepEqual(page.items.map((i) => i.generation.id), [marked])
  })

  it('are counted for the chip without being listed', async () => {
    await clear()
    await seed()
    await seed({ nsfw: true })
    await seed({ nsfw: true })

    const facets = await getGalleryFacets(WS)
    assert.equal(facets.nsfw, 2)
    // Facets are library-wide by design, so the total still counts all three.
    assert.equal(facets.total, 3)
  })

  it('are marked at submission, before the row can ever be listed', async () => {
    await clear()
    const model = requireModel('wan/2-7-image')
    const [open] = await submitBatch(WS, model, [{ prompt: 'ordinary' }], {})
    const [marked] = await submitBatch(WS, model, [{ prompt: 'private' }], { nsfw: true })

    // Marking afterwards would be too late: the run would have spent the
    // minutes between finishing and being marked sitting on the home page.
    const page = await listGenerations(WS, filter(''))
    assert.deepEqual(page.items.map((i) => i.generation.id), [open!.id])
    assert.equal((await getGenerationDetail(WS, marked!.id))?.generation.nsfw, true)
  })

  it('mark every run of a sweep, not just the first', async () => {
    await clear()
    const model = requireModel('wan/2-7-image')
    const runs = await submitBatch(WS, model,
      [{ prompt: 'a', seed: 1 }, { prompt: 'a', seed: 2 }, { prompt: 'a', seed: 3 }],
      { batchId: newBatchId(), nsfw: true },
    )

    assert.equal(runs.length, 3)
    assert.equal((await listGenerations(WS, filter(''))).items.length, 0)
    assert.equal((await listGenerations(WS, filter('nsfw=1'))).items.length, 3)
  })

  it('open normally on their own detail page', async () => {
    await clear()
    const marked = await seed({ nsfw: true })

    // Hiding is about listings. A row asked for by id is a row you went to.
    const detail = await getGenerationDetail(WS, marked)
    assert.equal(detail?.generation.id, marked)
    assert.equal(detail?.generation.nsfw, true)
  })
})

/**
 * The property that replaced "the database is on your laptop".
 *
 * Nothing in Postgres enforces this. The service-role connection bypasses RLS
 * entirely, so isolation rests on a WHERE clause being present in every single
 * query — which is precisely the kind of invariant that decays silently under
 * maintenance. A leak here is not a bug report, it is someone else's gallery.
 */
suite('workspace isolation', () => {
  it('never lists another workspace’s generations', async () => {
    await clear()
    const mine = await seed({ prompt: 'mine' })
    await seed({ workspaceId: OTHER_WS, prompt: 'theirs' })

    const page = await listGenerations(WS, filter(''))
    assert.deepEqual(
      page.items.map((i) => i.generation.id),
      [mine],
    )
    assert.equal(page.total, 1)
  })

  it('does not leak through a search that would otherwise match', async () => {
    await clear()
    await seed({ workspaceId: OTHER_WS, prompt: 'a very distinctive lemon' })

    // The term matches their row exactly. A missing scope would surface it.
    assert.equal((await listGenerations(WS, filter('q=distinctive'))).total, 0)
  })

  it('counts only your own rows in the facets', async () => {
    await clear()
    await seed({ family: 'wan' })
    await seed({ workspaceId: OTHER_WS, family: 'wan' })
    await seed({ workspaceId: OTHER_WS, family: 'wan' })

    const facets = await getGalleryFacets(WS)
    assert.equal(facets.total, 1)
    assert.equal(facets.families.find((f) => f.value === 'wan')?.count, 1)
  })

  it('treats another workspace’s generation as absent, not forbidden', async () => {
    await clear()
    const theirs = await seed({ workspaceId: OTHER_WS })

    // Undefined, which the page turns into a 404. Anything that distinguished
    // "not yours" from "does not exist" would confirm the row to a stranger.
    assert.equal(await getGenerationDetail(WS, theirs), undefined)
  })

  it('keeps Recent to your own work', async () => {
    await clear()
    const mine = await seed()
    await seed({ workspaceId: OTHER_WS })

    const recent = await recentGenerations(WS, 10)
    assert.deepEqual(
      recent.map((r) => r.generation.id),
      [mine],
    )
  })
})
