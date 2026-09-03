---
name: kie-models
description: The Kie Studio model registry — the ModelDefinition/ParamDef schema every model is described with, the rule that parameters are transcribed from docs.kie.ai and never invented, the constraint system for mutually-exclusive inputs, the transport field that lets Veo live beside the unified endpoint, and the family reference index covering all 82 in-scope Kling / ByteDance / Wan / Google / OpenAI / Enhance endpoints. Load this before adding, editing, or auditing any model in lib/kie/registry, before building or changing the parameter form, or whenever you need a model's exact fields, enums, defaults, or limits.
---

# Kie Studio — Model Registry

82 generation endpoints across six families. Every one is described as **data** — a
`ModelDefinition` — never as a bespoke form or route. The parameter UI is generated from these
definitions, so a correct definition is the whole feature.

## The one rule

**Never invent a parameter, an enum value, a default, or a limit.**

Every row in every reference file traces to a fetched `docs.kie.ai` page. If you cannot cite the doc
page, the field does not go in. When a doc is ambiguous, record the ambiguity in the notes column
rather than guessing a value — a wrong enum ships a request the API rejects with `422`, and the user
sees a broken control with no way to know why.

Corollaries that have already cost real requests:

- **A field in an `example` block but not in `properties` does not exist.** Veo's page shows
  `seeds: 12345` in its example; the schema has no such property, so the registry has no such field.
- **Prose loses to schema when they disagree.** Veo documents `enableTranslation` as "Default value is
  true" in prose and `default: false` in the schema. The schema is what the server reads.
- **Sibling models genuinely differ.** `google/imagen4` types `seed` as a string and
  `google/imagen4-fast` types it as an integer. Never complete one model's enum from another's.

Use the `kie-model-scout` agent (`.claude/agents/kie-model-scout.md`) to transcribe a doc page, or
`/add-model <slug>` to do it end-to-end.

## Family references — the authoritative parameter tables

| File | Endpoints |
|---|---|
| `references/kling.md` | 19 Kling video models |
| `references/bytedance.md` | 10 Seedance video + 10 Seedream image |
| `references/wan.md` | 18 Wan video + 2 Wan image |
| `references/google.md` | 5 video (Veo ×3, Gemini Omni ×2) + 8 image (Imagen 4 ×3, Nano Banana ×5) + 1 audio (Gemini TTS) |
| `references/openai.md` | 4 GPT Image models (1.5 ×2, 2 ×2) |
| `references/enhance.md` | 3 image + 2 video upscale / background-removal models |
| `references/utility.md` | Uploads, credits, download-URL, webhook verification |

`docs/MODEL-CATALOG.md` is a human-readable index that links here. It carries **no parameter detail** —
these seven files are the single source of truth, so a change lands in exactly one place.

`enhance` is a **capability family, not a vendor**: every upscaler and background remover lives there
whoever built it. This is why `grok-imagine/upscale` is in scope while the rest of Grok Imagine is not.

---

## Schema

