# OpenAI — 4 models (4 image)

Transcribed from `docs.kie.ai`. All four POST to `https://api.kie.ai/api/v1/jobs/createTask`.

> **Slug prefixes are inconsistent and must be copied exactly.** GPT Image 1.5 carries a
> `gpt-image/` prefix **and a dot** in its version (`gpt-image/1.5-text-to-image`). GPT Image 2 carries
> **no prefix and no dot** (`gpt-image-2-text-to-image`), even though its doc page lives under
> `market/gpt/`. These are not typos.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `gpt-image/1.5-text-to-image` | text-to-image | image | `market/gpt-image/1-5-text-to-image.md` |
| 2 | `gpt-image/1.5-image-to-image` | image-to-image | image | `market/gpt-image/1-5-image-to-image.md` |
| 3 | `gpt-image-2-text-to-image` | text-to-image | image | `market/gpt/gpt-image-2-text-to-image.md` |
| 4 | `gpt-image-2-image-to-image` | image-to-image | image | `market/gpt/gpt-image-2-image-to-image.md` |

Sora is **not** offered by Kie. The legacy 4o Image API (`POST /api/v1/gpt4o-image/generate`) is a
separate non-unified endpoint and is deliberately out of scope — GPT Image 1.5 and 2 supersede it.

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
