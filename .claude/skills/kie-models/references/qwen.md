# Qwen — 11 image models (4 generations)

Transcribed from `docs.kie.ai`. All eleven POST to `https://api.kie.ai/api/v1/jobs/createTask`.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `qwen/text-to-image` | text-to-image | image | `market/qwen/text-to-image.md` |
| 2 | `qwen/image-to-image` | image-to-image | image | `market/qwen/image-to-image.md` |
| 3 | `qwen/image-edit` | image-to-image | image | `market/qwen/image-edit.md` |
| 4 | `qwen2/text-to-image` | text-to-image | image | `market/qwen2/text-to-image.md` |
| 5 | `qwen2/image-edit` | image-to-image | image | `market/qwen2/image-edit.md` |
| 6 | `qwen2-1/text-to-image` | text-to-image | image | `market/qwen2-1/text-to-image.md` |
| 7 | `qwen2-1/image-to-image` | image-to-image | image | `market/qwen2-1/image-to-image.md` |
| 8 | `qwen3/text-to-image` | text-to-image | image | `market/qwen3/text-to-image.md` |
| 9 | `qwen3/image-to-image` | image-to-image | image | `market/qwen3/image-to-image.md` |
| 10 | `qwen3/pro-text-to-image` | text-to-image | image | `market/qwen3-pro/text-to-image.md` |
| 11 | `qwen3/pro-image-to-image` | image-to-image | image | `market/qwen3-pro/image-to-image.md` |

**Image only.** Kie also serves Qwen as chat completions; text models are permanently out of scope
(no output file, no `assets` row, no gallery entry). There is no Qwen video endpoint.

## Four generations, three parameter vocabularies

Nothing in a slug tells you which vocabulary you are in.

| | Qwen 1 `qwen/*` | Qwen 2 `qwen2/*` | Qwen 2.1 `qwen2-1/*` | Qwen 3 `qwen3/*` |
|---|---|---|---|---|
| shape field | `image_size` | `image_size` | **`aspect_ratio`** | `image_size` |
| shape values | **named** (`square_hd`) | ratios | ratios | ratios |
| `resolution` | — | — | `1K` `2K` | `1K` `2K` |
| prompt rewrite | — | — | `enhance_prompt` | **`prompt_extend`** |
| sampler knobs | steps, CFG, acceleration | — | — | — |
| transparency | — | — | `background` | — |
| WebP out | — | — | ✓ | — |
| negative prompt | ≤ 500 | — | — | ≤ 5000 |
| prompt ceiling | 5000 / 2000 | **800** | 5000 | 5000 |

## The traps

| Trap | Detail |
|---|---|
| **Pro tier is a capability prefix** | Doc pages are `market/qwen3-pro/…`; the `model` enum reads `qwen3/pro-text-to-image`. A `qwen3-pro/` slug is a `422`. |
| **`image_size` means two things** | Named sizes on Qwen 1 (`square_hd`, `landscape_4_3`), aspect ratios on Qwen 2 and Qwen 3. Same key, incompatible value sets. |
| **Qwen 2.1 renames it** | `aspect_ratio`, and it is the only generation that does. |
| **Prompt ceilings differ** | 5000 → 2000 (`qwen/image-edit`) → 800 (both Qwen 2) → 5000 again. |
| **`output_format` order flips** | `png, jpeg` on Qwen 1 and 3; `jpeg, png` on Qwen 2. Default is `png` throughout. |
| **Two safety switches** | `enable_safety_checker` is the upstream model's and exists on Qwen 1 only. `nsfw_checker` is Kie's and is on all eleven. Not interchangeable. |
| **`nsfw_checker` defaults to false** | Filtering is OFF over the API. The Playground turns it on, which is why the 2.1 Playground page says it defaults to `true`. |
| **`num_images` is an enum of STRINGS** | `'1' '2' '3' '4'` on `qwen/image-edit`. The schema types it `string`. |
| **Reference ceilings differ** | 10 on `qwen2-1/image-to-image`, 3 on both Qwen 3 image-to-image endpoints, 1 (a scalar `image_url`) everywhere else. |

---

# Qwen 1 — `qwen/*`

A diffusion passthrough: `num_inference_steps`, `guidance_scale`, `acceleration` and
`enable_safety_checker` appear here and nowhere else in the family.

### 1. `qwen/text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | |
| `image_size` | string | | `square` `square_hd` `portrait_4_3` `portrait_16_9` `landscape_4_3` `landscape_16_9` | `square_hd` | **Named sizes, not ratios.** `portrait_16_9` is a 9:16 picture |
| `num_inference_steps` | number | | 2–250, step 1 | `30` | |
| `seed` | integer | | — | — | No documented range |
| `guidance_scale` | number | | 0–20, step 0.1 | `2.5` | CFG |
| `enable_safety_checker` | boolean | | — | — | Always on in the Playground; `false` over the API only |
| `output_format` | string | | `png` `jpeg` | `png` | |
| `negative_prompt` | string | | ≤ 500 chars | — | |
| `acceleration` | string | | `none` `regular` `high` | `none` | `high` recommended for images without text |
| `nsfw_checker` | boolean | | — | `false` (prose) | Kie's filter |

