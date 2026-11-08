# OpenAI — 14 models (14 image)

Transcribed from `docs.kie.ai`. All fourteen POST to `https://api.kie.ai/api/v1/jobs/createTask`.

> **Slug prefixes are inconsistent and must be copied exactly.** GPT Image 1.5 carries a
> `gpt-image/` prefix **and a dot** in its version (`gpt-image/1.5-text-to-image`). GPT Image 2 and 2.5
> carry **no prefix and no dot** (`gpt-image-2-text-to-image`, `gpt-image-2-5-flare-text-to-image`),
> even though their doc pages live under `market/gpt/`. These are not typos — the version is spelled
> `2-5`, never `2.5`.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `gpt-image/1.5-text-to-image` | text-to-image | image | `market/gpt-image/1-5-text-to-image.md` |
| 2 | `gpt-image/1.5-image-to-image` | image-to-image | image | `market/gpt-image/1-5-image-to-image.md` |
| 3 | `gpt-image-2-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-text-to-image.md` |
| 4 | `gpt-image-2-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-image-to-image.md` |
| 5 | `gpt-image-2-5-flare-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-5-flare-text-to-image.md` |
| 6 | `gpt-image-2-5-flare-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-5-flare-image-to-image.md` |
| 7 | `gpt-image-2-5-sunburst-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-5-sunburst-text-to-image.md` |
| 8 | `gpt-image-2-5-sunburst-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-5-sunburst-image-to-image.md` |
| 9 | `gpt-image-2-6/flare-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-6-flare-text-to-image.md` |
| 10 | `gpt-image-2-6/flare-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-6-flare-image-to-image.md` |
| 11 | `gpt-image-2-6/sunburst-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-6-sunburst-text-to-image.md` |
| 12 | `gpt-image-2-6/sunburst-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-6-sunburst-image-to-image.md` |
| 13 | `gpt-image-2-6/economy-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-6-economy-text-to-image.md` |
| 14 | `gpt-image-2-6/economy-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-6-economy-image-to-image.md` |

GPT Image 2.5 (models 5–8) is **four endpoints, not one**: two quality tiers — `flare` and
`sunburst` — each in a text-to-image and an image-to-image form. All four take the same schema; only
the slug and the output differ.

Sora is **not** offered by Kie. The legacy 4o Image API (`POST /api/v1/gpt4o-image/generate`) is a
separate non-unified endpoint and is deliberately out of scope — GPT Image 1.5, 2 and 2.5 supersede it.

---

# GPT Image 1.5 (models 1, 2)

A small, strict schema: **three of its four fields are required**, and `aspect_ratio` offers only
three values. Both models document defaults for every required field, so `buildRequestInput` always
has something to send.

### 1. `gpt-image/1.5-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | — | — | No documented length limit |
| `aspect_ratio` | string | ✓ | `1:1` `2:3` `3:2` | `1:1` | Only three values |
| `quality` | string | ✓ | `medium` `high` | `medium` | "medium=balanced, high=slow/detailed" |

### 2. `gpt-image/1.5-image-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `input_urls` | string[] | ✓ | ≤ 16 items | — | jpeg/png/webp, max 10.0MB each |
| `prompt` | string | ✓ | — | — | |
| `aspect_ratio` | string | ✓ | `1:1` `2:3` `3:2` | `3:2` | **Default differs from the text-to-image sibling's `1:1`** |
| `quality` | string | ✓ | `medium` `high` | `medium` | |

---

# GPT Image 2 (models 3, 4)

Fifteen aspect ratios, three resolutions, and a transparency switch — but **no documented defaults on
anything except `prompt`'s requiredness**, and three interlocking restrictions stated only in prose.

### The three documented restrictions

Quoted from the pages, and encoded as `Constraint` entries so the form narrows the controls instead of
letting the API reject the job:

1. "Images with a `1:1` aspect ratio cannot be converted to 4K images."
2. "Images with the aspect ratio set to `auto` or without a specified aspect ratio parameter will only
   be converted to 1K images; otherwise, the task will fail to create."
3. `background` "is only supported when the resolution is 1K."

Plus one that differs between the two models:

| Model | Extra restriction |
|---|---|
| text-to-image | "for 2K and 4K resolution, the following aspect ratios are not supported: `5:4`, `4:5`, `3:1`, `1:3`, and `9:21`" |
| image-to-image | "`5:4` and `4:5` aspect ratios only support 1K images" |

All of these are expressed as `allowedValuesWhen` on `resolution`, keyed off the chosen
`aspect_ratio` — one constraint per restricted ratio. Restricting `resolution` rather than
`aspect_ratio` is deliberate: the user picks a shape first and a size second, so narrowing the second
control reads as guidance rather than as the first choice being taken away.

