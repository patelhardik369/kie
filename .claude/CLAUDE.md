# Kie Studio

A self-hosted, single-user Higgsfield-style generation studio built on the **Kie AI** unified API.

The defining product promise: **every parameter of every supported model is reachable in the UI.**
Hosted tools hide parameters behind presets. This app does the opposite — presets are a convenience
layer *on top of* full manual control, never a replacement for it.

## Scope boundary — three families only

| Family | Video | Image | Total |
|---|---|---|---|
| **Kling** | 19 | — | 19 |
| **ByteDance** (Seedance video / Seedream image) | 10 | 10 | 20 |
| **Wan** | 18 | 2 | 20 |
| | | | **59** |

Plus utility endpoints: 3 file-upload variants, credits, download-URL, webhook verification.

**Do not add Veo, Runway, Hailuo, PixVerse, MiniMax, Grok, Sora, Flux, Qwen, Ideogram, Nano Banana,
Suno, ElevenLabs, or any chat model.** Kie offers them; this project deliberately does not. If a task
seems to need one, stop and ask.

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

## Where things live

| Path | What |
|---|---|
| `.claude/skills/kie-api/SKILL.md` | Unified API contract — load before touching `lib/kie/` |
| `.claude/skills/kie-models/SKILL.md` | Registry conventions + `ModelDefinition` shape |
| `.claude/skills/kie-models/references/{kling,bytedance,wan,utility}.md` | **Authoritative** parameter tables |
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
markdown. The HTML catalog page at `kie.ai/market` returns **403** to fetchers; never rely on it.
`https://docs.kie.ai/llms.txt` is the full page index and the source of truth for what models exist.

## Conventions

- Tables over prose in every document. Keep them scannable.
- Model slugs are written exactly as the API expects them (`kling-3.0-omni/text-to-video`,
  `bytedance/seedance-1.5-pro`) — the punctuation is inconsistent across families on purpose; do not
  "normalize" it.
- Capability names used throughout: `text-to-video`, `image-to-video`, `reference-to-video`,
  `video-to-video`, `speech-to-video`, `motion-control`, `avatar`, `text-to-image`, `image-to-image`,
  `layer-decomposition`.
