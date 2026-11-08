# Flux — 2 image models

All POST to `https://api.kie.ai/api/v1/jobs/createTask`.

Transcribed from the OpenAPI blocks at `docs.kie.ai/market/flux2/` and `market/flux3/` (2026-11-08).
Kie also documents FLUX.2 Pro image-to-image, FLUX.2 Flex ×2 and FLUX.3 Klein Edit; they are not in the
registry.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `flux-2/pro-text-to-image` | text-to-image | image | `market/flux2/pro-text-to-image.md` |
| 2 | `flux-3/klein-text-to-image` | text-to-image | image | `market/flux3/klein-text-to-image.md` |

**The version is the prefix, the tier is the path.** `flux-2/pro-…`, `flux-3/klein-…` — never `flux/…`.

## Two generations, two vocabularies

| | FLUX.2 Pro | FLUX.3 Klein |
|---|---|---|
| `aspect_ratio` | **required**, 7 values | optional, 9 values incl. `21:9`, `9:21`; no `auto` on either |
| `resolution` | **required**, `1K` `2K` | optional, `1K` `2K` `4K` |
| pixel size | — | `width` + `height`, override ratio and resolution |
| batch | — | `num_images` 1–4 |
| seed | — | 0–2147483647 |
| prompt rewrite | — | `enhance_prompt` |
| prompt length | 3–5000 (prose) | 1–5000 |
| output format | not selectable — PNG or JPEG | `png` `jpeg` `webp` |

## 1. `flux-2/pro-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 3 – 5000 chars | — | |
| `aspect_ratio` | string | ✓ | `1:1` `4:3` `3:4` `16:9` `9:16` `3:2` `2:3` | `1:1` | Schema gives `examples: 1:1` only; default from kie.ai/flux-2 |
| `resolution` | string | ✓ | `1K` `2K` | `1K` | Schema gives `examples: 1K` only; default from kie.ai/flux-2 |
| `nsfw_checker` | boolean | | | `false` | By `$ref` to the shared schema: "Defaults to false". The playground turns it on |

## 2. `flux-3/klein-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1 – 5000 chars | — | Any language |
| `width` | integer | | 256 – 4096 | — | With `height` (schema `dependencies`); ratio 1:2.5 – 2.5:1 |
| `height` | integer | | 256 – 4096 | — | With `width` |
| `aspect_ratio` | string | | `1:1` `4:3` `3:4` `3:2` `2:3` `16:9` `9:16` `21:9` `9:21` | `1:1` | Ignored once width/height passed |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | Ignored once width/height passed |
| `output_format` | string | | `png` `jpeg` `webp` | `png` | |
| `num_images` | number | | 1 – 4, step 1 | `1` | |
| `seed` | integer | | 0 – 2147483647 | — | No default in the schema; image *i* uses seed + *i* (kie.ai page) |
| `enhance_prompt` | boolean | | | `true` | On even when omitted. Turn off for literal prompts or lower latency |
| `nsfw_checker` | boolean | | | `false` | "Defaults to false" |

### Constraints

| Doc says | Encoded as |
|---|---|
| "Both must be passed at the same time" | `requires` width → height and height → width |
| "Once passed, aspect_ratio and resolution are ignored" | `forbiddenWhen` on `aspect_ratio`, `resolution` while `width` / `height` present — an ignored field is a silent wrong result |
| "aspect ratio between 1:2.5 and 2.5:1" | Not machine-checked; in `describe` and `notes` |

### Why no defaults on width / height / seed

The schema declares none. The kie.ai playground pre-fills `256`, `640` and `1` as examples: sending a
width and height would override the chosen ratio on every request.

> **Superseded transcription.** An earlier pass worked from playground-generated pages that listed
> `auto` in Klein's aspect ratios, gave `nsfw_checker` no API default, and showed `auto` in FLUX.2 Pro's
> ratio description. The schemas have no `auto` on either model and document `nsfw_checker` as
> defaulting to false.
