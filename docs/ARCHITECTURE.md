# Architecture

Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind 4, Supabase Postgres via Drizzle +
postgres-js, outputs in Supabase Storage. Deployed on Vercel: serverless, so **nothing may assume a
process outlives a request**.

## Shape

```
                    ┌── X-Kie-Key ──────────────────┐
                    │   X-Studio-Workspace          │
browser ────────────┴──► Next route handlers ───────┴──► api.kie.ai
   │                          │        ▲                     ▲
   │  signed URL              │        │ one step per call   │
   │                          ▼        │                     │
   │                    ┌───────────────────┐                │
   │                    │  jobs/engine.ts   │────────────────┘
   │                    └───────────────────┘
   │                       ▲   ▲        │
   │        ┌──────────────┘   │        └──► downloader ──┐
   │        │                  │                          │
   │   waitUntil(burst)   cron tick                        ▼
   │   on submit          /api/jobs/tick        ┌──────────────────────┐
   │        │                  │                │  Supabase Storage    │
   └────────┴──────────────────┴───────────────►│  (private bucket)    │
                               │                └──────────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │  Supabase Postgres   │  ◄── the only durable state
                    └──────────────────────┘
```

The browser never talks to Kie. It talks to our routes, and **it supplies the key** — the server has
none of its own on a shared deployment. The one thing the browser fetches directly is a signed
Supabase URL for an output, which `/api/assets` hands it as a redirect.

## Layout