`background` uses `forbiddenWhen` against `resolution` `2K` and `4K`.

### 3. `gpt-image-2-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 20000 chars | — | |
| `aspect_ratio` | string | | `auto` `1:1` `3:2` `2:3` `4:3` `3:4` `5:4` `4:5` `16:9` `9:16` `2:1` `1:2` `3:1` `1:3` `21:9` `9:21` | — | **No documented default.** Doc says it "is set to auto by default" in prose but the schema states none, so nothing is sent unless chosen. |
| `resolution` | string | | `1K` `2K` `4K` | — | No documented default |
| `background` | string | | `transparent` `opaque` `auto` | — | 1K only |

### 4. `gpt-image-2-image-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 20000 chars | — | |
| `input_urls` | string[] | ✓ | ≤ 16 items | — | Array of input image URLs |
| `aspect_ratio` | string | | same 16 values as model 3 | — | No documented default |
| `resolution` | string | | `1K` `2K` `4K` | — | No documented default |
| `background` | string | | `transparent` `opaque` `auto` | — | 1K only |

> **The `input_urls` name is shared with `gpt-image/1.5-image-to-image` and with Wan — and it is the
> same field name each time.** That is a coincidence of naming, not a shared schema: GPT Image 2 caps
> it at 16 with no stated file-size limit, GPT Image 1.5 caps it at 16 with a 10.0MB per-file limit.

---

# GPT Image 2.5 (models 5–8)

Released by OpenAI on 8 September 2026 and live on Kie the same week. **Four endpoints share one
schema** — three fields for text-to-image, four for image-to-image — so the only thing to get wrong
is the slug.

Two tiers, priced identically:

| Tier | Kie's positioning |
|---|---|
| `flare` | The default. Lower latency; creator content, social, prototyping, high-volume generation |
| `sunburst` | Premium. Tighter control, more polished output; campaign assets, branded and product imagery |

### The three ways 2.5 is not GPT Image 2

Each of these is a live 422 or a silently wrong image if you assume otherwise:

1. **The aspect ratios diverge in BOTH directions.** 2.5 offers thirteen, 2 offers sixteen, and
   neither list contains the other. 2.5 **adds** `27:16`, `16:27`, `9:8`, `8:9`; it **drops** `5:4`,
   `4:5`, `2:1`, `1:2`, `3:1`, `1:3`, `9:21`. Sending `2:1` to 2.5 fails; sending `9:8` to 2 fails.
2. **There is no `background` field.** Transparency is not reachable on 2.5 at any resolution.
3. **`auto` is NOT capped at 1K.** On GPT Image 2 an `auto` (or absent) ratio forces 1K; on 2.5 the
   only cap is the four narrow ratios below. Carrying 2's rule across would deny 2K and 4K on the
   shape the form opens on.

### The one documented restriction

> "The 27:16, 16:27, 9:8 and 8:9 aspect ratios support 1K only. 2K and 4K are available for other
> aspect ratios."

Encoded as four `allowedValuesWhen` constraints on `resolution`, keyed off `aspect_ratio` — the same
shape used for GPT Image 2, and for the same reason: the user picks a shape first and a size second,
so narrowing the second control reads as guidance.

### Pricing

| Resolution | Credits | USD |
|---|---|---|
| 1K | 6 | $0.03 |
| 2K | 10 | $0.05 |
| 4K | 16 | $0.08 |

Same for both tiers. High-tier top-ups (+10% bonus) bring the effective rate down ~10%.

### 5, 7. `gpt-image-2-5-flare-text-to-image` / `gpt-image-2-5-sunburst-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 20000 chars | — | |
| `aspect_ratio` | string | | `auto` `1:1` `3:2` `2:3` `4:3` `3:4` `16:9` `9:16` `21:9` `27:16` `16:27` `9:8` `8:9` | `auto` | Thirteen values. See the conflict note below. |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | Four ratios cap it at 1K |

### 6, 8. `gpt-image-2-5-flare-image-to-image` / `gpt-image-2-5-sunburst-image-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 20000 chars | — | Schema states no `maxLength`; the field's own description says "up to 20,000 characters" |
| `input_urls` | string[] | ✓ | ≤ 16 items | — | JPEG / PNG / WEBP, 30MB each per Kie's uploader |
| `aspect_ratio` | string | | same thirteen as above | `auto` | |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | |

### Two doc problems worth knowing about

> **DOC CONFLICT — the defaults.** The OpenAPI block at `docs.kie.ai` declares **no** `default:` on
> `aspect_ratio` or `resolution`. Kie's own model page at `kie.ai/gpt-image-2-5` states
> `Default Value: "auto"` and `Default Value: "1K"`, and its request example sends exactly those. The
> stated defaults are what the registry carries: both are enum members, both match the doc's example,
> and 1K is the cheapest tier — so the form cannot open on a costlier setting than the user asked for.
> This differs from GPT Image 2, where only prose claimed a default and the registry carries none.

