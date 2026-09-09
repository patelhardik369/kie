import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core'

/**
 * Schema for docs/DATA-MODEL.md. Postgres, on Supabase.
 *
 * Invariants, in the order they matter:
 *
 *   1. `inputJson` is stored VERBATIM — exactly what was sent to Kie. It is what
 *      makes a generation reproducible, and it must survive registry changes
 *      that would invalidate a normalized schema.
 *   2. Object storage is the truth; Kie URLs are a cache. Generated media is
 *      deleted upstream after 14 days.
 *   3. Every row a person can see carries a `workspaceId`. There are no accounts,
 *      so this column is the entire ownership model (see lib/auth/workspace.ts).
 *
 * **Timestamps are epoch milliseconds in `bigint`, not `timestamp`.** Two
 * reasons, and the first one is a real bug avoided: pg `integer` is 32-bit and
 * `Date.now()` overflows it, so the obvious port of the SQLite schema would have
 * silently corrupted every date. `bigint` with `mode: 'number'` keeps the column
 * a JS number end to end, which is what every comparison, sort and formatter in
 * the app already expects.
 */

const now = sql`(extract(epoch from now()) * 1000)::bigint`

/** Epoch-milliseconds column. Postgres bigint, JS number. */
const epochMs = (name: string) => bigint(name, { mode: 'number' })

/** Mirrors Kie's five states, plus local states Kie has no concept of. */
export const GENERATION_STATES = [
  'draft',
  'waiting',
  'queuing',
  'generating',
  // local: Kie said success, but the bytes are not in storage yet
  'downloading',
  'complete',
  'failed',
  // local: download failed; the generation is not complete
  'needs_retry',
  // local: poll budget spent — may still be running upstream
  'stalled',
  // local: recordInfo returned 404
  'orphaned',
] as const

export type GenerationState = (typeof GENERATION_STATES)[number]

/**
 * Kept in step with `lib/kie/registry/types.ts` by the registry test, not by an
 * import: the schema module must stay loadable by drizzle-kit without dragging
 * the whole registry in. The column is plain `text` with no CHECK, so adding a
 * family needs no migration — only this list and the registry's.
 */
export const FAMILIES = [
  'kling',
  'bytedance',
  'wan',
  'google',
  'openai',
  'enhance',
] as const
export type Family = (typeof FAMILIES)[number]

/**
 * One row per browser that has ever used the studio.
 *
 * Not a user table — there is nothing in it a person supplied. It exists so
 * storage can be accounted for per workspace and so an abandoned workspace can
 * be found and swept, neither of which a bare id column on every other table
 * would allow.
 */
export const workspaces = pgTable('workspaces', {
  /** The `wk_…` id the browser minted. */
  id: text('id').primaryKey(),
  createdAt: epochMs('created_at').notNull().default(now),
  lastSeenAt: epochMs('last_seen_at').notNull().default(now),
  /** Running total of stored bytes, maintained by lib/storage/quota.ts. */
  storedBytes: epochMs('stored_bytes').notNull().default(0),
  label: text('label'),
})