```ts
export type Family = 'kling' | 'bytedance' | 'wan' | 'google' | 'openai' | 'enhance'

export type Capability =
  | 'text-to-video' | 'image-to-video' | 'reference-to-video'
  | 'video-to-video' | 'speech-to-video' | 'motion-control' | 'avatar'
  | 'text-to-image' | 'image-to-image' | 'layer-decomposition'
  | 'text-to-speech' | 'upscale' | 'background-removal'

export type ParamType =
  | 'text'      // multiline free text (prompt, negative_prompt)
  | 'string'    // single-line free text
  | 'enum'      // fixed option set -> segmented control or select
  | 'number'    // int or float, with min/max/step
  | 'boolean'   // switch
  | 'url'       // one asset URL, uploadable or pasted
  | 'url[]'     // ordered list of asset URLs
  | 'string[]'  // ordered list of opaque strings — NOT uploadable (audio_ids, character_ids)
  | 'seed'      // integer with a randomize affordance
  | 'object[]'  // repeating group (multi_prompt, kling_elements, speakers, video_list)
  | 'color[]'   // { hex, ratio } stops, NOT bare strings (wan/2-7-image color_palette)
  | 'bbox[][]'  // one list of [x1,y1,x2,y2] boxes PER image in `drawsOn` (wan bbox_list)

export type ParamGroup = 'core' | 'framing' | 'motion' | 'audio' | 'advanced'

export interface ParamDef {
  key: string                    // exact API field name — never rename
  type: ParamType
  label: string                  // human label for the UI
  describe: string               // help text, paraphrased from the doc
  group: ParamGroup              // drives basic/advanced placement
  required?: boolean
  default?: unknown              // only if the doc states one
  enum?: Array<string | number>  // exact values the API accepts
  min?: number; max?: number; step?: number
  minLength?: number; maxLength?: number
  minItems?: number; maxItems?: number
  accept?: Array<'image' | 'video' | 'audio' | 'file'>  // for url / url[]
  fields?: ParamDef[]            // for object[]
  deprecated?: boolean           // doc says superseded — still reachable, labelled as such
}

// A discriminated union — see lib/kie/registry/types.ts for the exact shapes.
// Every variant carries a `message` written for the user, shown verbatim.
export type Constraint =
  | { kind: 'mutuallyExclusive';       keys }              // at most one set
  | { kind: 'mutuallyExclusiveGroups'; groups }            // at most one GROUP contributes
  | { kind: 'requiresOneOf';           keys }              // at least one set
  | { kind: 'requiredWhen';            keys, when }        // required while `when` holds
  | { kind: 'forbiddenWhen';           keys, when }        // forbidden while `when` holds
  | { kind: 'requires';                keys, requires }    // keys imply another key
  | { kind: 'maxWhen';                 keys, when, max }   // lower ceiling while `when` holds
  | { kind: 'allowedValuesWhen';       keys, when, values } // enum narrowed while `when` holds

export interface ModelDefinition {
  slug: string          // exact API value for `model`
  family: Family
  capability: Capability
  alsoSupports?: Capability[]
  label: string         // display name, e.g. "Kling 2.6 — Text to Video"
  docUrl: string        // the docs.kie.ai page this was transcribed from
  outputKind: 'video' | 'image' | 'audio' | 'object'
  transport?: 'jobs' | 'veo'   // omit for 'jobs' — see below
  params: ParamDef[]
  constraints?: Constraint[]
  notes?: string        // cost hints, quirks, doc conflicts, mutual-exclusion prose
}
```

### Slugs are verbatim

Punctuation is inconsistent *across* families, *within* families, and even between two versions of the
same model. That is intentional — it mirrors the API:

```
kling/v2-1-standard              kling-3.0-omni/text-to-video
bytedance/seedance-1.5-pro       bytedance/seedance-2-5
wan/2-2-a14b-text-to-video-turbo wan/3-0-video-prime
google/nano-banana               nano-banana-2          nano-banana-pro
gpt-image/1.5-text-to-image      gpt-image-2-text-to-image
veo3                             veo3_fast              veo3_lite
```

Never normalize a slug and never add a vendor prefix a slug does not have. `nano-banana-2` and
`nano-banana-pro` really are unprefixed while `google/nano-banana` is prefixed; `gpt-image/1.5-…` has
a dot where `gpt-image-2-…` has neither dot nor prefix; Veo uses underscores. Copy each one
character-for-character from the doc's `model` enum, which outranks any prose on the page.

**Doc page paths do not predict slugs either.** `market/google/nanobanana2.md` serves `nano-banana-2`;
`market/google/pro-image-to-image.md` serves `nano-banana-pro`;
`market/gpt/gpt-image-2-text-to-image.md` serves an unprefixed slug despite the `gpt/` folder.

### Transports

`transport` names which HTTP contract a model speaks. Omit it and the model uses `'jobs'`, the unified
`POST /api/v1/jobs/createTask` + `GET /api/v1/jobs/recordInfo` pair that 81 of the 82 models use.

`transport: 'veo'` marks the three Veo models, which post a **flat** body to `/api/v1/veo/generate` —
no `input` wrapper — and poll `/api/v1/veo/record-info`, which reports a numeric `successFlag` instead
of a `state` string and returns `resultUrls` already parsed. `lib/kie/veo.ts` adapts both directions so
callers still see the same `Task`.

**The transport is the only thing that may branch on it.** The job runner, the downloader, the
gallery, and the parameter form must stay ignorant of Veo. If you find yourself testing
`model.transport` outside `lib/kie/`, the adapter is leaking.

Adding a transport is a much bigger step than adding a model. Kie's other non-unified APIs — the 4o
Image API at `/api/v1/gpt4o-image/*`, Runway, Suno — are out of scope, so `'veo'` should stay the only
exception unless the user asks otherwise.

### Constraints are not optional polish

Several models accept overlapping input sets that the API rejects when combined. These must be
machine-readable so the form can disable or narrow the conflicting controls *before* submission:

- **Seedance 2.0 / 2.5** — image-to-video (first frame), first-and-last-frame, and multimodal
  reference-to-video are three mutually exclusive modes.