```
app/
  page.tsx                       landing: counts + recent generations
  generate/                      model picker
  generate/[...slug]/            the generation screen (SSG, one per model)
  gallery/                       grid + filters, driven by searchParams
  gallery/[id]/                  detail: assets, params, lineage
  models/                        the catalog + the derived traps
  models/[...slug]/              one model: params, constraints, siblings (SSG)
  presets/  prompts/  settings/  the library surfaces
  api/
    kie/create/route.ts          validate -> createTask -> insert
    kie/batch/route.ts           one submission -> N runs, one batch_id
    kie/task/[id]/route.ts       current state for the client; POST resumes
    kie/webhook/route.ts         signed callback (only live with KIE_PUBLIC_URL)
    kie/recover/route.ts         GET = what is parked; POST = resume all of it
    kie/credits/route.ts         balance passthrough
    generations/[id]/route.ts    PATCH favorite / notes / nsfw; DELETE row + files
    presets/  presets/[id]/      save, apply (drift-resolved), rename, delete
    prompts/  prompts/[id]/      the prompt library
    input-assets/                the asset library
    input-assets/[id]/           POST = give me a live fileUrl (re-uploads if stale)
    outputs/route.ts             past outputs as candidate INPUTS, filtered by kind
    outputs/reuse/route.ts       POST assetId -> a fileUrl a model can fetch
    favorite-models/route.ts     pinned models: list / pin / unpin / reorder
    upload/route.ts              a file -> Kie file API -> cached fileUrl
    assets/[...path]/route.ts    ?k=token -> 302 to a signed Supabase URL
    jobs/tick/route.ts           the scheduled driver; bearer CRON_SECRET

lib/
  kie/
    client.ts                    fetch wrapper: auth, timeouts, envelope unwrap
    errors.ts                    KieError, code -> kind/retryable   (pure)
    url.ts                       base+path joining                  (pure)
    result.ts                    resultJson parsing, layer metadata (pure)
    polling.ts                   state machine + backoff schedule   (pure)
    tasks.ts                     createTask / recordInfo / waitForTask
    upload.ts                    bytes | base64 | url, 24h TTL
    account.ts                   credits, download-url
    webhook.ts                   HMAC verification                  (pure)
    index.ts                     public surface
    registry/
      types.ts                   ModelDefinition, ParamDef, Constraint
      kling.ts  bytedance.ts  wan.ts  google.ts  openai.ts  enhance.ts
      index.ts                   byslug / byFamily / byCapability lookups
    validate.ts                  input -> ParamDef[] + Constraint[] check
  auth/
    workspace.ts                 wk_ id from header or cookie; the ownership model
    kie-key.ts                   the caller's key, in an AsyncLocalStorage scope
    route.ts                     withWorkspace / withStudio + one error shape
  crypto/
    seal.ts                      AES-256-GCM for a key held while a job runs
  storage/
    client.ts                    the service-role Supabase client
    objects.ts                   put / sign / read / remove, workspace-prefixed
    quota.ts                     usage, the 1 GB check, eviction candidates
  jobs/
    engine.ts                    ONE step of one generation, under a lease
    lease.ts                     atomic claim, expiry, release, settle
    drive.ts                     burst / driveOne / tick — the three drivers
    gate.ts                      sliding submission window          (pure)
    downloader.ts                result URLs -> bucket -> assets rows
    uploads.ts                   input files -> Kie fileUrl, 24h cache
    paths.ts                     object-key convention              (pure)
    probe.ts                     dimensions/duration from headers   (pure)
    mime.ts                      extension <-> MIME                 (pure)
    submit.ts                    insert generations + seal the key
  gallery/
    filters.ts                   URL <-> GalleryFilter                (pure)
    sweep.ts                     one submission -> N inputs           (pure)
    display.ts                   state labels, asset hrefs, formatting (pure)
    queries.ts                   list / detail / lineage / facets
  presets/
    apply.ts                     drift-tolerant preset application    (pure)
  models/
    traps.ts                     cross-model inconsistencies, derived (pure)
    search.ts                    catalog search                       (pure)
    favorites.ts                 pin resolution + reorder reconciling (pure)
  library/
    queries.ts                   presets / prompts / assets / credits
    pins.ts                      pinned models, always returns the whole list
    outputs.ts                   an output -> an input: list + resolve
  theme/
    accent.ts                    accent -> interactive ramp, OKLCH       (pure)
  client/
    credentials.ts               localStorage key + workspace id      (browser)
    api.ts                       studioFetch + typed ApiError         (browser)
  db/
    schema.ts  index.ts  test-support.ts  migrations/
  env.ts                         validated server-only config
instrumentation.ts               startup: validate the environment, and nothing else

components/
  param-form/
    ParamForm.tsx                renders a ModelDefinition
    controls.tsx                 one control per ParamType
    Field.tsx                    label, describe, errors, constraint reason
    AssetPicker.tsx              reuse a past output or upload as this field's input
    SweepControls.tsx            Generate xN and Sweep
  queue/
    GenerationStatus.tsx         live view of one submitted generation
  gallery/
    GenerationCard.tsx  GalleryFilters.tsx
    ParamProvenance.tsx  Lineage.tsx  GenerationActions.tsx
    UseAsInput.tsx               copies a fetchable URL for one output
  models/
    pins-store.ts                one shared pin list across every star   (client)
    PinStar.tsx  PinnedModels.tsx  PinnedMenu.tsx
  library/
    TrapList.tsx  PresetRow.tsx  PromptLibrary.tsx  AssetLibrary.tsx
  shell/
    TopNav.tsx                   persistent nav, active section from path
    PageHeader.tsx               masthead, back link, section heading
    icons.tsx                    the icon set — 16px grid, 1.5 stroke
  theme/
    AccentScript.tsx             inline <head> script; applies before paint
    AccentPicker.tsx             the Settings control
```

## Pure modules and where policy lives

