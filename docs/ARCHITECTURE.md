# Architecture

Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind 4, local SQLite via Drizzle + libsql,
outputs on local disk.
Single process, single user, no auth.

## Shape

```
browser ──► Next server routes ──► api.kie.ai
                    │                    ▲
                    │                    │ poll
                    ├──► job runner ─────┘
                    │        │
                    │        └──► downloader ──► KIE_OUTPUT_DIR
                    │
                    └──► SQLite (data/kie.db)
```

The browser never talks to Kie. It talks to our routes; the routes hold the key.

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
    upload/route.ts              local file -> Kie file API -> cached fileUrl
    assets/[...path]/route.ts    serves files out of KIE_OUTPUT_DIR

lib/
  kie/
    client.ts                    fetch wrapper: auth, timeouts, envelope unwrap
    errors.ts                    KieError, code -> kind/retryable   (pure)
    url.ts                       base+path joining                  (pure)
    result.ts                    resultJson parsing, layer metadata (pure)
    polling.ts                   state machine + backoff schedule   (pure)
    tasks.ts                     createTask / recordInfo / waitForTask
    upload.ts                    base64 | stream | url, 24h TTL
    account.ts                   credits, download-url
    webhook.ts                   HMAC verification                  (pure)
    index.ts                     public surface
    registry/
      types.ts                   ModelDefinition, ParamDef, Constraint
      kling.ts  bytedance.ts  wan.ts  google.ts  openai.ts  enhance.ts
      index.ts                   byslug / byFamily / byCapability lookups
    validate.ts                  input -> ParamDef[] + Constraint[] check
  jobs/
    runner.ts                    submission gate + poll loop + recovery
    gate.ts                      sliding submission window          (pure)
    downloader.ts                result URLs -> disk -> assets rows
    uploads.ts                   input files -> Kie fileUrl, 24h cache
    paths.ts                     output path convention             (pure)
    probe.ts                     dimensions/duration from headers   (pure)
    mime.ts                      extension <-> MIME                 (pure)
    submit.ts                    insert generations + hand to the runner
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
    disk.ts                      KIE_OUTPUT_DIR usage
  theme/
    accent.ts                    accent -> interactive ramp, OKLCH       (pure)
  db/
    schema.ts  index.ts  migrations/
  env.ts                         validated server-only config
instrumentation.ts               startup: env, migrations, job recovery

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
retry or rate-limit: that is policy, and only the job runner can see the whole queue. Errors
carry a `retryable` flag for the runner to act on, and `polling.ts` holds the schedule both use.

## Why libsql rather than better-sqlite3

This is plain local SQLite either way. `better-sqlite3` was the original choice, but it compiles
through node-gyp and needs a Visual Studio C++ toolchain on Windows, which this machine does not
have. `@libsql/client` ships prebuilt binaries, installs with no compiler, and speaks the same
SQLite — so the schema and migrations are unchanged. The one consequence is that its API is async,
which is why `runMigrations()` and every query are awaited.

## Startup

`instrumentation.ts` runs once per server start: it validates the environment through `lib/env.ts`
and applies any unapplied migrations, so a fresh clone works with `npm run dev` and nothing else. A
missing `KIE_API_KEY` fails here with a readable message rather than surfacing as a 401 mid-generation.

It then runs the job runner's recovery pass, so every non-terminal generation resumes polling on
start. This is what makes an in-flight generation survive a restart.

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

81 of the 82 models POST to `/api/v1/jobs/createTask` and poll `/api/v1/jobs/recordInfo`. Veo 3.1
predates that API and never moved onto it: it POSTs a **flat** body to `/api/v1/veo/generate` and
polls `/api/v1/veo/record-info`, which reports a numeric `successFlag` instead of a `state` string
and returns `resultUrls` already parsed.

That difference is registry data, not a code branch. The three Veo models carry `transport: 'veo'`;
everything else omits the field and gets `'jobs'`. The dispatch happens in exactly one place —
`lib/kie/tasks.ts`, which routes to `lib/kie/veo.ts` and gets back the same `Task` shape everything
else produces, including a re-encoded `resultJson` **string** so `generations.result_json_raw` holds
one shape for all 82 models.

**The job runner, the downloader, the gallery and the parameter form never learn Veo exists.** The
one visible seam is that polling now passes the generation's `model_slug` through to `getTask` —
a lookup, not a branch, and the slug is already a column on the row being polled. A `model.transport`
check anywhere outside `lib/kie/` means the adapter is leaking; fix the adapter.

Adding a transport is a much larger step than adding a model, and `'veo'` should stay the only one.
Kie's other non-unified APIs — the legacy 4o Image API, Runway, Suno — are out of scope.

## Job runner

One runner per process, started lazily on first import of the server module.

