/**
 * Moves an existing local studio into Supabase.
 *
 *   npm run db:import -- --workspace wk_… [--dry-run]
 *
 * Reads the old `data/kie.db` and the old `KIE_OUTPUT_DIR`, and writes the rows
 * into Postgres and the files into the bucket. Without this, going live would
 * mean abandoning every generation made before the move — and the whole premise
 * of rule 2 in .claude/CLAUDE.md is that those bytes are the durable record.
 *
 * Four things it does deliberately:
 *
 *   - **It asks for the workspace id.** Rows had no owner before; they need one
 *     now. Take it from Settings in the browser you intend to use, so the
 *     imported work lands in the studio you actually look at.
 *   - **It is resumable.** Every write is an upsert keyed on the original id, so
 *     a run interrupted halfway can simply be run again. With ~1 GB of video
 *     over a domestic uplink, that is not a hypothetical.
 *   - **It skips what will not fit.** A file past the per-object ceiling is
 *     reported and left behind rather than failing the import; its row is
 *     recorded as `too_large`, which is exactly what a fresh generation of the
 *     same size would produce.
 *   - **It never deletes the local copy.** The old folder is left untouched, so
 *     a failed import costs time and nothing else.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'
import { createClient as createLibsql } from '@libsql/client'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from '../lib/db/schema.ts'

// ------------------------------------------------------------------ args

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

function valueOf(flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}

/**
 * Validated inside a function rather than by an `if` at module scope, so the
 * narrowing survives into the import functions further down — a module-level
 * const narrowed by a guard reverts to `string | undefined` once it is read
 * inside a nested function body.
 */
function readWorkspaceId(): string {
  const value = valueOf('--workspace')
  if (value && /^wk_[0-9a-f]{32}$/.test(value)) return value

  console.error(
    '\n[kie-studio] --workspace is required and must be a wk_ id.\n\n' +
      '  Open the deployed app → Settings → Your workspace, and copy the id there.\n' +
      '  Everything imported will belong to it.\n\n' +
      '  npm run db:import -- --workspace wk_0123456789abcdef0123456789abcdef\n',
  )
  process.exit(1)
}

const workspaceId = readWorkspaceId()

const sqlitePath = process.env.LEGACY_DATABASE_FILE?.trim() || './data/kie.db'
const outputDir =
  process.env.LEGACY_OUTPUT_DIR?.trim() ||
  process.env.KIE_OUTPUT_DIR?.trim() ||
  'C:/Users/Hardik/generations/kie-studio'

const databaseUrl = required('DATABASE_URL')
const supabaseUrl = required('SUPABASE_URL')
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'kie-outputs'
const maxFileBytes = Number(process.env.MAX_STORAGE_FILE_BYTES) || 50 * 1024 * 1024

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`\n[kie-studio] ${name} is not set.\n`)
    process.exit(1)
  }
  return value
}

// --------------------------------------------------------------- clients

const legacy = createLibsql({ url: `file:${path.resolve(sqlitePath)}` })
const pg = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require', onnotice: () => {} })
const db = drizzle(pg, { schema })
const bucket = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(bucketName)

// ------------------------------------------------------------------ run

const stats = {
  generations: 0,
  assets: 0,
  uploaded: 0,
  skippedTooLarge: 0,
  missingFiles: 0,
  presets: 0,
  prompts: 0,
  pins: 0,
  bytes: 0,
}

console.log(`[kie-studio] reading ${sqlitePath}`)
console.log(`[kie-studio] files from ${outputDir}`)
console.log(`[kie-studio] into workspace ${workspaceId}`)
if (dryRun) console.log('[kie-studio] DRY RUN — nothing will be written\n')

try {
  await importGenerations()
  await importAssets()
  await importLibrary()

  console.log('\n[kie-studio] done.')
  console.table(stats)

  if (stats.skippedTooLarge > 0) {
    console.log(
      `\n  ${stats.skippedTooLarge} file(s) were past the ` +
        `${Math.round(maxFileBytes / (1024 * 1024))} MB per-object ceiling and were not ` +
        'uploaded.\n  Their rows are marked `too_large`; the originals are still in your\n' +
        '  local output folder, which is the only copy of them now.',
    )
  }
  if (stats.missingFiles > 0) {
    console.log(
      `\n  ${stats.missingFiles} asset row(s) pointed at files that are no longer on disk.\n` +
        '  They were imported as `evicted` so the generation and its parameters survive.',
    )
  }
} catch (error) {
  console.error('\n[kie-studio] import failed:\n', error)
  process.exitCode = 1
} finally {
  await pg.end({ timeout: 5 })
  legacy.close()
}

// ------------------------------------------------------------- the steps

