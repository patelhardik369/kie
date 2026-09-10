# OpenAI — 8 models (8 image)

Transcribed from `docs.kie.ai`. All eight POST to `https://api.kie.ai/api/v1/jobs/createTask`.

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