- **Submission gate** — a sliding window keeping submissions under 20 per 10 seconds.
- **Poll loop** — every non-terminal generation, at the backoff schedule in
  [`API-CONTRACT.md`](./API-CONTRACT.md). One poll per task regardless of how many tabs are open.
- **Recovery** — on start, everything non-terminal in `generations` resumes polling. This is why an
  in-flight job survives a restart, and why the DB is authoritative over any client state.
- **Hand-off** — on terminal `success`, the downloader runs before the generation reaches `complete`.
- **Wake** — `notify(id)` aborts a loop's backoff so it polls now. The only thing a webhook is
  allowed to do, and the only reason the runner knows webhooks exist.
- **Balance sampling** — after any terminal task reporting a non-zero `creditsConsumed`, a reading is
  logged to `credit_log`. Fire-and-forget and never awaited: a bookkeeping number that could not be
  fetched must not hold up a download or fail finished work.

`stalled` and `needs_retry` are excluded from startup recovery on purpose: a task Kie has forgotten
would otherwise be re-polled on every restart forever. They move when someone asks — "Check again"
on one generation (`POST api/kie/task/[id]`), or "Resume all" in Settings
(`POST api/kie/recover` → `retryAll()`). Either way the stored `kie_task_id` is reused, so a resume
can never pay for the same generation twice.

Client-side, the Studio and queue poll `api/kie/task/[id]` for display only. The browser drives
nothing.

## Downloader

For each URL in `resultUrls` (and each `layers_data[].url` for layer decomposition): stream to disk,
verify byte count, insert an `assets` row, then advance the generation to `complete`. Failures retry
with backoff and leave the generation in `needs_retry`.

Two details that matter:

- **Atomic writes.** Bytes land in a `.part` file that is renamed only after the length check passes,
  so an interrupted download can never leave a truncated file that looks complete to the gallery.
- **Header probing.** `width` / `height` / `duration_ms` are read straight out of the container
  header (`probe.ts` — PNG, JPEG, GIF, WebP, MP4/MOV), head and tail both, since an MP4 not written
  faststart keeps its `moov` atom at the end. No ffmpeg dependency; anything unreadable stays null.

Path convention (`lib/jobs/paths.ts`):

```
KIE_OUTPUT_DIR/YYYY-MM-DD/<family>/<model-slug-safe>/<generationId>-<n>.<ext>
```

Dated so the folder stays navigable; model-named so files are identifiable outside the app;
generation-id'd so a file always maps back to its parameters.

`KIE_OUTPUT_DIR` defaults to `C:/Users/Hardik/generations/kie-studio` — a **subfolder**, deliberately
kept out of the flat `generations/` directory that the existing `/generate` skill and its
`gallery.html` scan.

## Uploads

Local file → `POST /api/upload` → Kie's file API (stream upload by default; base64 only for small
pasted data) → `fileUrl` returned to the form. The `input_assets` table caches
`local_path → kie_file_url` with `expires_at`, keyed on the file's SHA-256; a reuse inside 24h skips
the round trip, and an expired entry re-uploads in place rather than inserting a duplicate.

A **copy of every uploaded file is kept** under `KIE_OUTPUT_DIR/_inputs/<sha256>`. Without it, an
input whose Kie URL has expired is unrecoverable — the browser that supplied it is long gone — and
re-running the generation becomes impossible.

## Gallery, lineage and sweeps

The gallery is a server component reading SQLite directly — no API route in
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

**Pins are the shortlist above the catalog.** 82 models is a long scroll and most days you want one
of four. `favorite_models` holds the slugs, `lib/models/favorites.ts` resolves them against the
registry, and one client store (`components/models/pins-store.ts`) backs every star, the picker's pin
bar, the home sidebar and the nav popover at once. The API answers every verb with the whole list, so
a write is a replace rather than a patch four surfaces each have to apply correctly. Labels are
resolved server-side, which keeps the 82-model registry out of the browser bundle.

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
| Anything else | `runner.notify(id)` — cuts the backoff short, then `recordInfo` decides the state |

The payload's own view of the task is never read into the state machine. `GET` on the same path
reports only whether callbacks are enabled, which is the one question worth answering while pointing
a tunnel at the app.

## Security

`KIE_API_KEY` is read only in server modules. No `NEXT_PUBLIC_` variant exists, and no route echoes
it. `app/api/assets/[...path]` resolves and normalizes paths against `KIE_OUTPUT_DIR` and rejects
anything escaping it, since it serves files by path.

The same route also gates the files of a generation marked `nsfw`: it looks the path up in `assets`,
and a private one needs `?k=`, an HMAC over the path keyed by a one-way derivation of
`KIE_API_KEY` (`lib/gallery/asset-token.ts`). Failure is 404 rather than 403, so the response does
not confirm the file exists. Every page allowed to render private media mints the token server-side;
the pure `assetHref` helper only appends it, which keeps the client bundle free of the key.