Half of `lib/kie/` is deliberately pure — no env, no `server-only`, no network. `errors.ts`,
`url.ts`, `result.ts`, `polling.ts` and `webhook.ts` are all directly unit-testable
(`npm test`, Node's built-in runner). Only `client.ts` and the modules built on it touch the key.

The client does auth, timeouts, envelope unwrapping and typed errors. It deliberately does **not**
retry or rate-limit: that is policy, and it belongs to the job engine and its drivers. Errors carry a
`retryable` flag for them to act on, and `polling.ts` holds the schedule both use.

## Connecting to Postgres

Three settings in `lib/db/index.ts` are not preferences — each prevents a specific failure of this
deployment shape:

| Setting | Prevents |
|---|---|
| `prepare: false` | `prepared statement "s1" already exists` — Supavisor's transaction pooler hands a different backend connection to each transaction |
| `max: 1` | Exhausting Supabase Free's connection limit; each invocation is its own process with its own pool |
| `idle_timeout: 20` | A frozen Vercel instance holding a socket open until the server reaps it |

The client is pinned to `globalThis`, because both Turbopack's hot reload and Next's route bundling
can instantiate a module more than once in one process.

## Credentials

Two headers identify a caller, and `lib/auth/route.ts` resolves both in one place so fifteen route
handlers do not each get it slightly wrong.

- **`X-Studio-Workspace`** — a `wk_…` id the browser minted, mirrored into a cookie so server
  components (which render before any of our JavaScript) can read it too. It is the entire ownership
  model. See `lib/auth/workspace.ts`.
- **`X-Kie-Key`** — the caller's own Kie key, put into an AsyncLocalStorage scope by
  `lib/auth/kie-key.ts` and read only by `lib/kie/client.ts`. The scope exists so the key stays out
  of the signature of `createTask`, `getTask`, `getCredits`, `uploadBytes` and everything that calls
  them — none of which has any business inspecting it.

Client-side, `components/setup/StudioBoot.tsx` wraps `fetch` at module scope so every same-origin
`/api` request carries both, and no call site can forget.

## Startup

`instrumentation.ts` validates the environment and logs what it resolved. That is all it does now,
and what it **stopped** doing matters as much:

- **No migrations.** There is no single "server start" — there are many cold starts, concurrently,
  each of which would race the others to apply the same migration. `npm run db:migrate` runs once at
  deploy time, wired into `vercel.json`'s build command.
- **No recovery sweep.** There is no process to resume jobs into. Recovery is continuous instead:
  every generation carries its own `next_poll_at`, and the tick picks up whatever is due — including
  anything a crashed invocation abandoned, whose lease simply ages out. Strictly better than a sweep
  that only ran if somebody restarted the process.

## The registry is the center of the app

`ModelDefinition[]` is the only place a model is described. The form, the validator, the model
browser, and the request builder all read from it. Adding the 60th model means adding one object —
no new route, no new component, no new branch.

The corollary: **if a model can't be expressed as a `ModelDefinition`, extend `ParamType` rather
than special-casing the UI.** A special case for one model becomes a special case for twenty. Wan 2.7
Image already forced two additions this way — `color[]` for its `color_palette` and `bbox[]` for its
`bbox_list`.

**The registry is client-importable, and must stay that way.** `lib/kie/registry/` and
`lib/kie/validate.ts` are pure: no `server-only`, no env, no network. The parameter form is a client
component and imports them directly. They are deliberately *not* re-exported from `lib/kie/index.ts`,
because that barrel pulls in `client.ts` and would drag `server-only` — and the API key path — into
the browser bundle. Import `@/lib/kie/registry` and `@/lib/kie/validate` by their own paths.

Schema and the transcription rules: [`.claude/skills/kie-models/SKILL.md`](../.claude/skills/kie-models/SKILL.md).

### Transports

96 of the 97 models POST to `/api/v1/jobs/createTask` and poll `/api/v1/jobs/recordInfo`. Veo 3.1
predates that API and never moved onto it: it POSTs a **flat** body to `/api/v1/veo/generate` and
polls `/api/v1/veo/record-info`, which reports a numeric `successFlag` instead of a `state` string
and returns `resultUrls` already parsed.

That difference is registry data, not a code branch. The three Veo models carry `transport: 'veo'`;
everything else omits the field and gets `'jobs'`. The dispatch happens in exactly one place —
`lib/kie/tasks.ts`, which routes to `lib/kie/veo.ts` and gets back the same `Task` shape everything
else produces, including a re-encoded `resultJson` **string** so `generations.result_json_raw` holds
one shape for all 97 models.

**The job engine, the downloader, the gallery and the parameter form never learn Veo exists.** The
one visible seam is that polling now passes the generation's `model_slug` through to `getTask` —
a lookup, not a branch, and the slug is already a column on the row being polled. A `model.transport`
check anywhere outside `lib/kie/` means the adapter is leaking; fix the adapter.

Adding a transport is a much larger step than adding a model, and `'veo'` should stay the only one.
Kie's other non-unified APIs — the legacy 4o Image API, Runway, Suno — are out of scope.

## Job engine

The old design held a `for(;;)` loop per job, sleeping between polls. That worked because the process
outlived the job. It cannot here: the invocation ends when the response is sent, taking every pending
timer with it. **So the loop is turned inside out.**

`lib/jobs/engine.ts` does **at most one thing per call** — submit, or poll once, or store — writes
what it learned, and records when to come back. The database holds the position that a `for`
statement used to.

### Three drivers, one step

| Driver | Where | Covers |
|---|---|---|
| `burst` | `waitUntil` on the submitting request | Fast image models, often start to finish |
| `driveOne` | An open tab's status poll | Whatever you are looking at |
| `tick` | `POST /api/jobs/tick`, on a schedule | **Everything else** — the safety net |

None of them knows the others exist. All are safe because a step only runs under a lease.

### Leases (`lib/jobs/lease.ts`)

A generation can be reached by all three at once. Without coordination all three would call
`recordInfo` on the same task, all three would download the same result, and the rate limit would be
spent three times over for one generation.

The claim is a single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, which gives two
properties:

1. **Atomic.** Two ticks in the same second claim disjoint sets rather than racing.
2. **Self-healing.** The lease carries an expiry, not a lock. A worker killed mid-step — ordinary on
   a serverless host, not exceptional — leaves a lease that ages out, and the next tick picks the job
   up. Nothing has to *notice* the crash for the job to recover.

### Recovering what stopped short

`stalled` and `needs_retry` are excluded from the tick's sweep on purpose: a task Kie has forgotten
would otherwise be re-polled forever. They move when someone asks — "Check again" on one generation
(`POST /api/kie/task/[id]`) or "Resume all" in Settings (`POST /api/kie/recover`). Either way the
stored `kie_task_id` is reused, so a resume can never pay for the same generation twice, and the key
from the asking browser is re-sealed onto the row — which is how a job recovers after an
`APP_ENCRYPTION_KEY` rotation left its stored key unreadable.

### Balance sampling

After any terminal task reporting non-zero `creditsConsumed`, a reading is logged to `credit_log`.
Fire-and-forget and never awaited: a bookkeeping number that could not be fetched must not hold up a
download or fail finished work.

## Downloader

For each URL in `resultUrls` (and each `layers_data[].url` for layer decomposition): fetch fully into
memory, verify the byte count, upload to the bucket, insert an `assets` row, then advance the
generation to `complete`. Failures retry with backoff and leave the generation in `needs_retry`.

Three details that matter:

- **Buffered, not streamed.** The `.part`-then-rename trick that guarded against truncation has no
  equivalent in an object store, so its job is done by holding the whole response, checking the
  length, and only then uploading — a truncated transfer never becomes an object at all. Which is
  stricter than the rename was. Memory is bounded by the per-object ceiling.
- **Header probing.** `width` / `height` / `duration_ms` are read straight out of the container
  header (`probe.ts` — PNG, JPEG, GIF, WebP, MP4/MOV), head and tail both, since an MP4 not written
  faststart keeps its `moov` atom at the end. No ffmpeg dependency; anything unreadable stays null.
- **Oversize is not failure.** An output past `MAX_STORAGE_FILE_BYTES` (50 MB on Supabase Free) is
  recorded `storage_state = 'too_large'` with `storage_path` null and its Kie URL kept. The run
  happened and was billed; refusing to record it would lose the parameters as well as the file. The
  gallery says so plainly, with a download link and the fourteen-day expiry.

Key convention (`lib/jobs/paths.ts`):

```
<workspaceId>/YYYY-MM-DD/<family>/<model-slug-safe>/<generationId>-<n>.<ext>
```

**Workspace-first**, because that prefix is the only thing separating one browser's objects from
another's in a bucket the server opens with a key that can read all of it. Dated so the bucket stays
navigable in the Supabase dashboard; model-named so a file is identifiable once downloaded;
generation-id'd so a file always maps back to its parameters. The date segment is UTC, not local: a
key that depended on the server's timezone would file one afternoon's work under two days.

## Serving an asset

`/api/assets/<key>?k=<token>` **redirects** to a signed Supabase URL; it does not proxy. Pulling a
40 MB video through a serverless function would spend the whole memory and duration budget delivering
something the CDN already serves — with byte ranges, which video scrubbing needs and a naive proxy
loses.

Authorisation is the `?k=` token and nothing else, because nothing else can reach that route:
`<img src>` and `<video src>` send no custom headers, so a workspace header would be checkable in
`fetch` and absent in exactly the two cases that matter. The token is an HMAC of the object key,
minted only by code that has already established the caller owns the row.

## Uploads

Local file → `POST /api/upload` → Kie's file API (multipart by default; base64 only for small pasted
data) → `fileUrl` returned to the form. The `input_assets` table caches
`storage_path → kie_file_url` with `expires_at`, keyed on `(workspace_id, sha256)`; a reuse inside
24h skips the round trip, and an expired entry re-uploads in place rather than inserting a duplicate.