> **STALE DOC — the image-to-image ratio annotation.** Both image-to-image pages carry an
> `x-apidog-enum` block still listing **GPT Image 2's** sixteen ratios (`5:4`, `2:1`, `9:21` …)
> alongside an `enum` listing 2.5's thirteen. The `enum` is the half the server validates; the
> annotation is display metadata left over from the page it was copied from. `references` and the
> registry transcribe the `enum`. The `kie.ai` playground for all four endpoints shows the same
> thirteen, which confirms it.

---

# GPT Image 2.6 (models 9–14)

Transcribed from the OpenAPI block at `docs.kie.ai/market/gpt/gpt-image-2-6-flare-text-to-image.md`
(2026-11-08). Three tiers — Flare (fast), Sunburst (refined), Economy — each with a text-to-image and an
image-to-image endpoint. Flare and Sunburst share one schema per direction; Economy has its own.

**The slug shape changes again.** 2.6 is `gpt-image-2-6/flare-text-to-image` — a `gpt-image-2-6/`
**prefix and a slash**, where 2.5 is one hyphenated string (`gpt-image-2-5-flare-text-to-image`).

### 9. `gpt-image-2-6/flare-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 32000 chars | — | |
| `aspect_ratio` | string | | `auto` `1:1` `3:2` `2:3` `4:3` `3:4` `5:4` `4:5` `16:9` `9:16` `2:1` `1:2` `21:9` `9:21` `3:1` `1:3` | `auto` | Static images only. GPT Image 2's sixteen, not 2.5's thirteen; no tier caps |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | Static images only (pixel table on the page) |
| `quality` | string | | `low` `medium` `high` `xhigh` `max` `auto` | `medium` | |
| `background` | string | | `transparent` `opaque` `auto` | `auto` | Transparent needs png / webp (see conflict) |
| `output_format` | string | | `png` `jpeg` `webp` `gif` `svg` | `png` | `jpg` is accepted as `jpeg` |
| `complexity` | string | | `low` `medium` `high` | `high` | Planning complexity |
| `moderation` | string | | `auto` `low` | `low` | |
| `output_compression` | integer | | 0 – 100 | — | jpeg / webp only |
| `size` | string | | `WxH`, multiples of 16, or `auto` | `auto` | GIF per-frame size; `auto` = 512×512 |
| `frame_count` | integer | | 2 – 16 | `9` | GIF only |
| `frame_duration_ms` | integer | | 20 – 2000, multipleOf 10 | `200` | GIF only |
| `svg` | **object** | | `{ model }` | — | SVG only. Single object, not an array |
| `svg.model` | string | | `gpt-6-sol` `gpt-5.6-luna` `gpt-5.6-terra` | `gpt-5.6-luna` | SVG author model, billed separately |

GIF frames are packed into a sprite sheet (2–8 → 4×2, 9 → 3×3, 10–12 → 4×3, 13–16 → 4×4) that must be
≤ 3840 px per side, ≤ 8,294,400 px total and ≤ 3:1, else 400. `512x512` fits 2–16 frames, `768x768` at
most 12, `1024x1024` never.

### Restrictions

| Doc says | Encoded as |
|---|---|
| GIF fields "Send only when `output_format=gif`" | `forbiddenWhen` on `size` `frame_count` `frame_duration_ms` for each other format |
| `svg` "only when `output_format=svg`" | `forbiddenWhen` on `svg` for each other format |
| `output_compression` "only when `output_format` is `jpeg` or `webp`" | `forbiddenWhen` for png / gif / svg |
| Transparent background needs png / webp | `allowedValuesWhen` `background` → `opaque` `auto` for jpeg and svg |

> **RESOLVED — transparency and GIF.** `background` reads "only supported with `png` / `webp` /
> `gif`" in its summary and "`output_format` must be `png` or `webp`" in its bullet. kie.ai's own
> playground (`kie.ai/gpt-image-2-6`) settles it with a linkage rule: a transparent background disables
> `jpeg` and `svg` only, so gif is allowed.

> **UNVERIFIED — background at 1K only.** The kie.ai playground labels `background` "Only available
> when resolution is 1K" on all four Flare / Sunburst forms. The API schema does not say so, and the
> playground's linkage rules do not enforce it. The registry shows the note on the control and does not
> block 2K / 4K; if Kie rejects it, add `forbiddenWhen` as on GPT Image 2.

### kie.ai playground linkage rules (2026-11-08)

