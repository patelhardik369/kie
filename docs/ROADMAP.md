# Roadmap

Eight phases. Each has an exit criterion that can be checked, not just claimed. Order is chosen so
the riskiest assumption — that one generated form can serve 97 heterogeneous models — is tested in
Phase 3, before any UI is worth polishing.

---

## Phase 0 — Scaffold

Next.js 16 + TS + Tailwind 4. Drizzle + postgres-js wired, migrations applied by `npm run db:migrate`. `.env`
loading with a startup check that fails loudly on a missing `KIE_API_KEY`.

**Exit:** `npm run dev` serves a page; `data/kie.db` is created with empty tables; a missing key
produces a clear startup error, not a runtime 401.

## Phase 1 — Kie client

`lib/kie/`: typed fetch wrapper, `createTask`, `recordInfo` with `resultJson` parsing, `credits`, the
three upload paths, webhook HMAC verification. Typed errors per status code.

**Exit:** `GET /api/kie/credits` returns the real balance. A hand-written `createTask` call for one
cheap model returns a `taskId`, and polling it reaches `success` with parsed `resultUrls`.

## Phase 2 — Registry

`ModelDefinition` types, then all 97 definitions transcribed from
[`.claude/skills/kie-models/references/`](../.claude/skills/kie-models/references/) — which already
hold the verified parameter tables, so this is transcription, not research. Plus `validate.ts`
covering required fields, enums, ranges, lengths, item counts, and every `Constraint`.

**Exit:** 19 + 20 + 20 + 14 + 8 + 11 + 5 = 97 definitions compile. A test asserts every slug is unique and every
`docUrl` is populated. Validation rejects a Seedance 2.0 payload carrying both `first_frame_url` and
`reference_image_urls`, and accepts either alone.

## Phase 3 — Parameter form (the risky one)

`ParamForm` rendering a `ModelDefinition`, with one control per `ParamType`, constraint enforcement,
and the request preview.

**Exit:** all 97 models render a complete, usable form with **zero model-specific branches in
component code**. Verified against the four hardest cases — `kling-3.0/video` (`kling_elements` +
`multi_prompt`), `kling-3.0-omni/reference-to-video` (three input scenarios), `wan/3-0-video` (seven
input arrays with cross-exclusions), `wan/2-7-image` (`thinking_mode` conflicts, `n` bound depending
on `enable_sequential`). If any needs a special case, `ParamType` is missing a member — extend the
schema layer, not the component.

## Phase 4 — Generate end to end

`POST /api/kie/create`, the job runner with its submission gate and backoff poller, the downloader,
and `generations` / `assets` persistence. Local file upload with the 24h `input_assets` cache.

**Exit:** submitting from the UI produces a file on disk, an `assets` row, and `state: complete`. A
restart mid-generation resumes polling and still completes. A forced `429` backs off instead of
dropping the job. A `fail` state persists `failCode` and `failMsg` verbatim.

## Phase 5 — Gallery, detail, lineage

Grid with filters and search, detail view with full parameter provenance, re-run and tweak with
`parent_id`, batch and sweep.

**Exit:** every generation is findable, its exact parameters are visible, and one click reproduces
it. A sweep of 5 seeds yields 5 rows sharing a `batch_id` and one `parent_id`. Failed generations are
visible as cards, not gaps.

## Phase 6 — Library surfaces

Presets (model-scoped, tolerant of registry drift), prompt library, asset library, the model browser
with its traps surfaced, and credit tracking.

**Exit:** a preset saved before a registry change still applies and reports dropped fields. An asset
reused inside 24h skips re-upload; an expired one re-uploads transparently. The model browser answers
"which model do I want?" without opening `docs.kie.ai`.

## Phase 7 — Hardening

Webhook route behind `KIE_PUBLIC_URL`, path-traversal guard on the asset route, download retry,
`stalled` recovery, disk usage in Settings, `/verify-catalog` run against live docs.

**Exit:** `/smoke-model` passes on at least one model per capability — text-to-video,
image-to-video, reference-to-video, video-to-video, speech-to-video, motion-control, avatar,
text-to-image, image-to-image, layer-decomposition. `/verify-catalog` reports zero drift, or drift
that has been triaged.

### Status — 2026-09-02

| Item | State |
|---|---|
| Webhook route behind `KIE_PUBLIC_URL` | Done. Verified live for all five branches: disabled → 404, bad signature → 401, unknown task → ignored, settled row → ignored, in-flight → wake |
| Path-traversal guard on the asset route | Done. Traversal, encoded traversal and absolute paths all 403; range → 206, bad range → 416, ETag → 304 |
| Download retry | Done — three backoff attempts per URL, `.part` file renamed only after the length check |
| `stalled` recovery | Done — per-generation "Check again", plus `POST api/kie/recover` / "Resume all" in Settings |
| Disk usage in Settings | Done |
| `/verify-catalog` | Zero drift. All 97 registry `docUrl`s match `llms.txt` exactly; 19 Kling / 20 ByteDance / 20 Wan / 14 Google / 8 OpenAI / 11 Qwen / 5 Enhance |

**Smoke tests.** Two of ten capabilities are proven against the live API, submitted through the app's
own route rather than a script:

| Capability | Model | Result |
|---|---|---|
| `text-to-image` | `seedream/5-lite-text-to-image` | complete, 5.5 credits, 1920×1920 PNG on disk |
| `text-to-video` | `wan/2-2-a14b-text-to-video-turbo` | complete, 40 credits, 832×480 5s MP4 on disk |

The other eight all need input media (a source image, a video clip, a speech file) before they can be
fired. Outstanding: `image-to-video`, `reference-to-video`, `video-to-video`, `speech-to-video`,
`motion-control`, `avatar`, `image-to-image`, `layer-decomposition`.

One live finding came out of it, fixed and documented in
[`API-CONTRACT.md` §8](./API-CONTRACT.md): `recordInfo` reports an unknown `taskId` as
`code: 422, msg: "recordInfo is null"`, never a 404 — so an orphaned task used to park as `stalled`
under a message about bad enum values, and "Check again" would have retried it forever.

---

## Sequencing notes

- **Phase 2 before Phase 3** is deliberate: the form is generated from the registry, so the registry
  must be real first. Building the form against three hand-written definitions hides exactly the
  heterogeneity that Phase 3 exists to prove out.
- **Phase 4 before Phase 5.** No gallery is worth building until outputs are durably on disk;
  building it against Kie URLs would bake in the one failure mode this project exists to avoid.
- **Nothing before Phase 1.** Every later assumption rests on the real response shapes, and
  `resultJson`-as-a-string is the kind of thing that invalidates a day of work if discovered late.

## Ongoing

Run `/verify-catalog` periodically. Kie adds and renames models frequently, and a stale registry
fails as a confusing `422` rather than as an obvious absence.