### The 4.5 MB wall, and why big files never touch a function

A serverless platform caps a function's **request body** — 4.5 MB on Vercel — and enforces it at the
edge, before the route runs. Nothing in `app/api/upload` ever sees such a request; the browser gets a
plain-text `Request Entity Too Large` where it expected JSON. There is no server-side fix, because
there is no server-side code in the failure. A phone photograph clears that cap on its own, and a
marked-up screenshot flattened to PNG clears it routinely.

So anything over the threshold goes to the bucket directly and only its KEY travels through a
function. `lib/client/upload.ts` is the only uploader in the browser and picks the path by size.

| size | path |
|---|---|
| ≤ 3.5 MB | `POST /api/upload` (multipart) — one round trip, unchanged |
| > 3.5 MB | `POST /api/upload/ticket` → `PUT` straight to Supabase → `POST /api/upload` with `{ storageKey, sha256 }` |

The ticket route keeps three things on the server that a plain signed URL would give away: the
**key** (built from the workspace prefix and the content hash, never named by the caller), the
**ceilings** (refused before 40 MB moves rather than after), and the **quota** (checked before the
bytes move, which is the rule the whole storage design turns on). The finalize call re-hashes the
object it reads back — a content-addressed key whose bytes say something else would poison every
later dedupe against that hash — and answers a live cache hit without reading the object at all.