async function importGenerations() {
  const { rows } = await legacy.execute('select * from generations order by created_at asc')
  console.log(`[kie-studio] ${rows.length} generation(s)`)

  for (const row of rows) {
    stats.generations += 1
    if (dryRun) continue

    // Typed explicitly, and this is not decoration: without the annotation TS
    // resolves `.values()` to its array overload and reports every field as
    // unknown, which is a confusing way to be told nothing is actually wrong.
    const generation: typeof schema.generations.$inferInsert = {
      id: String(row.id),
      workspaceId,
      kieTaskId: str(row.kie_task_id),
      modelSlug: String(row.model_slug),
      family: String(row.family) as never,
      capability: String(row.capability),
      inputJson: String(row.input_json),
      state: String(row.state) as never,
      resultJsonRaw: str(row.result_json_raw),
      creditsConsumed: num(row.credits_consumed),
      costTimeMs: num(row.cost_time_ms),
      failCode: str(row.fail_code),
      failMsg: str(row.fail_msg),
      pollAttempts: num(row.poll_attempts) ?? 0,
      presetId: str(row.preset_id),
      parentId: str(row.parent_id),
      batchId: str(row.batch_id),
      favorite: Boolean(row.favorite),
      nsfw: Boolean(row.nsfw),
      notes: str(row.notes),
      // Nothing imported is in flight: whatever the old row said, no driver is
      // going to advance a job whose task is months old. A stored key would be
      // meaningless too — these predate the key ever being stored.
      kieKeyEnc: null,
      nextPollAt: null,
      createdAt: num(row.created_at) ?? Date.now(),
      submittedAt: num(row.submitted_at),
      completedAt: num(row.completed_at),
    }

    await db.insert(schema.generations).values(generation).onConflictDoNothing()
  }
}

async function importAssets() {
  const { rows } = await legacy.execute('select * from assets order by generation_id, idx')
  console.log(`[kie-studio] ${rows.length} asset(s) — uploading files, this is the slow part`)

  for (const row of rows) {
    const localPath = String(row.local_path)
    const absolute = path.join(outputDir, localPath)

    let bytes: Uint8Array | null = null
    try {
      bytes = new Uint8Array(await fs.readFile(absolute))
    } catch {
      stats.missingFiles += 1
    }

    let storagePath: string | null = null
    let storageState: 'stored' | 'too_large' | 'evicted' = 'evicted'

    if (bytes && bytes.byteLength > maxFileBytes) {
      stats.skippedTooLarge += 1
      storageState = 'too_large'
      console.log(`  skip ${mb(bytes.byteLength)} MB — ${localPath}`)
    } else if (bytes) {
      // The workspace prefix is what makes the object findable by the app at
      // all: every key it mints or checks begins with one.
      storagePath = `${workspaceId}/${localPath}`
      storageState = 'stored'

      if (!dryRun) {
        const { error } = await bucket.upload(storagePath, bytes, {
          contentType: str(row.mime) ?? 'application/octet-stream',
          upsert: true,
        })
        if (error) throw new Error(`upload ${storagePath}: ${error.message}`)
      }
      stats.uploaded += 1
      stats.bytes += bytes.byteLength
      if (stats.uploaded % 25 === 0) {
        console.log(`  ${stats.uploaded} uploaded (${mb(stats.bytes)} MB)`)
      }
    }

    stats.assets += 1
    if (dryRun) continue

    const asset: typeof schema.assets.$inferInsert = {
      id: String(row.id),
      generationId: String(row.generation_id),
      workspaceId,
      kind: String(row.kind) as never,
      storagePath,
      storageState,
      remoteUrl: String(row.remote_url),
      mime: str(row.mime),
      bytes: num(row.bytes) ?? bytes?.byteLength ?? null,
      width: num(row.width),
      height: num(row.height),
      durationMs: num(row.duration_ms),
      idx: num(row.idx) ?? 0,
      layerMeta: str(row.layer_meta),
      downloadedAt: num(row.downloaded_at) ?? Date.now(),
    }

    await db.insert(schema.assets).values(asset).onConflictDoNothing()
  }
}

/**
 * Presets, prompts and pins.
 *
 * `input_assets` is deliberately NOT imported. Every row in it caches a Kie
 * upload URL that expired within a day of being written, so importing them would
 * copy a library of dead links — and the files they point at are already coming
 * across as part of the generations that produced them.
 */
async function importLibrary() {
  const presets = await legacy.execute('select * from presets')
  for (const row of presets.rows) {
    stats.presets += 1
    if (dryRun) continue
    const preset: typeof schema.presets.$inferInsert = {
      id: String(row.id),
      workspaceId,
      name: String(row.name),
      modelSlug: String(row.model_slug),
      paramsJson: String(row.params_json),
      nsfw: Boolean(row.nsfw),
      createdAt: num(row.created_at) ?? Date.now(),
      updatedAt: num(row.updated_at) ?? Date.now(),
    }
    await db.insert(schema.presets).values(preset).onConflictDoNothing()
  }

  const prompts = await legacy.execute('select * from prompts')
  for (const row of prompts.rows) {
    stats.prompts += 1
    if (dryRun) continue
    const prompt: typeof schema.prompts.$inferInsert = {
      id: String(row.id),
      workspaceId,
      title: String(row.title),
      body: String(row.body),
      tagsJson: String(row.tags_json ?? '[]'),
      createdAt: num(row.created_at) ?? Date.now(),
    }
    await db.insert(schema.prompts).values(prompt).onConflictDoNothing()
  }

  const pins = await legacy.execute('select * from favorite_models order by position')
  for (const row of pins.rows) {
    stats.pins += 1
    if (dryRun) continue
    const pin: typeof schema.favoriteModels.$inferInsert = {
      // The key is now `<workspace>:<slug>`; a bare slug is no longer unique.
      id: `${workspaceId}:${String(row.slug)}`,
      workspaceId,
      slug: String(row.slug),
      position: num(row.position) ?? 0,
      createdAt: num(row.created_at) ?? Date.now(),
    }
    await db.insert(schema.favoriteModels).values(pin).onConflictDoNothing()
  }
}

// ----------------------------------------------------------------- utils

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
