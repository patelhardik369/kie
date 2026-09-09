/**
 * Deleting a generation: the row, its asset rows, and the objects in the bucket.
 *
 * The rules under test are the ones that make a delete safe to offer at all —
 * an in-flight generation is refused, another workspace's object is never
 * touched, lineage survives the loss of a link, and the bytes are accounted for
 * so the storage meter can be trusted.
 *
 * The object store is stubbed rather than real. What matters here is *which*
 * keys are handed to it and which are withheld, and that is exactly what a stub
 * can assert precisely — where a real bucket would make the traversal test
 * ("never remove a key outside this workspace") depend on the very code it is
 * supposed to be checking.
 *
 * Needs TEST_DATABASE_URL. Without one the suite skips rather than failing; see
 * lib/db/test-support.ts.
 *
 * Requires --conditions=react-server, which resolves `server-only` to its
 * no-op build. See package.json's test script.
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import { configureTestEnv, SKIP_REASON, TEST_TABLES } from '../db/test-support.ts'

const configured = configureTestEnv()

const { assets, generations, getDb, getSql, closeDb } = configured
  ? await import('../db/index.ts')
  : ({} as never)
const objects = configured ? await import('../storage/objects.ts') : ({} as never)
const { deleteGeneration, deleteGenerations } = configured
  ? await import('./delete.ts')
  : ({} as never)

const WS = 'wk_00000000000000000000000000000001'
const OTHER_WS = 'wk_00000000000000000000000000000002'

/** Keys the stub was asked to remove, most recent call last. */
let removed: string[] = []
let realRemove: typeof objects.removeObjects

before(() => {
  if (!configured) return
  realRemove = objects.removeObjects
  Object.defineProperty(objects, 'removeObjects', {
    configurable: true,
    value: async (keys: string[]) => {
      removed.push(...keys)
      return keys.length
    },
  })
})

after(async () => {
  if (!configured) return
  Object.defineProperty(objects, 'removeObjects', {
    configurable: true,
    value: realRemove,
  })
  await closeDb()
})

beforeEach(async () => {
  if (!configured) return
  removed = []
  await getSql().unsafe(`truncate ${TEST_TABLES.join(', ')} cascade`)
})

let seq = 0

interface SeedOptions {
  state?: string
  parentId?: string | null
  workspaceId?: string
  /** Object keys to register as stored outputs. */
  keys?: string[]
  /** Registered with no object at all, modelling an output too large to store. */
  unstored?: number
}

async function seed(options: SeedOptions = {}): Promise<string> {
  const id = `g-${String(++seq).padStart(3, '0')}`
  const workspaceId = options.workspaceId ?? WS

  await getDb()
    .insert(generations)
    .values({
      id,
      workspaceId,
      modelSlug: 'kling-2.6/text-to-video',
      family: 'kling',
      capability: 'text-to-video',
      inputJson: JSON.stringify({ prompt: 'a lemon' }),
      state: (options.state ?? 'complete') as never,
      parentId: options.parentId ?? null,
      createdAt: Date.now() + seq,
    })

  let idx = 0
  for (const key of options.keys ?? []) {
    await getDb().insert(assets).values({
      id: `${id}-${idx}`,
      generationId: id,
      workspaceId,
      kind: 'video',
      storagePath: key,
      storageState: 'stored',
      remoteUrl: 'https://cdn.test.invalid/x.mp4',
      bytes: 64,
      idx,
    })
    idx += 1
  }

  for (let n = 0; n < (options.unstored ?? 0); n++) {
    await getDb().insert(assets).values({
      id: `${id}-${idx}`,
      generationId: id,
      workspaceId,
      kind: 'video',
      storagePath: null,
      storageState: 'too_large',
      remoteUrl: 'https://cdn.test.invalid/big.mp4',
      bytes: 90_000_000,
      idx,
    })
    idx += 1
  }

  return id
}

const rows = async (id: string) =>
  (await getDb().select().from(generations)).filter((row) => row.id === id)

const assetRows = async (id: string) =>
  (await getDb().select().from(assets)).filter((row) => row.generationId === id)

const suite = configured ? describe : describe.skip
if (!configured) console.log(`[skip] lib/gallery/delete.test.ts — ${SKIP_REASON}`)