### 2. `qwen/image-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | |
| `image_url` | string | ✓ | — | — | **Scalar**, not an array. jpeg/png/webp, max 10.0MB |
| `strength` | number | | 0–1, step 0.01 | `0.8` | Denoising. 1.0 fully remakes, 0.0 preserves. **This endpoint only** |
| `output_format` | string | | `png` `jpeg` | `png` | |
| `acceleration` | string | | `none` `regular` `high` | `none` | |
| `negative_prompt` | string | | ≤ 500 chars | — | |
| `seed` | integer | | — | — | |
| `num_inference_steps` | number | | 2–250, step 1 | `30` | |
| `guidance_scale` | number | | 0–20, step 0.1 | `2.5` | |
| `enable_safety_checker` | boolean | | — | — | |
| `nsfw_checker` | boolean | | — | `false` (prose) | |

**No `image_size`** — the output follows the reference image.

### 3. `qwen/image-edit`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | **≤ 2000 chars** | — | Its two siblings allow 5000 |
| `image_url` | string | ✓ | — | — | jpeg/png/webp, max 10.0MB |
| `acceleration` | string | | `none` `regular` `high` | `none` | **DOC CONFLICT**, below |
| `image_size` | string | | same six named sizes | `landscape_4_3` | Differs from the t2i default |
| `num_inference_steps` | number | | **2–49**, step 1 | **`25`** | **DOC CONFLICT**, below |
| `seed` | integer | | — | — | |
| `guidance_scale` | number | | 0–20, step 0.1 | **`4`** | `2.5` on its siblings |
| `sync_mode` | boolean | | — | — | Waits for the image before responding. The studio polls regardless |
| `num_images` | **string** | | `'1'` `'2'` `'3'` `'4'` | — | **Quoted strings.** The schema types this `string` |
| `enable_safety_checker` | boolean | | — | — | Prose says "Default value: true"; no schema default |
| `output_format` | string | | `jpeg` `png` | `png` | Order flipped vs. its siblings |
| `negative_prompt` | string | | ≤ 500 chars | — | |
| `nsfw_checker` | boolean | | — | `false` (prose) | |

**DOC CONFLICT ×2 on one page.** `num_inference_steps` prose reads "Default value: 30" while the
schema says `default: 25`. `acceleration` prose reads "Options: 'none', 'regular'" while the schema
enum is `none, regular, high`. **The schema wins in both cases** — it is what the server reads.

---

# Qwen 2 — `qwen2/*`

Every sampler knob is gone. Four fields plus the filter. There is **no `qwen2/image-to-image`**.

### 4. `qwen2/text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | **≤ 800 chars** | — | |
| `image_size` | string | | `1:1` `3:4` `4:3` `9:16` `16:9` | `16:9` | **Ratios** under the Qwen 1 key name |
| `seed` | integer | | — | — | |
| `output_format` | string | | `jpeg` `png` | `png` | |
| `nsfw_checker` | boolean | | — | `false` (prose) | |