The dedupe key gained the workspace deliberately: two people uploading the same stock image must not
share a row, or deleting it on one side breaks the other.

A **copy of every uploaded file is kept** at `<workspaceId>/_inputs/<sha256>`. Without it, an input
whose Kie URL has expired is unrecoverable — the browser that supplied it is long gone — and
re-running the generation becomes impossible.

An output reused as an input is the exception: it is registered against the **output's own key**, so
no second copy is made. On a 1 GB plan that is the difference between reusing a video costing nothing
and costing another 30 MB.

## Serving images: never the original for a thumbnail

Outputs are full-resolution PNGs — 2-6 MB each, one upscale at 29.6 MB — and the
gallery draws them in 216px tiles. Measured on a real workspace, a gallery page
fetched **23.75 MB to paint ten tiles**, the largest a 5.8 MB PNG in a 216-pixel
square. That, not the network, was what made the app feel slow.

Supabase Storage resizes at the origin, and it works on the Free plan. Same
image, 1536px output PNG:

| served as | bytes | note |
|---|---|---|
| original | 2591 KB | what the tile used to fetch |
| 432px PNG | 338 KB | |
| **432px WebP** | **35 KB** | chosen from the browser's own `Accept` |

So `/api/assets/<key>?k=<token>&w=<width>` signs a resize transform and redirects
to it, and `/api/annotate/source?url=…&w=<width>` does the same for an input
image the workspace holds. Whole gallery page: **23.75 MB → 0.40 MB, 59x.** A
40px row thumbnail: **4759 KB → 5 KB.**

