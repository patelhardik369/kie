---
name: kie-models
description: The Kie Studio model registry — the ModelDefinition/ParamDef schema every model is described with, the rule that parameters are transcribed from docs.kie.ai and never invented, the constraint system for mutually-exclusive inputs, and the family reference index covering all 59 in-scope Kling / ByteDance / Wan endpoints. Load this before adding, editing, or auditing any model in lib/kie/registry, before building or changing the parameter form, or whenever you need a model's exact fields, enums, defaults, or limits.
---

# Kie Studio — Model Registry

59 generation endpoints across three families. Every one is described as **data** — a
`ModelDefinition` — never as a bespoke form or route. The parameter UI is generated from these
definitions, so a correct definition is the whole feature.

## The one rule

**Never invent a parameter, an enum value, a default, or a limit.**

Every row in every reference file traces to a fetched `docs.kie.ai/market/<family>/<slug>.md` page.
If you cannot cite the doc page for a field, the field does not go in. When a doc is ambiguous, record
the ambiguity in the notes column rather than guessing a value — a wrong enum ships a request the API
rejects with `422`, and the user sees a broken control with no way to know why.

Use the `kie-model-scout` agent (`.claude/agents/kie-model-scout.md`) to transcribe a doc page, or
`/add-model <slug>` to do it end-to-end.

## Family references — the authoritative parameter tables

| File | Endpoints |
|---|---|
| `references/kling.md` | 19 Kling video models |
| `references/bytedance.md` | 10 Seedance video + 10 Seedream image |
| `references/wan.md` | 18 Wan video + 2 Wan image |
| `references/utility.md` | Uploads, credits, download-URL, webhook verification |

`docs/MODEL-CATALOG.md` is a human-readable index that links here. It carries **no parameter detail** —
these four files are the single source of truth, so a change lands in exactly one place.

---

## Schema

```ts
export type Family = 'kling' | 'bytedance' | 'wan'

export type Capability =
  | 'text-to-video' | 'image-to-video' | 'reference-to-video'
  | 'video-to-video' | 'speech-to-video' | 'motion-control' | 'avatar'
  | 'text-to-image' | 'image-to-image' | 'layer-decomposition'

export type ParamType =
  | 'text'      // multiline free text (prompt, negative_prompt)
  | 'string'    // single-line free text
  | 'enum'      // fixed option set -> segmented control or select
  | 'number'    // int or float, with min/max/step
  | 'boolean'   // switch
  | 'url'       // one asset URL, uploadable or pasted
  | 'url[]'     // ordered list of asset URLs
  | 'seed'      // integer with a randomize affordance
  | 'object[]'  // repeating group (multi_prompt, kling_elements, elements)
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
  accept?: Array<'image' | 'video' | 'audio'>  // for url / url[]
  fields?: ParamDef[]            // for object[]
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

export interface ModelDefinition {
  slug: string          // exact API value for `model`
  family: Family
  capability: Capability
  label: string         // display name, e.g. "Kling 2.6 — Text to Video"
  docUrl: string        // the docs.kie.ai .md page this was transcribed from
  outputKind: 'video' | 'image' | 'audio' | 'object'
  params: ParamDef[]
  constraints?: Constraint[]
  notes?: string        // cost hints, quirks, mutual-exclusion prose
}
```

### Slugs are verbatim

Punctuation is inconsistent *across* families and that is intentional — it mirrors the API:

```
kling/v2-1-standard              kling-3.0-omni/text-to-video
bytedance/seedance-1.5-pro       bytedance/seedance-2-5
wan/2-2-a14b-text-to-video-turbo wan/3-0-video-prime
```

Never normalize a slug. `bytedance/seedance-1.5-pro` and `bytedance/seedance-2-5` really do differ in
how the version is punctuated. Copy it character-for-character from the doc.

### Constraints are not optional polish

Several models accept overlapping input sets that the API rejects when combined. These must be
machine-readable so the form can disable the conflicting controls *before* submission:

- **Seedance 2.0 / 2.5** — image-to-video (first frame), first-and-last-frame, and multimodal
  reference-to-video are three mutually exclusive modes.
- **Wan 3.0** — `first_frame_url` / `last_frame_url` cannot be combined with any `reference_*_urls`.
- **Kling 3.0 Omni / Kling 3.0** — `multi_prompt` only applies when `multi_shots` (or
  `customize_multi_shots`) is true.

Encode each as a `Constraint`, with the `message` written for the user, not the developer.

### Grouping

`core` and `framing` render in the always-visible panel; `motion`, `audio`, and `advanced` sit behind
a disclosure. Grouping is a UI hint only — **every parameter stays reachable**, which is the entire
point of this project. Nothing is dropped because it seemed obscure.

---

## Adding a model

1. Fetch `https://docs.kie.ai/market/<family>/<slug>.md`.
2. Transcribe every `input` property: name, type, enum values, min/max, maxLength, default, required.
3. Record any mutual exclusions stated in the page's prose as `Constraint` entries.
4. Add the row to the matching `references/*.md` table, with the doc URL.
5. Add the `ModelDefinition` to `lib/kie/registry/<family>.ts`.
6. Typecheck, then smoke-test with `/smoke-model <slug>`.

Run `/verify-catalog` periodically — Kie ships new models frequently, and `docs.kie.ai/llms.txt` is the
authoritative list of what exists.

## Scope reminder

Only `kling`, `bytedance`, and `wan`. Kie also serves Veo, Runway, Hailuo, PixVerse, MiniMax, Grok,
Sora, Flux, Qwen, Ideogram, Nano Banana, Suno, ElevenLabs and chat models — all deliberately out of
scope for this project. Do not add them without asking.