export const generations = pgTable(
  'generations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
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
    creditsConsumed: doublePrecision('credits_consumed'),
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
    favorite: boolean('favorite').notNull().default(false),
    /**
     * Marked private by the person who made it.
     *
     * Kie reports nothing about the content it returns, and `nsfw_checker`
     * documents its default as OFF on every model that has it — so "filtering
     * was disabled" describes almost every generation and classifies nothing.
     * This flag is therefore a statement of intent, not a detection.
     *
     * It governs visibility only. A marked generation is still a complete,
     * reproducible record — nothing about it is hidden from its own detail page.
     */
    nsfw: boolean('nsfw').notNull().default(false),
    notes: text('notes'),

    // ---- serverless job state -------------------------------------------
    /**
     * The submitter's Kie key, sealed with APP_ENCRYPTION_KEY and bound to this
     * row's id (lib/crypto/seal.ts).
     *
     * Present only while the job is in flight. Wiped the moment the generation
     * reaches a terminal state, because a secret kept past its usefulness is
     * pure liability. Null on a deployment whose key comes from the environment.
     */
    kieKeyEnc: text('kie_key_enc'),
    /**
     * Who is allowed to advance this job right now, and until when.
     *
     * On a long-lived server the runner was a singleton and this was implicit.
     * On Vercel there is no singleton — a cron tick, an inline burst from the
     * submitting request, and an open tab's status poll can all reach the same
     * generation at the same moment, and without a lease all three would poll
     * Kie, all three would download, and the rate limit would be spent three
     * times over. The lease is what makes "advance this job" safe to call from
     * anywhere. See lib/jobs/lease.ts.
     */
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: epochMs('lease_expires_at'),
    /** Earliest time this job should next be looked at. The backoff, persisted. */
    nextPollAt: epochMs('next_poll_at'),

    createdAt: epochMs('created_at').notNull().default(now),
    submittedAt: epochMs('submitted_at'),
    completedAt: epochMs('completed_at'),
  },
  (t) => [
    // Every list view is scoped to one workspace and ordered by recency.
    index('generations_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('generations_state_idx').on(t.state),
    index('generations_created_at_idx').on(t.createdAt),
    index('generations_model_slug_idx').on(t.modelSlug),
    index('generations_parent_id_idx').on(t.parentId),
    index('generations_batch_id_idx').on(t.batchId),
    index('generations_nsfw_idx').on(t.nsfw),
    // The tick's claim query: due, unleased, non-terminal. Hot path, every minute.
    index('generations_due_idx').on(t.state, t.nextPollAt),
  ],
)

/** Where an asset's bytes are. */
export const STORAGE_STATES = [
  /** In the bucket, at `storagePath`. The normal, durable case. */
  'stored',
  /**
   * Larger than the plan's per-object ceiling, so it was never stored. Only
   * `remoteUrl` points at it, and that dies ~14 days after the generation.
   */
  'too_large',
  /** Stored once, since evicted to reclaim quota. `remoteUrl` may also be dead. */
  'evicted',
] as const
export type StorageState = (typeof STORAGE_STATES)[number]

/** Downloaded outputs. One row per file — a generation can produce several. */
export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    generationId: text('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    /** Denormalized from the generation so an asset query needs no join to scope. */
    workspaceId: text('workspace_id').notNull(),
    kind: text('kind').$type<'image' | 'video' | 'audio'>().notNull(),
    /**
     * Object key inside the bucket, e.g.
     * `wk_…/2026-09-09/kling/kling-3.0-omni-text-to-video/<gen>-0.mp4`.
     *
     * Null only when `storageState` is not `stored`. Named `storage_path` rather
     * than keeping the old `local_path`: the value is no longer a filesystem
     * path, and a column whose name lies is how the next person writes
     * `fs.readFile` on it.
     */
    storagePath: text('storage_path'),
    storageState: text('storage_state').$type<StorageState>().notNull().default('stored'),
    /** The original Kie URL. Expires ~14 days after generation. */
    remoteUrl: text('remote_url').notNull(),
    mime: text('mime'),
    bytes: epochMs('bytes'),
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
    downloadedAt: epochMs('downloaded_at').notNull().default(now),
  },
  (t) => [
    index('assets_generation_id_idx').on(t.generationId),
    index('assets_workspace_idx').on(t.workspaceId, t.downloadedAt),
    index('assets_storage_path_idx').on(t.storagePath),
  ],
)

/**
 * Files used as model INPUTS, plus the cached Kie upload URL.
 * Distinct from `assets`, which holds outputs.
 */
export const inputAssets = pgTable(
  'input_assets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** Object key in the bucket. Named to match `assets.storage_path`. */
    storagePath: text('storage_path').notNull(),
    /** Dedupes re-adds of the same file, within a workspace. */
    sha256: text('sha256').notNull(),
    kind: text('kind').$type<'image' | 'video' | 'audio' | 'file'>().notNull(),
    mime: text('mime'),
    bytes: epochMs('bytes'),
    kieFileUrl: text('kie_file_url'),
    /** ~24h after upload. Past this, re-upload in place rather than inserting a duplicate. */
    expiresAt: epochMs('expires_at'),
    label: text('label'),
    createdAt: epochMs('created_at').notNull().default(now),
  },
  (t) => [
    index('input_assets_workspace_sha_idx').on(t.workspaceId, t.sha256),
    index('input_assets_expires_at_idx').on(t.expiresAt),
    index('input_assets_storage_path_idx').on(t.storagePath),
  ],
)

