import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Schema for docs/DATA-MODEL.md.
 *
 * Two invariants shape it:
 *   1. `inputJson` is stored VERBATIM — exactly what was sent to Kie. It is what
 *      makes a generation reproducible, and it must survive registry changes
 *      that would invalidate a normalized schema.
 *   2. Local paths are the truth; Kie URLs are a cache. Generated media is
 *      deleted upstream after 14 days.
 */

const now = sql`(unixepoch() * 1000)`

/** Mirrors Kie's five states, plus local states Kie has no concept of. */
export const GENERATION_STATES = [
  'draft',
  'waiting',
  'queuing',
  'generating',
  // local: Kie said success, but the bytes are not on disk yet
  'downloading',
  'complete',
  'failed',
  // local: download failed; the generation is not complete
  'needs_retry',
  // local: poll timeout — may still be running upstream
  'stalled',
  // local: recordInfo returned 404
  'orphaned',
] as const

export type GenerationState = (typeof GENERATION_STATES)[number]

export const FAMILIES = ['kling', 'bytedance', 'wan'] as const
export type Family = (typeof FAMILIES)[number]

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey(),
    /** Null until createTask returns. The idempotency key for webhook delivery. */
    kieTaskId: text('kie_task_id').unique(),
    /** Verbatim, e.g. `kling-3.0-omni/reference-to-video`. */
    modelSlug: text('model_slug').notNull(),
    family: text('family').$type<Family>().notNull(),
    /** Denormalized from the registry so filtering does not need a lookup. */
    capability: text('capability').notNull(),
    /** VERBATIM request `input`. Never normalize this. */
    inputJson: text('input_json').notNull(),
    state: text('state').$type<GenerationState>().notNull().default('draft'),
    /** The raw resultJson string, unparsed, kept for forensics. */
    resultJsonRaw: text('result_json_raw'),
    creditsConsumed: real('credits_consumed'),
    costTimeMs: integer('cost_time_ms'),
    /** Verbatim from Kie — never paraphrase a moderation message. */
    failCode: text('fail_code'),
    failMsg: text('fail_msg'),
    pollAttempts: integer('poll_attempts').notNull().default(0),
    presetId: text('preset_id'),
    /** Re-run / variation lineage. Self-referencing. */
    parentId: text('parent_id'),
    /** Groups one parameter sweep. */
    batchId: text('batch_id'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
    createdAt: integer('created_at').notNull().default(now),
    submittedAt: integer('submitted_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [
    // The runner scans non-terminal rows constantly.
    index('generations_state_idx').on(t.state),
    index('generations_created_at_idx').on(t.createdAt),
    index('generations_model_slug_idx').on(t.modelSlug),
    index('generations_parent_id_idx').on(t.parentId),
    index('generations_batch_id_idx').on(t.batchId),
  ],
)

/** Downloaded outputs. One row per file — a generation can produce several. */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    generationId: text('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'image' | 'video' | 'audio'>().notNull(),
    /** Relative to KIE_OUTPUT_DIR — never absolute, so the folder can move. */
    localPath: text('local_path').notNull(),
    /** The original Kie URL. Expires 14 days after generation. */
    remoteUrl: text('remote_url').notNull(),
    mime: text('mime'),
    bytes: integer('bytes'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    /** Ordinal within the generation. */
    idx: integer('idx').notNull().default(0),
    /**
     * z_index / name / description / bounding_box for
     * seedream/5-pro-layer-decomposition. Reading only resultUrls would discard it.
     */
    layerMeta: text('layer_meta'),
    downloadedAt: integer('downloaded_at').notNull().default(now),
  },
  (t) => [index('assets_generation_id_idx').on(t.generationId)],
)

/**
 * Local files used as model INPUTS, plus the cached Kie upload URL.
 * Distinct from `assets`, which holds outputs.
 */
export const inputAssets = sqliteTable(
  'input_assets',
  {
    id: text('id').primaryKey(),
    localPath: text('local_path').notNull(),
    /** Dedupes re-adds of the same file. */
    sha256: text('sha256').notNull(),
    kind: text('kind').$type<'image' | 'video' | 'audio' | 'file'>().notNull(),
    mime: text('mime'),
    bytes: integer('bytes'),
    kieFileUrl: text('kie_file_url'),
    /** ~24h after upload. Past this, re-upload in place rather than inserting a duplicate. */
    expiresAt: integer('expires_at'),
    label: text('label'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('input_assets_sha256_idx').on(t.sha256),
    index('input_assets_expires_at_idx').on(t.expiresAt),
  ],
)

export const presets = sqliteTable(
  'presets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Model-scoped — never applied across models. */
    modelSlug: text('model_slug').notNull(),
    /** Partial `input`; missing fields fall back to registry defaults. */
    paramsJson: text('params_json').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('presets_model_slug_idx').on(t.modelSlug)],
)

export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tagsJson: text('tags_json').notNull().default('[]'),
  createdAt: integer('created_at').notNull().default(now),
})

/** Account balance over time — Kie's own logs age out after 2 months. */
export const creditLog = sqliteTable('credit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  balance: real('balance').notNull(),
  recordedAt: integer('recorded_at').notNull().default(now),
})

/**
 * Registry snapshot written by /verify-catalog, so drift can be reported
 * without a network call. The compiled registry stays authoritative at runtime.
 */
export const modelsCache = sqliteTable('models_cache', {
  slug: text('slug').primaryKey(),
  family: text('family').$type<Family>().notNull(),
  capability: text('capability').notNull(),
  paramsJson: text('params_json').notNull(),
  docUrl: text('doc_url').notNull(),
  fetchedAt: integer('fetched_at').notNull().default(now),
})

export type Generation = typeof generations.$inferSelect
export type NewGeneration = typeof generations.$inferInsert
export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
export type InputAsset = typeof inputAssets.$inferSelect
export type Preset = typeof presets.$inferSelect
export type Prompt = typeof prompts.$inferSelect