- **Wan 3.0** — `first_frame_url` / `last_frame_url` cannot be combined with any `reference_*_urls`.
- **Kling 3.0 Omni / Kling 3.0** — `multi_prompt` only applies when `multi_shots` (or
  `customize_multi_shots`) is true.
- **Gemini Omni 1.1 Flash** — `first_frame_url` excludes `image_urls`, `audio_ids`, `video_list`, and
  `character_ids`; `last_frame_url` requires `first_frame_url`.
- **GPT Image 2** — `background` needs 1K; `1:1` cannot reach 4K; `auto` reaches only 1K; several
  ratios are 1K-only. All `allowedValuesWhen` on `resolution`.
- **Veo** — `REFERENCE_2_VIDEO` supports only `duration: 8`, and only on `veo3_fast` / `veo3_lite`.

Encode each as a `Constraint`, with the `message` written for the user, not the developer.

**A restriction written in `describe` is documentation, not enforcement.** `describe` is help text; only
a `Constraint` can stop the request. `wan/2-7-image` carried "4K is available only for text-to-image in
standard mode" in its `describe` for the whole life of the entry, with no constraint behind it — so the
form happily offered 4K in edit mode and Kie refused the job at `createTask`. If you write a
restriction into help text, ask immediately which `Constraint` enforces it; if none can, say so in
`notes` and explain why.

The two shapes worth recognising:

| The doc says | Encode as | Why |
|---|---|---|
| "X is only available when Y…" / "only supports…" | `allowedValuesWhen` or `forbiddenWhen` | The API rejects it — better caught before the round trip |
| "X **is ignored** when Y…" | `forbiddenWhen` | Worse than a rejection: Kie returns `200` having quietly done something else. `wan/2-7-image`'s `aspect_ratio` in edit mode returns the input image's shape, so a run asked for as `9:16` comes back landscape with nothing to explain it. |

The second row is the counter-intuitive one. An ignored field feels harmless, so it tends to be left
enabled — but a silent wrong result costs more than an error does, because nothing points at the cause.

`allowedValuesWhen` narrows an enum control's options rather than disabling the control outright. Use
it whenever a doc restricts *which values* of B are legal given A — disabling B entirely would hide
the values that are still fine, and leaving it alone ships a `422`.

### Grouping

`core` and `framing` render in the always-visible panel; `motion`, `audio`, and `advanced` sit behind
a disclosure. Grouping is a UI hint only — **every parameter stays reachable**, which is the entire
point of this project. Nothing is dropped because it seemed obscure, deprecated, or redundant:
`google/nano-banana`'s superseded `image_size` and Veo's deprecated `enableFallback` are both in the
registry, flagged with `deprecated: true` so the control can say so.

---

## Adding a model

1. Fetch the doc page — `https://docs.kie.ai/market/<family>/<page>.md` for everything except Veo,
   which lives at `https://docs.kie.ai/veo3-api/generate-veo-3-video.md`.
2. Read the `model` enum in the OpenAPI block. That string is the slug, whatever the page path says.
3. Transcribe every `input` property: name, type, enum values, min/max, maxLength, default, required.
   For Veo, the properties are at the top level — there is no `input` wrapper.
4. Record any mutual exclusions or value restrictions stated in the page's prose as `Constraint` entries.
5. Add the row to the matching `references/*.md` table, with the doc URL.
6. Add the `ModelDefinition` to `lib/kie/registry/<family>.ts`.
7. Typecheck, run `node --test`, then smoke-test with `/smoke-model <slug>`.

Run `/verify-catalog` periodically — Kie ships new models frequently, and `docs.kie.ai/llms.txt` is the
authoritative list of what exists.

## Scope reminder

Six families only: `kling`, `bytedance`, `wan`, `google`, `openai`, `enhance`.

Kie also serves Runway, Hailuo, PixVerse, MiniMax, Flux, Qwen, Ideogram, Midjourney, Suno, ElevenLabs,
OmniHuman, InfiniteTalk, HappyHorse, Z-Image, and the non-upscale half of Grok Imagine — all
deliberately out of scope. Do not add them without asking.

**Chat and text models are permanently out of scope**, including Gemini 2.5/3.x, GPT-5.x, Codex, and
Claude. The Google and OpenAI families here cover image, video, and audio generation only; a text
completion has no output file, no `assets` row, and no gallery entry.

Two Gemini Omni endpoints are **not models** and must not be registered: `POST /api/v1/omni/audio/create`
and `POST /api/v1/omni/character/create`. They synchronously mint the ids that `audio_ids` and
`character_ids` consume. If they get built, they belong in the asset library.
