# Kie Studio

A self-hosted, single-user Higgsfield-style generation studio built on the **Kie AI** API.

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
- **Drizzle + libsql** (local SQLite file) — `data/kie.db`
- Outputs written to `KIE_OUTPUT_DIR` (default `C:\Users\Hardik\generations\kie-studio\`)
- No auth, no accounts, no billing — single local user

## Non-negotiables

1. **Never invent a model parameter.** Every field, enum value, default, and limit is transcribed from
   its `docs.kie.ai` page. If you cannot cite the doc page, the parameter does not go in. Use the
   `kie-models` skill and the `kie-model-scout` agent.
2. **Download every output immediately.** Kie result URLs and uploaded-file URLs expire (~24h). A
   generation is not "done" until its bytes are on local disk and the `assets` row exists. This is the
   single most important durability rule in the codebase.
3. **`KIE_API_KEY` is server-side only.** It lives in `.env`, is read only inside `app/api/**` route
   handlers and `lib/kie/**` server modules, and never crosses into a client component or a response
   body. No `NEXT_PUBLIC_` prefix, ever.
4. **Polling leads, webhooks follow.** On localhost Kie cannot reach a `callBackUrl`, so the poller is
   the primary completion path. The webhook route exists but only engages when `KIE_PUBLIC_URL` is set.
5. **Store `input_json` verbatim.** Every generation must be exactly reproducible and re-runnable from
   its stored parameters.
6. **The registry is data, not code branches.** Adding a model means adding a `ModelDefinition`, not
   writing a new form or a new route. If a model forces you to special-case the UI, the schema layer is
   missing a field type — extend the schema layer instead.
7. **A transport is registry data too.** 81 of the 82 models POST to `/api/v1/jobs/createTask`; Veo
   posts to `/api/v1/veo/generate` and polls `/api/v1/veo/record-info` with a different response
   shape. That difference is declared as `transport: 'veo'` on the `ModelDefinition` and absorbed by
   an adapter in `lib/kie/veo.ts` that returns the same `Task` shape. **The job runner, the gallery,
   and the downloader must never learn that Veo exists.**

## Where things live

| Path | What |
|---|---|
| `.claude/skills/kie-api/SKILL.md` | API contract, both transports — load before touching `lib/kie/` |
| `.claude/skills/kie-models/SKILL.md` | Registry conventions + `ModelDefinition` shape |
| `.claude/skills/kie-models/references/{kling,bytedance,wan,google,openai,enhance,utility}.md` | **Authoritative** parameter tables |
| `.claude/agents/kie-model-scout.md` | Subagent that transcribes a doc page into a registry entry |
| `.claude/commands/` | `/add-model`, `/verify-catalog`, `/smoke-model` |
| `docs/PRD.md` | Product requirements + acceptance criteria |
| `docs/MODEL-CATALOG.md` | Human-readable model index |
| `docs/API-CONTRACT.md` | Request lifecycle, state machine, error mapping |
| `docs/ARCHITECTURE.md` | Route map, job runner, storage |
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
