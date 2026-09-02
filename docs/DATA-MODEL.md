# Data model

SQLite via Drizzle + `@libsql/client`, at `data/kie.db`. Single user, no auth, so no ownership columns.

Two principles shape it:

1. **`input_json` is stored verbatim.** Exactly the object sent to Kie, unnormalized. It is what makes
   every generation reproducible, and it must survive registry changes that would invalidate a
   normalized schema.
2. **Local paths are the truth; Kie URLs are a cache.** Every asset row carries `local_path`.
   `remote_url` is kept for provenance and expires in 14 days.

## Tables

### `generations`

One row per submission.

| column | type | notes |
|---|---|---|
| `id` | text PK | app-generated (uuid/cuid) |
| `kie_task_id` | text unique nullable | null until `createTask` returns; **the idempotency key for webhooks** |
| `model_slug` | text | verbatim, e.g. `kling-3.0-omni/reference-to-video` |
| `family` | text | `kling` / `bytedance` / `wan` |
| `capability` | text | denormalized from the registry for cheap filtering |
| `input_json` | text (JSON) | **verbatim request `input`** |
| `state` | text | see state values below |
| `result_json_raw` | text nullable | the raw `resultJson` string, unparsed, for forensics |
| `credits_consumed` | real nullable | from `recordInfo` |
| `cost_time_ms` | integer nullable | |
| `fail_code` | text nullable | verbatim |
| `fail_msg` | text nullable | verbatim |
| `poll_attempts` | integer default 0 | drives backoff |
| `preset_id` | text nullable FK → `presets.id` | which preset seeded it |
| `parent_id` | text nullable FK → `generations.id` | re-run / variation lineage |
| `batch_id` | text nullable | groups one parameter sweep |
| `favorite` | integer (bool) default 0 | |
| `nsfw` | integer (bool) default 0 | marked private — governs visibility only |
| `notes` | text nullable | |
| `created_at` / `submitted_at` / `completed_at` | integer (epoch ms) | |

**`state`** — `draft`, `waiting`, `queuing`, `generating`, `downloading`, `complete`, `failed`,
`needs_retry`, `stalled`, `orphaned`.

The five middle values mirror Kie's own states. The rest are local: `downloading` and `needs_retry`
exist because Kie's `success` is not our completion; `stalled` is a poll timeout that may still be
running upstream; `orphaned` is a `404` on `recordInfo`.

**`nsfw`** — a statement of intent, not a detection. Kie reports nothing about the content it
returns, and `nsfw_checker` documents its default as *off* on all 37 models that expose it, so
"filtering was disabled" describes nearly every generation and classifies none of them. The flag is
set from the Studio before a run, or toggled afterwards from the gallery, and it is inherited by a
re-run or a tweak, and it locks the generation's files behind a capability token on `/api/assets`.
It changes nothing about the record itself — every parameter, asset and cost stays
exactly as it was, and the detail page shows all of it.

Indexes: `kie_task_id` (unique), `state` (the runner scans non-terminal rows constantly), `nsfw` (every list view filters on it),
`created_at`, `model_slug`, `parent_id`, `batch_id`.

### `assets`

Outputs. One row per downloaded file — a generation can produce several.

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `generation_id` | text FK → `generations.id` cascade | |
| `kind` | text | `image` / `video` / `audio` |
| `local_path` | text | relative to `KIE_OUTPUT_DIR` — **never absolute**, so the folder can move |
| `remote_url` | text | the original Kie URL; expires in 14 days |
| `mime` / `bytes` | text / integer | |
| `width` / `height` / `duration_ms` | integer nullable | probed after download; powers grid layout |
| `index` | integer | ordinal within the generation |
| `layer_meta` | text (JSON) nullable | `z_index`, `name`, `description`, `bounding_box` for `seedream/5-pro-layer-decomposition` |
| `downloaded_at` | integer | |

Index on `generation_id`.

### `input_assets`

Local files used *as inputs*, and the Kie upload URL cached for them. Distinct from `assets`, which
holds outputs.

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `local_path` | text | source file on disk |
| `sha256` | text | dedupes re-adds of the same file |
| `kind` | text | `image` / `video` / `audio` / `file` |
| `mime` / `bytes` | text / integer | |
| `kie_file_url` | text nullable | from the upload API |
| `expires_at` | integer nullable | **~24h after upload** |
| `label` | text nullable | user-facing name in the asset library |
| `created_at` | integer | |

Index on `sha256` and on `expires_at`. A lookup that finds a row whose `expires_at` has passed
re-uploads and updates in place rather than inserting a duplicate.

### `presets`

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `name` | text | |
| `model_slug` | text | **model-scoped** — never applied across models |
| `params_json` | text (JSON) | partial `input`; missing fields fall back to registry defaults |
| `created_at` / `updated_at` | integer | |

Applying a preset whose keys no longer exist in the registry drops them and reports what it dropped —
it must not error, since the registry changes as Kie ships model updates.

### `prompts`

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `title` | text | |
| `body` | text | |
| `tags_json` | text (JSON) | string array |
| `created_at` | integer | |

### `credit_log`

Optional but cheap, and the only way to see spend over time — Kie's own logs age out at 2 months.

| column | type | notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `balance` | real | from `GET /chat/credit` |
| `recorded_at` | integer | |

Per-generation cost lives on `generations.credits_consumed`; this table tracks the account total.

### `models_cache` (optional)

A snapshot of the registry — `slug`, `family`, `capability`, `params_json`, `doc_url`, `fetched_at` —
written by `/verify-catalog`. Lets the app report "this model's schema changed upstream" without a
network call. The compiled registry in `lib/kie/registry/` stays authoritative at runtime.

## Migrations

Drizzle Kit, checked in under `lib/db/migrations/`. Applied on server start so a fresh clone works
with no manual step.

Registry changes are **not** migrations — the registry is TypeScript, and `input_json` is schema-less
on purpose precisely so a model gaining a parameter never requires touching the database.