Two rules make this safe to leave on:

| rule | why |
|---|---|
| Widths snap to `THUMB_WIDTHS` (96/240/432/864) | The width rides in an editable URL, and an unconstrained number mints unbounded distinct renders — each cached and metered separately |
| No `w` means the original, untouched | The full-size view, every download, and anything a model reads must get the real file; a resized copy of a generation is not what the model produced |

Video and audio are never sized — the renderer is for stills, and asking it to
resize an mp4 turns a working URL into a broken one.

### What is left, and it is not the app

The project's Supabase lives in `ap-northeast-1`. From the author's connection
that is a **204 ms** round trip, against 12-15 ms to a nearby anycast edge, so
every request pays a fifth of a second before any byte moves — a sized thumbnail
still takes ~1.5s cold because it costs three Tokyo round trips (row lookup,
sign, render). Bandwidth is not the constraint: 28 Mbit/s measured, and the
transfers already saturate it. Moving the project region is the only lever left,
and it is a migration, not a setting.

## Image markup

Drawing on an input image so the model knows which part of it to change. `components/annotate/`,
with the geometry in `lib/annotate/doc.ts` and the field gate in `lib/annotate/targets.ts`.

> **No in-scope endpoint accepts a mask.** Verified 2026-09-13 against the registry, the reference
> tables under `.claude/skills/kie-models/references/`, and the live doc page for
> `gpt-image-2-5-flare-image-to-image`, whose entire input is `prompt`, `input_urls`, `aspect_ratio`
> and `resolution`. **Do not add a `mask` / `mask_url` parameter to make this "proper"** — it would
> be invented, which breaks the first non-negotiable. The marks are burned into the pixels and named
> in the prompt, which is what the model vendors document and what works across all 52 qualifying
> models rather than one.

| step | what |
|---|---|
| Open | `GET /api/annotate/context?url=` says what to draw on, whether marks already exist, and whether a clean original can be paired |
| Load | `GET /api/annotate/source` streams the bytes **from our own origin** |
| Draw | Vector shapes in normalized 0–1 coordinates, so one document renders at any scale |
| Zoom | The displayed size is the only thing that changes; `renderTo`, `hitTest` and the flatten all already take it as an argument, so there is no second coordinate space to keep in step |
| Save | Flattened at the image's natural size, uploaded through `lib/client/upload.ts` with an `annotation` field, which writes `input_assets.annotation_json` |

### Why `/api/annotate/source` proxies where `/api/assets` redirects

`toDataURL()` throws on a canvas any cross-origin image has touched, and both possible sources are
cross-origin: a Kie `downloadUrl`, and the Supabase signed URL that `/api/assets` 302s to. So this
route streams the bytes instead. The reason `/api/assets` redirects — keeping 40 MB videos out of a
function — does not apply to one image fetched once per editor session, and no CORS configuration on
a third party's host has to stay put for it to keep working.

