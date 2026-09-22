# Kie Studio

A deployable generation studio built on the [Kie AI](https://kie.ai) unified API — your own
Higgsfield, restricted to six model families, with **every parameter exposed** and **your own API
key**.

| Family | Video | Image | Audio | Total |
|---|---|---|---|---|
| Kling | 19 | — | — | 19 |
| ByteDance (Seedance / Seedream) | 10 | 10 | — | 20 |
| Wan | 18 | 2 | — | 20 |
| Google (Veo / Gemini Omni / Imagen 4 / Nano Banana) | 5 | 8 | 1 | 14 |
| OpenAI (GPT Image) | — | 4 | — | 4 |
| Enhance (upscale / background removal) | 2 | 3 | — | 5 |
| | **54** | **27** | **1** | **82** |

> **Status: built and deployable.** Runs on Vercel with Supabase for Postgres and Storage.
> See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to put it online.

## Why

Hosted tools expose a curated slice of each model's controls and hold your outputs on their servers.
Kie already resells the same underlying models through one uniform API at credit cost. What was
missing is a front end that turns 82 raw JSON endpoints into something worth sitting in front of —
without hiding a single parameter.

Three promises:

- **Nothing is hidden.** Every documented parameter of every supported model is on the form.
- **Nothing is lost.** Kie deletes generated media after ~14 days, so every output is copied into
  your own storage the moment it is ready.
- **Nothing of yours is ours.** The server holds no API key. Yours lives in your browser, and every
  generation is billed to your own Kie account.

## Documentation

| Document | What |
|---|---|
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **Env vars, Supabase setup, scheduling, migrating from local** |
| [`docs/PRD.md`](docs/PRD.md) | Goals, features, acceptance criteria |
| [`docs/MODEL-CATALOG.md`](docs/MODEL-CATALOG.md) | All 97 models — what each is for |
| [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) | Lifecycle, polling, retries, error mapping |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Route map, registry, job engine, storage |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Drizzle schema |
| [`docs/UX-SPEC.md`](docs/UX-SPEC.md) | Screens and parameter-control mapping |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phased build order |

**Authoritative parameter tables** live in
[`.claude/skills/kie-models/references/`](.claude/skills/kie-models/references/) — every field, enum,
default, and limit for all 97 models, each transcribed from its `docs.kie.ai` page. The docs above
index them; they never duplicate them.

## Setup

```bash
cp .env.example .env     # five required values — see docs/DEPLOYMENT.md
npm install
npm run db:migrate       # create the schema in Supabase
npm run storage:setup    # create the private bucket
npm run dev
```

Then open the app and add your Kie key in Settings. If you have never used Kie,
`/welcome` walks through creating an account and a key, and says exactly what
happens to it afterwards.

Outputs land in a private Supabase Storage bucket, keyed as:

```
<workspaceId>/YYYY-MM-DD/<family>/<model-slug>/<generationId>-<n>.<ext>
```

and are served to the browser as signed URLs that expire in an hour. History and
parameters live in Supabase Postgres.

### Bringing an existing local studio across

The earlier version of this app kept everything in `data/kie.db` and a local
output folder. Nothing is stranded:

```bash
npm run db:import -- --workspace wk_… --dry-run
```

### Deploying

```bash
vercel --prod
```

One step is easy to miss and matters more than the rest: **something has to call
`/api/jobs/tick` on a schedule**, or a generation nobody is watching never
finishes. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §4 covers the three ways,
including a free one that runs entirely inside Supabase.

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

Deliberately limited to the six families in the table above. Kie also serves Runway, Hailuo,
PixVerse, MiniMax, Sora, Flux, Qwen, Ideogram, Midjourney, Suno, ElevenLabs and chat models — all out
of scope.

**No accounts, no billing, no sharing.** Each browser generates an anonymous workspace id and owns
the generations filed under it. That partitions data between people; it is not authentication, and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) is explicit about where the line falls.

### The free tier, honestly

Supabase Free gives **1 GB of storage** and caps **any single file at 50 MB**. Neither is raisable on
that plan. In practice that is roughly 30–80 videos, or thousands of images. Settings shows a live
meter, warns at 80%, and refuses new generations at 100% — before submitting, so nothing is ever paid
for and then discarded. A video over 50 MB is recorded honestly as unstored, with its Kie link and
the fourteen-day expiry stated, rather than being silently dropped.
