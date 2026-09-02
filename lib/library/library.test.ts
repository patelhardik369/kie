/**
 * The Phase 6 exit criteria, checked against a real database.
 *
 * "A preset saved before a registry change still applies and reports dropped
 * fields. An asset reused inside 24h skips re-upload; an expired one re-uploads
 * transparently."
 *
 * Requires --conditions=react-server. See package.json's test script.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kie-library-test-'))
process.env.KIE_API_KEY = 'test-key-not-a-real-one'
process.env.DATABASE_URL = `file:${path.join(ROOT, 'library.db')}`
process.env.KIE_OUTPUT_DIR = path.join(ROOT, 'outputs')
delete process.env.KIE_PUBLIC_URL

const { creditLog, getDb, inputAssets, presets, prompts, runMigrations } = await import(
  '../db/index.ts'
)
const { requireModel } = await import('../kie/registry/index.ts')
const { applyPreset } = await import('../presets/apply.ts')
const { storeUpload, refreshUpload } = await import('../jobs/uploads.ts')
const {
  createPreset,
  createPrompt,
  deletePrompt,
  getSpendSummary,
  listInputAssets,
  listPresets,
  listPrompts,
  promptTags,
  recordBalance,
} = await import('./queries.ts')
const { readBalance } = await import('./balance.ts')
const { eq } = await import('drizzle-orm')

const model = requireModel('wan/2-7-image')

// --------------------------------------------------------- fake upload host

let realFetch: typeof globalThis.fetch
let uploadCalls = 0
/** Controls the expiry the fake upload host reports. */
let uploadTtlMs = 24 * 60 * 60 * 1000
/** What the fake `/chat/credit` answers with. */
let creditResponse: { balance: number } | { code: number; msg: string } = { balance: 250 }

