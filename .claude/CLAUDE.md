# Kie Studio

A deployed, bring-your-own-key Higgsfield-style generation studio built on the **Kie AI** API.

The defining product promise: **every parameter of every supported model is reachable in the UI.**
Hosted tools hide parameters behind presets. This app does the opposite — presets are a convenience
layer *on top of* full manual control, never a replacement for it.

## Scope boundary — six families

| Family | Video | Image | Audio | Total |
|---|---|---|---|---|
| **Kling** | 19 | — | — | 19 |
| **ByteDance** (Seedance video / Seedream image) | 10 | 10 | — | 20 |
| **Wan** | 18 | 2 | — | 20 |
| **Google** (Veo, Gemini Omni, Imagen 4, Nano Banana, Gemini TTS) | 5 | 8 | 1 | 14 |
| **OpenAI** (GPT Image 1.5 / 2) | — | 4 | — | 4 |
| **Enhance** (Topaz, Recraft, Grok Imagine upscale) | 2 | 3 | — | 5 |
| | **54** | **27** | **1** | **82** |

`enhance` is a capability family, not a vendor: it holds every upscaler and background remover
regardless of who makes it. That is why `grok-imagine/upscale` lives there while the rest of Grok
stays out of scope.

Plus utility endpoints: 3 file-upload variants, credits, download-URL, webhook verification.

### Still out of scope

**Do not add Runway, Hailuo, PixVerse, MiniMax, Sora, Flux, Qwen, Ideogram, Midjourney, Suno,
ElevenLabs, OmniHuman, InfiniteTalk, HappyHorse, Z-Image, or the rest of Grok Imagine.** Kie offers
them; this project deliberately does not. If a task seems to need one, stop and ask.

**No chat/text models, ever** — Kie serves Gemini 2.5/3.x, GPT-5.x, Codex, and Claude as chat
completions. A text completion has no output file, no `assets` row, and no gallery entry, so it has
no home in this app. The Google and OpenAI families here are image / video / audio generation only.

Two endpoints are documented under Gemini Omni but are **not** models and must not be registered:
`POST /api/v1/omni/audio/create` and `POST /api/v1/omni/character/create`. They synchronously mint a
reusable voice or character id for `audio_ids` / `character_ids`. If they are ever built, they belong
in the asset library, not the registry.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind 4
- **Drizzle + postgres-js** against **Supabase Postgres**, through the transaction pooler
- Outputs in **Supabase Storage**, a private bucket, served as short-lived signed URLs
- Deployed on **Vercel** — serverless, so nothing may assume a process outlives a request
- No accounts and no billing. Each browser brings its own Kie key and owns an
  anonymous `workspace_id`; see docs/DEPLOYMENT.md.

### Free-tier ceilings that shape the design

| Limit | Value | Consequence |
|---|---|---|
| Storage, total | 1 GB | Quota checked BEFORE submitting, never after |
| Storage, per object | 50 MB | A larger output is recorded `too_large`, not failed |
| Postgres | 500 MB | `input_json` is text; nothing else is large |

Neither storage limit is raisable on Supabase Free. Treat both as facts, not settings.

## Non-negotiables

1. **Never invent a model parameter.** Every field, enum value, default, and limit is transcribed from
   its `docs.kie.ai` page. If you cannot cite the doc page, the parameter does not go in. Use the
   `kie-models` skill and the `kie-model-scout` agent.
2. **Store every output immediately.** Kie result URLs and uploaded-file URLs expire (~24h for
   uploads, ~14 days for results). A generation is not "done" until its bytes are in the bucket and
   the `assets` row exists. This is the single most important durability rule in the codebase. The
   one sanctioned exception is an output past the 50 MB per-object ceiling: it is recorded as
   `too_large` with its Kie URL kept and the expiry stated out loud — never silently dropped, and
   never reported as a failure.
3. **API keys belong to the browser.** There is no server-wide key on a shared deployment. A key
   arrives as `X-Kie-Key`, is put in an AsyncLocalStorage scope by `lib/auth/kie-key.ts`, and is
   read only by `lib/kie/client.ts`. It is never logged, never echoed in a response, and never
   `NEXT_PUBLIC_`. The one sanctioned exception is rule 9.
4. **Every row is scoped to a `workspace_id`, in application code.** The `service_role` connection
   bypasses RLS entirely, so a query that forgets the filter does not error — it returns someone
   else's work. Every query function takes `workspaceId` as a leading REQUIRED parameter so
   forgetting is a type error.