suite('deleting a generation', () => {
  it('removes the row, its asset rows and the objects', async () => {
    const key = `${WS}/2026-09-02/kling/model/one-0.mp4`
    const id = await seed({ keys: [key] })

    const outcome = await deleteGeneration(WS, id)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.deleted.filesDeleted, 1)
    assert.equal(outcome.ok && outcome.deleted.bytesFreed, 64)
    assert.deepEqual(removed, [key])
    assert.deepEqual(await rows(id), [])
    assert.deepEqual(await assetRows(id), [])
  })

  /**
   * The traversal guard, in object-store terms.
   *
   * `storage_path` is data. A row naming another workspace's object — through a
   * bug, a bad import, or a hand-edited database — must not turn a delete of
   * your own generation into a delete of somebody else's file.
   */
  it('never removes an object outside the deleting workspace', async () => {
    const theirs = `${OTHER_WS}/2026-09-02/kling/model/theirs-0.mp4`
    const id = await seed({ keys: [theirs] })

    const outcome = await deleteGeneration(WS, id)

    assert.equal(outcome.ok, true)
    assert.deepEqual(removed, [], 'no key outside the workspace may be removed')
    // Counted as missing, and its bytes are NOT claimed as freed: nothing was.
    assert.equal(outcome.ok && outcome.deleted.filesMissing, 1)
    assert.equal(outcome.ok && outcome.deleted.bytesFreed, 0)
    assert.deepEqual(await rows(id), [])
  })

  it('counts an output that was never stored rather than failing', async () => {
    // An output past the 50 MB per-object ceiling has no key to remove. The
    // generation still deletes; there is simply nothing in the bucket for it.
    const id = await seed({ unstored: 1 })

    const outcome = await deleteGeneration(WS, id)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.deleted.filesMissing, 1)
    assert.equal(outcome.ok && outcome.deleted.filesDeleted, 0)
    assert.deepEqual(removed, [])
    assert.deepEqual(await rows(id), [])
  })

  it('refuses while a driver still owns the generation', async () => {
    for (const state of ['waiting', 'queuing', 'generating', 'downloading']) {
      const id = await seed({ state })
      const outcome = await deleteGeneration(WS, id)

      assert.equal(outcome.ok, false, `${state} should be refused`)
      assert.equal(!outcome.ok && outcome.reason, 'in_flight')
      assert.equal((await rows(id)).length, 1)
    }
  })

  it('deletes a generation that stopped short, which is the point', async () => {
    for (const state of ['failed', 'stalled', 'needs_retry', 'orphaned', 'draft']) {
      const id = await seed({ state })
      assert.equal((await deleteGeneration(WS, id)).ok, true, `${state} should delete`)
    }
  })

  it('reports a missing generation instead of pretending', async () => {
    const outcome = await deleteGeneration(WS, 'no-such-id')
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.reason, 'not_found')
  })

  it('will not delete another workspace’s generation', async () => {
    const theirs = await seed({ workspaceId: OTHER_WS })

    const outcome = await deleteGeneration(WS, theirs)

    // not_found, not forbidden: distinguishing the two would confirm to a
    // stranger that the id exists.
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.reason, 'not_found')
    assert.equal((await rows(theirs)).length, 1)
  })

  it('re-points children at the deleted generation’s own parent', async () => {
    const grandparent = await seed()
    const parent = await seed({ parentId: grandparent })
    const child = await seed({ parentId: parent })

    const outcome = await deleteGeneration(WS, parent)

    assert.equal(outcome.ok && outcome.deleted.childrenRelinked, 1)
    const [row] = await rows(child)
    assert.equal(row!.parentId, grandparent)
  })

  it('leaves a root deletion’s children parentless rather than dangling', async () => {
    const parent = await seed()
    const child = await seed({ parentId: parent })

    await deleteGeneration(WS, parent)

    const [row] = await rows(child)
    assert.equal(row!.parentId, null)
  })

  it('deletes many, and reports the ones it would not', async () => {
    const good = await seed()
    const running = await seed({ state: 'generating' })

    const result = await deleteGenerations(WS, [good, running, 'no-such-id'])

    assert.deepEqual(
      result.deleted.map((d) => d.id),
      [good],
    )
    assert.deepEqual(
      result.refused.map((r) => r.reason),
      ['in_flight', 'not_found'],
    )
  })
})