It resolves the URL against this workspace's own `input_assets` / `assets` rows first, so the common
case never leaves the building. The fallback, for a hand-pasted URL, is a server-side fetch of a
client-supplied URL — SSRF by construction — and is fenced by `lib/annotate/source-guard.ts`: https
only, public addresses only (including v4-mapped v6 forms), `image/*` but never SVG, size-capped, and
redirects re-validated at each hop rather than followed. The residual DNS-rebinding window is
documented at the call site.

## Gallery, lineage and sweeps

The gallery is a server component reading Postgres directly — no API route in
between, because there is no second consumer.

**Filter state lives in the URL, and only in the URL.** `lib/gallery/filters.ts`
parses `searchParams` into a `GalleryFilter` and serializes it back, so the grid
is always a function of the address bar: linkable, reloadable, and correct under
the back button. Values that are not in the registry or the state list are
dropped rather than passed through, so a hand-edited `?state=xyz` shows
everything instead of an empty grid that reads as data loss.

**A generation with no assets is still a row.** Failures, stalls and in-flight
runs join to zero assets, so the list query fetches assets in a second keyed
query rather than joining — a join would drop exactly the rows worth seeing, and
would also multiply the page count by the asset count.

**Lineage is one hop each way.** `parent_id` records what a run was re-run or
tweaked from; `batch_id` groups the runs of one sweep. The detail view answers
"what did I change from, and what did I try next" — a full ancestry walk would be
a graph nobody reads. Where several rows are shown together, the list surfaces
the keys whose values *differ* rather than repeating the prompt five times; for a
seed sweep that is the whole point of the comparison.

**A sweep is validated before it is written.** `expandSweep` produces N complete
input objects (never patches, so each row is independently reproducible), every
one is checked against the ModelDefinition, and only then are the rows inserted
in a single statement. Discovering on run 4 of 5 that a value is out of range —
after paying for three — is the failure this ordering exists to prevent.

## The library surfaces

**Presets are model-scoped and drift-tolerant.** Kie renames parameters and narrows enums between
model revisions, so `lib/presets/apply.ts` filters a stored parameter set against the current
registry and returns what still applies *plus* what did not, with a reason for each. It never throws
and never silently swallows — the alternative is a preset that applies cleanly and then fails at
submit with a `422`. Validity is judged by running the real validator over a single-key payload, so
a preset can never be considered valid by a standard the submit path disagrees with.

Asset URLs are excluded from presets on save: a Kie upload dies after about a day, and a preset
carrying one would be broken by definition.

**The traps are derived, not curated.** `lib/models/traps.ts` reads the registry and computes where
models disagree — the same parameter with a different wire type, the same name accepting different
values, the same idea spelled two ways. That is what keeps the model browser honest as the catalog
grows: adding the 60th model surfaces its inconsistencies automatically. It reports the *wire* type
rather than the `ParamType`, because an enum of strings and a free-text string are both `string` to
the API and flagging them would bury the string-versus-number difference that actually causes a 422.
The one curated part is a small synonym list, and even that only reports keys genuinely present.

Model `notes` are surfaced verbatim alongside, for the quirks nothing can derive — that Seedream 5
Pro's `high` is 2K while 5 Lite's is 4K is written down precisely because it is not computable.

**The asset library is the 24-hour cache made visible.** `input_assets` maps a file's SHA-256 to its
Kie upload URL and expiry. Reuse inside the window costs no round trip; past it, the **local copy**
is re-uploaded and the row updated in place. That local copy is the whole design: without it an
expired asset is unrecoverable, because the browser that supplied it is long gone.

**An output is an input.** The studio's natural loop is make an image, animate it, upscale that, and
each hop needs a URL Kie can fetch. `lib/library/outputs.ts` hands the output's own local path to
`storeUpload` — no second copy on disk, content-hashed so the same output feeding ten generations is
uploaded once. It is reachable two ways: the **Reuse** picker on every asset field, and **Use as
input** on a gallery asset, which copies the URL.