5. **Ticks lead, webhooks follow.** There is no long-lived poller any more. `lib/jobs/engine.ts`
   advances a generation by exactly ONE step per call, under a database lease, and three drivers
   call it: the inline burst on submit, an open tab's status poll, and the scheduled tick. The
   webhook only ever brings the next step forward; it is never authoritative.
6. **Store `input_json` verbatim.** Every generation must be exactly reproducible and re-runnable from
   its stored parameters.
7. **The registry is data, not code branches.** Adding a model means adding a `ModelDefinition`, not
   writing a new form or a new route. If a model forces you to special-case the UI, the schema layer is
   missing a field type — extend the schema layer instead.
8. **A transport is registry data too.** 81 of the 82 models POST to `/api/v1/jobs/createTask`; Veo
   posts to `/api/v1/veo/generate` and polls `/api/v1/veo/record-info` with a different response
   shape. That difference is declared as `transport: 'veo'` on the `ModelDefinition` and absorbed by
   an adapter in `lib/kie/veo.ts` that returns the same `Task` shape. **The job engine, the gallery,
   and the downloader must never learn that Veo exists.**
9. **A submitter's key may be stored, sealed, only while their job runs.** `lib/crypto/seal.ts`
   encrypts it with `APP_ENCRYPTION_KEY`, bound to the generation id, so a tick can finish a job
   after the tab has closed. `settle()` wipes it the moment the generation reaches a terminal state.
   A sealed key outliving its job is a bug, not an optimisation.
10. **Nothing may assume a process outlives a request.** No module-level timers, no in-memory queues,
   no `setInterval`, no state that matters held outside Postgres. Work that must continue past a
   response goes in `waitUntil`, and its position is written to the database first.

## Where things live

| Path | What |
|---|---|
| `.claude/skills/kie-api/SKILL.md` | API contract, both transports — load before touching `lib/kie/` |
| `.claude/skills/kie-models/SKILL.md` | Registry conventions + `ModelDefinition` shape |
| `.claude/skills/kie-models/references/{kling,bytedance,wan,google,openai,enhance,utility}.md` | **Authoritative** parameter tables |
| `.claude/agents/kie-model-scout.md` | Subagent that transcribes a doc page into a registry entry |
| `.claude/commands/` | `/add-model`, `/verify-catalog`, `/smoke-model` |
| `docs/DEPLOYMENT.md` | **Env vars, Supabase setup, scheduling the tick, migrating a local studio** |
| `docs/PRD.md` | Product requirements + acceptance criteria |
| `docs/MODEL-CATALOG.md` | Human-readable model index |
| `docs/API-CONTRACT.md` | Request lifecycle, state machine, error mapping |
| `docs/ARCHITECTURE.md` | Route map, job engine, storage |
| `docs/DATA-MODEL.md` | Drizzle schema |
| `docs/UX-SPEC.md` | Screens + parameter-control mapping |
| `docs/ROADMAP.md` | Phased build order |

## Docs gotcha

Fetch model docs from `https://docs.kie.ai/market/<family>/<slug>.md` — the trailing `.md` returns clean
markdown. Veo is the exception and lives outside `/market`, at
`https://docs.kie.ai/veo3-api/generate-veo-3-video.md`. The HTML catalog page at `kie.ai/market`
returns **403** to fetchers; never rely on it. `https://docs.kie.ai/llms.txt` is the full page index
and the source of truth for what models exist.

Doc-page paths do not predict slugs. `market/google/nanobanana2.md` serves `nano-banana-2`,
`market/google/pro-image-to-image.md` serves `nano-banana-pro`, and
`market/gpt/gpt-image-2-text-to-image.md` serves `gpt-image-2-text-to-image` with no vendor prefix at
all. Always read the `model` enum in the OpenAPI block.

## Conventions

- Tables over prose in every document. Keep them scannable.
- Model slugs are written exactly as the API expects them (`kling-3.0-omni/text-to-video`,
  `bytedance/seedance-1.5-pro`, `nano-banana-2`, `gpt-image/1.5-text-to-image`) — the punctuation is
  inconsistent across and *within* families on purpose; do not "normalize" it, and do not add a
  vendor prefix a slug does not have.
- Capability names used throughout: `text-to-video`, `image-to-video`, `reference-to-video`,
  `video-to-video`, `speech-to-video`, `motion-control`, `avatar`, `text-to-image`, `image-to-image`,
  `layer-decomposition`, `text-to-speech`, `upscale`, `background-removal`.