/**
 * Models pinned to the top of the picker.
 *
 * A slug, not a foreign key to anything — the registry is compiled data, not a
 * table, so this holds the only kind of reference there is. A pinned slug that
 * later leaves the registry is reported as missing rather than deleted: the pin
 * is a statement about how you work, and quietly dropping it would lose that
 * without saying so.
 *
 * `position` is explicit rather than derived from `created_at` because the order
 * is editable — the model you reach for most is not the one you pinned first.
 */
export const favoriteModels = pgTable(
  'favorite_models',
  {
    /** `<workspaceId>:<slug>`; the slug alone is no longer unique across browsers. */
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** Verbatim registry slug, e.g. `gpt-image-2-image-to-image`. */
    slug: text('slug').notNull(),
    /** Ascending. Gaps are legal; only the order matters. */
    position: integer('position').notNull().default(0),
    createdAt: epochMs('created_at').notNull().default(now),
  },
  (t) => [index('favorite_models_workspace_position_idx').on(t.workspaceId, t.position)],
)

export const presets = pgTable(
  'presets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    /** Model-scoped — never applied across models. */
    modelSlug: text('model_slug').notNull(),
    /** Partial `input`; missing fields fall back to registry defaults. */
    paramsJson: text('params_json').notNull(),
    /**
     * Whether runs from this preset start marked private.
     *
     * A COLUMN, deliberately not a key inside `paramsJson`. That blob is the
     * model-parameter namespace: `applyPreset` reports anything in it that the
     * registry does not declare as a dropped `unknown_key`, so a flag stored
     * there would be discarded on load and reported as drift every time. The
     * collision risk is real too — several models already declare a field
     * called `nsfw_checker`, which means something entirely different (it asks
     * Kie to filter, where this only decides what the gallery shows).
     */
    nsfw: boolean('nsfw').notNull().default(false),
    createdAt: epochMs('created_at').notNull().default(now),
    updatedAt: epochMs('updated_at').notNull().default(now),
  },
  (t) => [index('presets_workspace_model_idx').on(t.workspaceId, t.modelSlug)],
)

export const prompts = pgTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tagsJson: text('tags_json').notNull().default('[]'),
    createdAt: epochMs('created_at').notNull().default(now),
  },
  (t) => [index('prompts_workspace_idx').on(t.workspaceId, t.createdAt)],
)

/** Account balance over time — Kie's own logs age out after 2 months. */
export const creditLog = pgTable(
  'credit_log',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    balance: doublePrecision('balance').notNull(),
    recordedAt: epochMs('recorded_at').notNull().default(now),
  },
  (t) => [index('credit_log_workspace_idx').on(t.workspaceId, t.recordedAt)],
)

/**
 * Registry snapshot written by /verify-catalog, so drift can be reported
 * without a network call. The compiled registry stays authoritative at runtime.
 *
 * Global, with no workspace: it describes Kie's catalogue, which is the same for
 * everyone.
 */
export const modelsCache = pgTable('models_cache', {
  slug: text('slug').primaryKey(),
  family: text('family').$type<Family>().notNull(),
  capability: text('capability').notNull(),
  paramsJson: text('params_json').notNull(),
  docUrl: text('doc_url').notNull(),
  fetchedAt: epochMs('fetched_at').notNull().default(now),
})

export type Workspace = typeof workspaces.$inferSelect
export type Generation = typeof generations.$inferSelect
export type NewGeneration = typeof generations.$inferInsert
export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
export type InputAsset = typeof inputAssets.$inferSelect
export type Preset = typeof presets.$inferSelect
export type Prompt = typeof prompts.$inferSelect
export type FavoriteModel = typeof favoriteModels.$inferSelect