before(async () => {
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('file-stream-upload')) {
      uploadCalls++
      // Kie's REAL response shape, verified against the live endpoint: the link
      // is `downloadUrl`, there is no `fileUrl`, and the only timestamp is
      // `uploadedAt`. The previous fake invented a `fileUrl` — so it passed
      // while the app silently dropped every upload.
      return new Response(
        JSON.stringify({
          success: true,
          code: 200,
          msg: 'File uploaded successfully',
          data: {
            success: true,
            fileName: `file-${uploadCalls}.png`,
            filePath: `kieai/1/kie-studio/file-${uploadCalls}.png`,
            downloadUrl: `https://tempfile.redpandaai.co/kieai/1/kie-studio/file-${uploadCalls}.png`,
            fileSize: 1024,
            mimeType: 'image/png',
            uploadedAt: new Date(Date.now() - (24 * 60 * 60 * 1000 - uploadTtlMs)).toISOString(),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (url.includes('file-base64-upload')) {
      uploadCalls++
      // The variant that answers without a usable link at all.
      return new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { fileName: 'x.png', fileSize: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (url.includes('/chat/credit')) {
      // Kie returns the balance as a BARE NUMBER in `data`, and returns its
      // errors as an HTTP 200 with the real status in the envelope's `code`.
      const body =
        'balance' in creditResponse
          ? { code: 200, msg: 'success', data: creditResponse.balance }
          : creditResponse
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    throw new Error(`Unexpected request in a test: ${url}`)
  }) as typeof globalThis.fetch

  await runMigrations()
})

after(() => {
  globalThis.fetch = realFetch
  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    // Windows holds the SQLite handle until the process exits.
  }
})

beforeEach(async () => {
  uploadCalls = 0
  uploadTtlMs = 24 * 60 * 60 * 1000
  creditResponse = { balance: 250 }
  const db = getDb()
  await db.delete(inputAssets)
  await db.delete(presets)
  await db.delete(prompts)
  // credit_log too: recordBalance throttles against the LAST row, so a reading
  // left by an earlier test would change what the next one observes.
  await db.delete(creditLog)
})

const bytes = (text: string) => new TextEncoder().encode(text)

// ------------------------------------------------------------------ assets

describe('what an upload returns', () => {
  it('resolves the model-ready URL from Kie’s downloadUrl', async () => {
    // The bug this pins: `UploadedFile` declared a `fileUrl` field that the API
    // does not have. Reading it gave undefined, JSON.stringify dropped the key,
    // and the form appended nothing — an upload that succeeded and vanished.
    const stored = await storeUpload({ content: bytes('a lemon'), filename: 'lemon.png' })

    assert.equal(typeof stored.fileUrl, 'string')
    assert.match(stored.fileUrl, /^https:\/\/tempfile\.redpandaai\.co\//)
    assert.equal(stored.mime, 'image/png')
  })

  it('fails loudly when the response carries no usable URL', async () => {
    // Better a visible error than a file that quietly attaches to nothing.
    const { uploadBase64 } = await import('../kie/upload.ts')
    await assert.rejects(
      () => uploadBase64('data:image/png;base64,AAAA'),
      /returned no downloadUrl/,
    )
  })

  it('dates the 24h expiry from Kie’s uploadedAt, not from now', async () => {
    const stored = await storeUpload({ content: bytes('timed'), filename: 'timed.png' })
    // The fake reports an uploadedAt that leaves `uploadTtlMs` of life left.
    const remaining = stored.expiresAt - Date.now()
    assert.ok(
      Math.abs(remaining - uploadTtlMs) < 5_000,
      `expected about ${uploadTtlMs}ms of life, got ${remaining}ms`,
    )
  })
})

describe('an asset reused inside 24h', () => {
  it('is not re-uploaded', async () => {
    const content = bytes('the same reference image')

    const first = await storeUpload({ content, filename: 'ref.png', mime: 'image/png' })
    const second = await storeUpload({ content, filename: 'ref.png', mime: 'image/png' })

    assert.equal(uploadCalls, 1, 'the second use costs no round trip')
    assert.equal(second.reused, true)
    assert.equal(first.reused, false)
    assert.equal(second.fileUrl, first.fileUrl)
    assert.equal(second.id, first.id)
  })

  it('is keyed on content, not on filename', async () => {
    const content = bytes('identical bytes')
    await storeUpload({ content, filename: 'first-name.png' })
    const again = await storeUpload({ content, filename: 'a-different-name.png' })

    assert.equal(uploadCalls, 1)
    assert.equal(again.reused, true)
  })

  it('uploads a genuinely different file separately', async () => {
    await storeUpload({ content: bytes('image one'), filename: 'one.png' })
    await storeUpload({ content: bytes('image two'), filename: 'two.png' })

    assert.equal(uploadCalls, 2)
    assert.equal((await listInputAssets()).length, 2)
  })

  it('keeps one row per file, not one per use', async () => {
    const content = bytes('reused ten times')
    for (let i = 0; i < 10; i++) await storeUpload({ content, filename: 'ref.png' })

    assert.equal(uploadCalls, 1)
    assert.equal((await listInputAssets()).length, 1)
  })
})

describe('an expired asset', () => {
  it('re-uploads transparently and updates the row in place', async () => {
    const content = bytes('an image whose upload will expire')
    const first = await storeUpload({ content, filename: 'ref.png' })

    // Age the cached upload past its expiry.
    await getDb()
      .update(inputAssets)
      .set({ expiresAt: Date.now() - 60_000 })
      .where(eq(inputAssets.id, first.id))

    const second = await storeUpload({ content, filename: 'ref.png' })

    assert.equal(uploadCalls, 2, 're-uploaded rather than handing back a dead URL')
    assert.equal(second.reused, false)
    assert.notEqual(second.fileUrl, first.fileUrl)
    // In place: the same asset with a fresher URL, not a duplicate.
    assert.equal(second.id, first.id)
    assert.equal((await listInputAssets()).length, 1)
    assert.ok(second.expiresAt > Date.now())
  })

  it('is reported as not live, while staying recoverable', async () => {
    const first = await storeUpload({ content: bytes('x'), filename: 'x.png' })
    await getDb()
      .update(inputAssets)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(inputAssets.id, first.id))

    const [asset] = await listInputAssets()
    assert.equal(asset!.live, false)

    // Not broken: the local copy is kept, so a renew succeeds.
    const renewed = await refreshUpload(first.id)
    assert.ok(renewed)
    assert.equal(renewed.reused, false)
  })

  it('cannot be renewed once the local copy is gone', async () => {
    const first = await storeUpload({ content: bytes('doomed'), filename: 'd.png' })
    fs.rmSync(path.join(process.env.KIE_OUTPUT_DIR!, first.localPath))

    // The one unrecoverable case, and it reports rather than throwing.
    assert.equal(await refreshUpload(first.id), null)
  })

  it('rewrites the local copy if it went missing but the row remains', async () => {
    const content = bytes('recoverable')
    const first = await storeUpload({ content, filename: 'r.png' })
    fs.rmSync(path.join(process.env.KIE_OUTPUT_DIR!, first.localPath))

    // Supplying the bytes again restores the file the re-upload path needs.
    await storeUpload({ content, filename: 'r.png' })
    assert.ok(fs.existsSync(path.join(process.env.KIE_OUTPUT_DIR!, first.localPath)))
  })
})

// ----------------------------------------------------------------- presets

describe('a preset saved before a registry change', () => {
  it('still applies, and reports what it dropped', async () => {
    // Saved when the model had a cfg_scale and allowed 4K.
    const preset = await createPreset({
      name: 'Old favourite',
      modelSlug: model.slug,
      params: { resolution: '4K', n: 4, cfg_scale: 7.5, seed: 99 },
    })

    // The registry has since dropped cfg_scale and narrowed the resolutions.
    const narrowed = {
      ...model,
      params: model.params.map((p) =>
        p.key === 'resolution' ? { ...p, enum: ['1K', '2K'] } : p,
      ),
    }

    const stored = JSON.parse(preset.paramsJson)
    const applied = applyPreset(narrowed, stored)

    // What survives is usable...
    assert.deepEqual(applied.values, { n: 4, seed: 99 })
    // ...and what did not is named, not swallowed.
    assert.equal(applied.clean, false)
    assert.deepEqual(
      applied.dropped.map((d) => d.key).sort(),
      ['cfg_scale', 'resolution'],
    )
    assert.match(
      applied.dropped.find((d) => d.key === 'cfg_scale')!.message,
      /no longer has a "cfg_scale" parameter/,
    )
  })

  it('is never applied across models', async () => {
    await createPreset({
      name: 'Wan preset',
      modelSlug: 'wan/2-7-image',
      params: { resolution: '2K' },
    })

    // Model-scoped: a listing for another model returns nothing.
    assert.equal((await listPresets('kling-2.6/text-to-video')).length, 0)
    assert.equal((await listPresets('wan/2-7-image')).length, 1)
  })

  it('survives a stored parameter set that is now entirely invalid', async () => {
    const preset = await createPreset({
      name: 'Fully stale',
      modelSlug: model.slug,
      params: { gone: 1, alsoGone: 2 },
    })

    const applied = applyPreset(model, JSON.parse(preset.paramsJson))
    assert.deepEqual(applied.values, {})
    assert.equal(applied.dropped.length, 2)
  })
})

// ----------------------------------------------------------------- prompts

describe('the prompt library', () => {
  it('saves, tags and searches', async () => {
    await createPrompt({ title: 'Studio lemon', body: 'a ripe lemon', tags: ['Studio', 'food'] })
    await createPrompt({ title: 'Night street', body: 'a rainy street', tags: ['night'] })

    assert.equal((await listPrompts()).length, 2)
    assert.equal((await listPrompts('lemon')).length, 1)
    assert.equal((await listPrompts('night')).length, 1)
    // Tag search works too.
    assert.equal((await listPrompts('food')).length, 1)
  })

  it('normalizes tags to lowercase and deduplicates them', async () => {
    await createPrompt({ title: 't', body: 'b', tags: ['Studio', 'studio', ' STUDIO '] })
    const tags = await promptTags()
    assert.deepEqual(tags, [{ tag: 'studio', count: 1 }])
  })

  it('deletes', async () => {
    const prompt = await createPrompt({ title: 't', body: 'b', tags: [] })
    assert.equal(await deletePrompt(prompt.id), true)
    assert.equal(await deletePrompt(prompt.id), false)
    assert.equal((await listPrompts()).length, 0)
  })
})

// ----------------------------------------------------------------- credits

describe('credit tracking', () => {
  it('records a balance and reads it back', async () => {
    await recordBalance(1234)
    const summary = await getSpendSummary()
    assert.equal(summary.balance, 1234)
    assert.ok(summary.balanceRecordedAt)
  })

  it('does not log an unchanged balance repeatedly', async () => {
    // The header asks on every page load; a row per request would bury the trend.
    await recordBalance(500)
    await recordBalance(500)
    await recordBalance(500)

    const history = await (await import('./queries.ts')).balanceHistory()
    assert.equal(history.length, 1)
  })

  it('logs a change immediately', async () => {
    await recordBalance(500)
    await recordBalance(400)

    const history = await (await import('./queries.ts')).balanceHistory()
    assert.equal(history.length, 2)
    assert.deepEqual(history.map((h) => h.balance), [500, 400])
  })

  it('reports zero spend on an empty library rather than failing', async () => {
    const summary = await getSpendSummary()
    assert.equal(summary.totalSpent, 0)
    assert.deepEqual(summary.byModel, [])
  })
})

describe('the balance shown in Settings', () => {
  it('asks Kie rather than waiting for something to have written a log row', async () => {
    // The bug this replaced: the card read `credit_log`, nothing in the app ever
    // wrote to it, so it sat on "not fetched yet" forever.
    const reading = await readBalance({ balance: null, recordedAt: null })

    assert.equal(reading.balance, 250)
    assert.equal(reading.live, true)
    assert.equal(reading.error, undefined)
  })

  it('records what it read, so spend gets a history', async () => {
    await readBalance({ balance: null, recordedAt: null })

    const history = await (await import('./queries.ts')).balanceHistory()
    assert.deepEqual(history.map((h) => h.balance), [250])
  })

  it('falls back to the last reading when Kie cannot be reached', async () => {
    creditResponse = { code: 401, msg: 'Unauthorized' }
    const recordedAt = Date.now() - 60_000

    const reading = await readBalance({ balance: 999, recordedAt })

    // Stale beats blank, and the page still renders.
    assert.equal(reading.balance, 999)
    assert.equal(reading.recordedAt, recordedAt)
    assert.equal(reading.live, false)
    assert.match(reading.error ?? '', /KIE_API_KEY/)
  })

  it('says so plainly when there has never been a reading', async () => {
    creditResponse = { code: 500, msg: 'Kie is down' }

    const reading = await readBalance({ balance: null, recordedAt: null })

    assert.equal(reading.balance, null)
    assert.equal(reading.live, false)
    assert.ok(reading.error)
  })
})
