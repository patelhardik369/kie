# Kie Studio

A self-hosted, single-user generation studio built on the [Kie AI](https://kie.ai) unified API —
your own Higgsfield, restricted to six model families and with **every parameter exposed**.

| Family | Video | Image | Audio | Total |
|---|---|---|---|---|
| Kling | 19 | — | — | 19 |
| ByteDance (Seedance / Seedream) | 10 | 10 | — | 20 |
| Wan | 18 | 2 | — | 20 |
| Google (Veo / Gemini Omni / Imagen 4 / Nano Banana) | 5 | 8 | 1 | 14 |
| OpenAI (GPT Image) | — | 4 | — | 4 |
| Enhance (upscale / background removal) | 2 | 3 | — | 5 |
| | **54** | **27** | **1** | **82** |

> **Status: planning complete, implementation not started.** This repository currently contains the
> specification and the verified model catalog. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the build
> order; Phase 0 is the next step.

## Why

Hosted tools expose a curated slice of each model's controls and hold your outputs on their servers.
Kie already resells the same underlying models through one uniform API at credit cost. What was
missing is a front end that turns 82 raw JSON endpoints into something worth sitting in front of —
without hiding a single parameter.

Two promises: **nothing is hidden**, and **nothing is lost** (Kie deletes generated media after 14
days, so every output is downloaded to local disk the moment it's ready).

## Documentation

| Document | What |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Goals, features, acceptance criteria |
| [`docs/MODEL-CATALOG.md`](docs/MODEL-CATALOG.md) | All 82 models — what each is for |
| [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) | Lifecycle, polling, retries, error mapping |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Route map, registry, job runner, storage |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Drizzle schema |
| [`docs/UX-SPEC.md`](docs/UX-SPEC.md) | Screens and parameter-control mapping |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phased build order |

**Authoritative parameter tables** live in
[`.claude/skills/kie-models/references/`](.claude/skills/kie-models/references/) — every field, enum,
default, and limit for all 82 models, each transcribed from its `docs.kie.ai` page. The docs above
index them; they never duplicate them.

## Setup

```bash
cp .env.example .env      # then add your KIE_API_KEY from https://kie.ai/api-key
npm install
npm run dev
```

Outputs are written to `KIE_OUTPUT_DIR` (default
`C:/Users/Hardik/generations/kie-studio`), organized as:

```
YYYY-MM-DD/<family>/<model-slug>/<generationId>-<n>.<ext>
```

History and parameters live in `data/kie.db` (SQLite).

## Working on this with Claude Code

`.claude/` carries the project's conventions:

- **`CLAUDE.md`** — charter, scope boundary, non-negotiables
- **Skills** — `kie-api` (the API contract), `kie-models` (registry conventions + the reference tables)
- **Agent** — `kie-model-scout`, which transcribes a doc page into a registry entry
- **Commands** — `/add-model <slug>`, `/verify-catalog`, `/smoke-model <slug>`

The rule that matters most: **never invent a model parameter.** Every field traces to a doc page.
Kie's models differ from each other in ways that look like typos and aren't — `duration` is a string
on Kling but an integer on Kling Omni, `wan/2-7-text-to-video` uses `ratio` where its siblings use
`aspect_ratio`, and Seedream's `high` quality resolves to 2K on Pro but 3K on Lite.

## Scope

Deliberately limited to Kling, ByteDance, and Wan. Kie also serves Veo, Runway, Hailuo, PixVerse,
MiniMax, Grok, Sora, Flux, Qwen, Ideogram, Nano Banana, Suno, ElevenLabs and chat models — all out of
scope. No multi-user, no auth, no billing, no sharing.