Kie's own `assets.remote_url` is deliberately not that URL. It dies after about fourteen days, and
an `input_json` holding a dead URL is not reproducible — which is the one thing `input_json` exists
for. It is used only as the fallback for a file past Kie's 100 MB upload ceiling, and that case
returns a `warning` saying so rather than taking it silently.

**Pins are the shortlist above the catalog.** 97 models is a long scroll and most days you want one
of four. `favorite_models` holds the slugs, `lib/models/favorites.ts` resolves them against the
registry, and one client store (`components/models/pins-store.ts`) backs every star, the picker's pin
bar, the home sidebar and the nav popover at once. The API answers every verb with the whole list, so
a write is a replace rather than a patch four surfaces each have to apply correctly. Labels are
resolved server-side, which keeps the 97-model registry out of the browser bundle.

## Why polling leads

Kie can't POST to `localhost`, so on the primary deployment target the webhook is dead. Building
poll-first means the app works out of the box; the webhook is a latency optimization that turns on
when `KIE_PUBLIC_URL` is set, and never becomes something correctness depends on. See
[`API-CONTRACT.md` §7](./API-CONTRACT.md).

`api/kie/webhook` is the whole of that optimization, and it is deliberately tiny:

| Step | Behaviour |
|---|---|
| No `KIE_PUBLIC_URL` | `404` — the endpoint does not exist in this configuration |
| Bad signature or stale timestamp | `401`, logged, nothing touched |
| Unknown `task_id` | `200 ignored` — acknowledged so Kie stops resending |
| Generation already settled | `200 ignored` — a duplicate delivery is a no-op, never a second download |
| Anything else | `waitUntil(driveOne(id))` — runs a step early, and `recordInfo` decides the state |

The payload's own view of the task is never read into the state machine. `GET` on the same path
reports only whether callbacks are enabled, which is the one question worth answering while pointing
a tunnel at the app.

## Security

### Keys

No `NEXT_PUBLIC_` variant of anything exists, and no route echoes a key. A caller's Kie key lives in
their browser, travels as `X-Kie-Key`, and is read only by `lib/kie/client.ts` through the
AsyncLocalStorage scope.

The one place it is stored server-side is sealed and short-lived: on submit it is encrypted with
`APP_ENCRYPTION_KEY` (AES-256-GCM, bound to the generation id as AAD) and parked on the row, so a
tick can finish the job after the tab closes. `settle()` wipes it the moment the generation reaches a
terminal state. Stated plainly: someone holding **both** the database and the environment can unseal
the keys of jobs *currently in flight*. That is the honest limit of the design, and the reason the
ciphertext is deleted rather than kept.

### Isolation

Every row carries a `workspace_id`, and **application code is the only thing enforcing it** — the
`service_role` connection bypasses RLS entirely, so a query that forgets the filter returns someone
else's work rather than erroring. Two things keep that honest: every query function takes
`workspaceId` as a leading required parameter, so forgetting is a type error; and
`lib/gallery/queries.test.ts` has a `workspace isolation` suite that asserts the property directly.

A workspace id is a **bearer secret**, not authentication. It partitions data between browsers; it
does not defend against database access.

### Assets

`app/api/assets/[...path]` takes an object key and redirects to a signed URL. Authorisation is `?k=`,
an HMAC over the key derived from `APP_ENCRYPTION_KEY` (`lib/gallery/asset-token.ts`), and it is
required for **every** asset rather than only private ones — on a public URL every key is guessable.

It cannot be a header: `<img src>` and `<video src>` send none, and those are the only two ways an
asset is actually fetched. Failure is 404 rather than 403, so the response does not confirm the
object exists. Pages mint the token server-side; the pure `assetHref` helper only appends it, keeping
the signing key out of the client bundle.

The token was previously derived from `KIE_API_KEY`, which stopped making sense the moment each
browser brought its own — the same file would have minted a different token per visitor.