**DOC CONFLICT.** The `model` block on this page reads `qwen2/image-edit`, copied from the sibling
page. The summary ("Qwen2 - Text To Image"), the description ("Image generation by
`qwen2/text-to-image`"), the request example and the callback example all say
**`qwen2/text-to-image`**, which is the slug the registry uses.

### 5. `qwen2/image-edit`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 800 chars | — | |
| `image_url` | string | ✓ | — | — | jpeg/png/webp, max 10.0MB |
| `image_size` | string | | `1:1` `2:3` `3:2` `3:4` `4:3` `9:16` `16:9` `21:9` | `16:9` | **Eight** ratios; its t2i sibling has five |
| `seed` | integer | | — | — | |
| `output_format` | string | | `jpeg` `png` | `png` | |
| `nsfw_checker` | boolean | | — | `false` (prose) | |

`2:3`, `3:2` and `21:9` exist here and not on `qwen2/text-to-image`. Completing one enum from the
other is the mistake `SKILL.md` warns about.

---

# Qwen 2.1 — `qwen2-1/*`

The only generation with transparency, WebP, and a `9:21` ratio.

Shared ratio list: `1:1` `4:3` `3:4` `3:2` `2:3` `16:9` `9:16` `21:9` `9:21` — plus `auto` on
image-to-image only.

### 6. `qwen2-1/text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1–5000 chars | — | Longer returns 422 |
| `aspect_ratio` | string | | the nine ratios | `1:1` | Pixel size also depends on `resolution` |
| `resolution` | string | | `1K` `2K` | `1K` | 1K ≈ 7–12s, 2K ≈ 30–55s. **4K returns 422** |
| `background` | string | | `opaque` `transparent` | `opaque` | Transparent → describe only the subject |
| `output_format` | string | | `png` `webp` `jpeg` | `png` | Only generation with WebP |
| `enhance_prompt` | boolean | | — | `true` | On when omitted too |
| `seed` | integer | | — | — | Seed used is returned with the result |
| `nsfw_checker` | boolean | | — | `false` (prose) | |

**Constraints:** `background: transparent` ⇄ `output_format: jpeg` are mutually impossible (JPEG has
no alpha channel). Encoded as two `allowedValuesWhen` so whichever control you touch second narrows
rather than greys out.

**Playground page disagreement.** The Playground rendering of this model documents
`aspect_ratio` defaulting to `3:2` and `nsfw_checker` to `true`. The OpenAPI schema says `1:1` and
`false`. The schema is what the server reads.

### 7. `qwen2-1/image-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_urls` | string[] | ✓ | 1–10 items | — | Array order is what the prompt means by "the first image". jpeg/png/webp, **max 30MB and 25MP each**. Detail per reference drops past ~4 |
| `prompt` | string | ✓ | 1–5000 chars | — | With a mask, describe what belongs in the white area |
| `mask_url` | string | | — | — | **Mode switch** — see below |
| `aspect_ratio` | string | | `auto` + the nine ratios | `auto` | `auto` snaps the first reference's shape to the nearest supported ratio |
| `resolution` | string | | `1K` `2K` | `1K` | 2K with references can take ~3 minutes |
| `background` | string | | `opaque` `transparent` | `opaque` | |
| `output_format` | string | | `png` `webp` `jpeg` | `png` | |
| `enhance_prompt` | boolean | | — | `true` | |
| `seed` | integer | | — | — | |
| `nsfw_checker` | boolean | | — | `false` (prose) | |

**`mask_url` is a mode switch, not an extra option.** Black and white, **white marks what changes**,
a few pixels of feathering along the boundary, same aspect ratio as the reference (a different size
is scaled to it). Supplying it means:

| Rule | What Kie does | Encoded as |
|---|---|---|
| Exactly one entry in `image_urls` | `422` | `maxWhen` `image_urls` → 1 |
| `background: transparent` forbidden | `422` | `allowedValuesWhen` `background` → `opaque` |
| `aspect_ratio` and `enhance_prompt` **ignored** | `200`, with both listed in the result's `ignored` field | `forbiddenWhen` |

The third row is the dangerous one: it is not a rejection. A run asked for as `9:16` comes back in
the reference image's shape with nothing to explain it — the exact failure mode `SKILL.md` calls out.

---

# Qwen 3 and Qwen 3 Pro — `qwen3/*`

**The two tiers take a byte-identical input schema.** The tier is the slug and nothing else.

Shared ratio list: `1:1` `3:2` `2:3` `4:3` `3:4` `16:9` `9:16` `21:9` — **no `9:21`**, unlike 2.1.

### 8. `qwen3/text-to-image` · 10. `qwen3/pro-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 0–5000 chars | — | Chinese and English |
| `resolution` | string | | `1K` `2K` | **none** | The image-to-image pages document `1K`; these do not |
| `image_size` | string | | the eight ratios | `16:9` | Back to `image_size` after 2.1's `aspect_ratio` |
| `output_format` | string | | `png` `jpeg` | `png` | |
| `prompt_extend` | boolean | | — | `true` | 2.1 spells this `enhance_prompt` |
| `nsfw_checker` | boolean | | — | `false` | Only generation with an explicit schema default |
| `negative_prompt` | string | | 0–5000 chars | — | 500 on Qwen 1, absent on Qwen 2 |
| `seed` | integer | | **0–2147483647** | `1` | Only Qwen generation with a documented range |

### 9. `qwen3/image-to-image` · 11. `qwen3/pro-image-to-image`

Everything above, plus, and with `resolution` defaulting to `1K`:

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_urls` | string[] | ✓ | **1–3 items** | — | jpeg/png/webp/**bmp/gif/tiff**, max 10MB each. 2.1 allows 10 and no bmp/gif/tiff |
| `resolution` | string | | `1K` `2K` | `1K` | Documented here, not on the t2i pages |

**SLUG TRAP, restated because it is the one that costs a round trip:** the Pro doc pages are
`market/qwen3-pro/text-to-image.md` and `market/qwen3-pro/image-to-image.md`; the slugs are
`qwen3/pro-text-to-image` and `qwen3/pro-image-to-image`.
