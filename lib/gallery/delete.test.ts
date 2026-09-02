/**
 * Deleting a generation: the row, its assets, and the bytes on disk.
 *
 * The rules under test are the ones that make a delete safe to offer at all —
 * files actually go, an in-flight generation is refused, a path that escapes
 * KIE_OUTPUT_DIR is never touched, and lineage survives the loss of a link.
 *
 * Requires --conditions=react-server, which resolves `server-only` to its
 * no-op build. See package.json's test script.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kie-delete-test-'))
const OUTPUT_DIR = path.join(ROOT, 'outputs')
process.env.KIE_API_KEY = 'test-key-not-a-real-one'
process.env.DATABASE_URL = `file:${path.join(ROOT, 'delete.db')}`
process.env.KIE_OUTPUT_DIR = OUTPUT_DIR
delete process.env.KIE_PUBLIC_URL
delete process.env.KIE_WEBHOOK_HMAC_KEY

const { assets, generations, getDb, runMigrations } = await import('../db/index.ts')
const { deleteGeneration, deleteGenerations } = await import('./delete.ts')

before(async () => {
  await runMigrations()
})

after(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    // Windows holds the SQLite handle until the process exits; the OS reaps it.
  }
})

let seq = 0

interface SeedOptions {
  state?: string
  parentId?: string | null
  /** Relative paths to write and register as outputs. */
  files?: string[]
  /** Registered without writing the file, to model a missing output. */
  ghostFiles?: string[]
}

async function seed(options: SeedOptions = {}): Promise<string> {
  const id = `g-${String(++seq).padStart(3, '0')}`
  await getDb()
    .insert(generations)
    .values({
      id,
      modelSlug: 'kling-2.6/text-to-video',
      family: 'kling',
      capability: 'text-to-video',
      inputJson: JSON.stringify({ prompt: 'a lemon' }),
      state: (options.state ?? 'complete') as never,
      parentId: options.parentId ?? null,
      createdAt: Date.now() + seq,
    })

  const registered = [
    ...(options.files ?? []).map((rel) => ({ rel, write: true })),
    ...(options.ghostFiles ?? []).map((rel) => ({ rel, write: false })),
  ]

  let idx = 0
  for (const { rel, write } of registered) {
    if (write) {
      const absolute = path.join(OUTPUT_DIR, rel)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, 'x'.repeat(64))
    }
    await getDb().insert(assets).values({
      id: `${id}-${idx}`,
      generationId: id,
      kind: 'video',
      localPath: rel,
      remoteUrl: 'https://cdn.test.invalid/x.mp4',
      bytes: 64,
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

describe('deleting a generation', () => {
  it('removes the row, its asset rows and the files', async () => {
    const rel = '2026-09-02/kling/model/one-0.mp4'
    const id = await seed({ files: [rel] })

    const outcome = await deleteGeneration(id)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.deleted.filesDeleted, 1)
    assert.equal(outcome.ok && outcome.deleted.bytesFreed, 64)
    assert.equal(fs.existsSync(path.join(OUTPUT_DIR, rel)), false)
    assert.deepEqual(await rows(id), [])
    assert.deepEqual(await assetRows(id), [])
  })

  it('prunes the folders the delete emptied, and keeps the ones it did not', async () => {
    const kept = '2026-09-03/kling/model/keeper-0.mp4'
    const going = '2026-09-03/kling/model/going-0.mp4'
    const lonely = '2026-09-04/wan/other/lonely-0.mp4'
    await seed({ files: [kept] })
    const goingId = await seed({ files: [going] })
    const lonelyId = await seed({ files: [lonely] })

    await deleteGeneration(goingId)
    // Its neighbour is still there, so nothing above it may be removed.
    assert.equal(fs.existsSync(path.join(OUTPUT_DIR, '2026-09-03/kling/model')), true)

    await deleteGeneration(lonelyId)
    assert.equal(fs.existsSync(path.join(OUTPUT_DIR, '2026-09-04')), false)
    // The pruning stops at the output root itself.
    assert.equal(fs.existsSync(OUTPUT_DIR), true)
  })

  it('counts a file that is already gone rather than failing', async () => {
    const id = await seed({ ghostFiles: ['2026-09-02/kling/model/ghost-0.mp4'] })

    const outcome = await deleteGeneration(id)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.deleted.filesMissing, 1)
    assert.equal(outcome.ok && outcome.deleted.filesDeleted, 0)
    assert.deepEqual(await rows(id), [])
  })

  it('never touches a path that escapes the output directory', async () => {
    const outside = path.join(ROOT, 'not-ours.mp4')
    fs.writeFileSync(outside, 'precious')
    const id = await seed({ ghostFiles: ['../not-ours.mp4'] })

    const outcome = await deleteGeneration(id)

    assert.equal(outcome.ok, true)
    assert.equal(fs.readFileSync(outside, 'utf8'), 'precious')
    // Skipped: neither deleted nor counted as missing.
    assert.equal(outcome.ok && outcome.deleted.filesDeleted, 0)
    assert.equal(outcome.ok && outcome.deleted.filesMissing, 0)
    assert.deepEqual(await rows(id), [])
  })

  it('refuses while the runner still owns the generation', async () => {
    for (const state of ['waiting', 'queuing', 'generating', 'downloading']) {
      const id = await seed({ state })
      const outcome = await deleteGeneration(id)

      assert.equal(outcome.ok, false, `${state} should be refused`)
      assert.equal(!outcome.ok && outcome.reason, 'in_flight')
      assert.equal((await rows(id)).length, 1)
    }
  })

  it('deletes a generation that stopped short, which is the point', async () => {
    for (const state of ['failed', 'stalled', 'needs_retry', 'orphaned', 'draft']) {
      const id = await seed({ state })
      assert.equal((await deleteGeneration(id)).ok, true, `${state} should delete`)
    }
  })

  it('reports a missing generation instead of pretending', async () => {
    const outcome = await deleteGeneration('no-such-id')
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.reason, 'not_found')
  })

  it('re-points children at the deleted generation own parent', async () => {
    const grandparent = await seed()
    const parent = await seed({ parentId: grandparent })
    const child = await seed({ parentId: parent })

    const outcome = await deleteGeneration(parent)

    assert.equal(outcome.ok && outcome.deleted.childrenRelinked, 1)
    const [row] = await rows(child)
    assert.equal(row.parentId, grandparent)
  })

  it('leaves a root deletion children parentless rather than dangling', async () => {
    const parent = await seed()
    const child = await seed({ parentId: parent })

    await deleteGeneration(parent)

    const [row] = await rows(child)
    assert.equal(row.parentId, null)
  })

  it('deletes many, and reports the ones it would not', async () => {
    const good = await seed()
    const running = await seed({ state: 'generating' })

    const result = await deleteGenerations([good, running, 'no-such-id'])

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