| Form | Rule | Registry |
|---|---|---|
| Flare / Sunburst t2i | `output_format ≠ gif` → hide `frame_count`, `frame_duration_ms` | `forbiddenWhen` (also `size`) |
| Flare / Sunburst t2i | `background = transparent` → disable `jpeg`, `svg` | `allowedValuesWhen` on `background` for jpeg / svg |
| Flare / Sunburst t2i + i2i | `output_format ∉ {jpeg, webp}` → hide `output_compression` | `forbiddenWhen` |
| Flare / Sunburst t2i | `output_format ≠ svg` → hide `svg` | `forbiddenWhen` |
| Flare / Sunburst i2i | `background = transparent` → disable `jpeg` | `allowedValuesWhen` for jpeg |
| Economy t2i | `output_format ≠ gif` → hide `frame_count`, `frame_duration_ms` | `forbiddenWhen` |

The playground's DEFAULTS differ from the API's and are not used: it opens text-to-image on `gif`,
`1:1`, `frame_count "16"`, `frame_duration_ms 120`; the API defaults are `png`, `auto`, `9`, `200`.

> **EXAMPLE-ONLY VALUE.** The SVG request example sends `svg.model: gpt-5.4-mini`, which is not in the
> enum. It is not offered.

> **Superseded transcription.** An earlier pass worked from a playground-generated page that typed
> `frame_count` as a string enum defaulting to `"16"`, defaulted `output_format` to `gif`, omitted
> `size`, typed `svg` as an array, and restricted `background` to 1K. None of that is in the schema.

### 10. `gpt-image-2-6/flare-image-to-image`

From `docs.kie.ai/market/gpt/gpt-image-2-6-flare-image-to-image.md`. Same as model 9 for
`aspect_ratio`, `resolution`, `quality`, `complexity`, `moderation` and `output_compression`; the
differences:

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 32000 chars | — | Say what stays and what changes |
| `input_urls` | string[] | ✓ | ≤ 16 | — | jpeg / png / webp |
| `mask_url` | string (uri) | | | — | Inpaint mask. Not with `markup` |
| `markup` | string (uri) | | | — | Transparent PNG overlaid on the **first** input image. Not with `mask_url` |
| `background` | string | | `transparent` `opaque` `auto` | `auto` | Transparent needs png / webp — no gif mention here |
| `output_format` | string | | `png` `jpeg` `webp` | `png` | No `gif`, no `svg` |

No `size`, `frame_count`, `frame_duration_ms` or `svg` — GIF and SVG output are text-to-image only.

| Doc says | Encoded as |
|---|---|
| `mask_url` / `markup` "Cannot be used together" | `mutuallyExclusive` |
| `output_compression` only for jpeg / webp | `forbiddenWhen` output_format `png` |
| Transparent background only with png / webp | `allowedValuesWhen` `background` → `opaque` `auto` for jpeg |

### 11, 12. `gpt-image-2-6/sunburst-text-to-image` / `gpt-image-2-6/sunburst-image-to-image`

Field-for-field identical to models 9 and 10 — the four OpenAPI blocks were diffed and differ only in
whitespace inside the `background` description. The registry builds Flare and Sunburst from one
function per direction; only the slug, label, doc page and positioning line vary.

### 13. `gpt-image-2-6/economy-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 20000 chars | — | 20k, not 32k |
| `aspect_ratio` | string | | `auto` `1:1` `16:9` `9:16` `3:2` `2:3` `21:9` `4:3` | `auto` | Eight only |
| `background` | string | | `transparent` `opaque` `auto` | `auto` | No format restriction stated |
| `output_format` | string | | `png` `gif` | `png` | |
| `frame_count` | **string** | | `auto` `4` `9` `16` `25` `36` `64` | `auto` | GIF only. Quoted, unlike Flare's integer 2–16 |
| `frame_duration_ms` | number | | 20 – 2000, rounded to 10 | — | GIF only. See conflict |

No `resolution`, `quality`, `complexity`, `moderation`, `output_compression`, `size` or `svg`.

> **DOC CONFLICT — `frame_duration_ms`.** Typed `number` with no `default`; the description calls
> `auto` the default and the request example sends the string `"auto"`. The registry follows the type
> and leaves the field empty for auto.

### 14. `gpt-image-2-6/economy-image-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 20000 chars | — | |
| `input_urls` | string[] | | ≤ 16 | — | **Optional** here; JPEG / PNG / WebP ≤ 30 MB |
| `aspect_ratio` | string | | same eight as model 13 | `auto` | |
| `background` | string | | `transparent` `opaque` `auto` | `auto` | |
| `output_format` | string | | `png` | `png` | PNG only |

No mask, no markup, no GIF.

