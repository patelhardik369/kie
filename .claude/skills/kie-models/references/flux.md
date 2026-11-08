# Flux — 2 image models

All POST to `https://api.kie.ai/api/v1/jobs/createTask`.

> **Source.** Transcribed from the doc page text the user supplied on 2026-11-08; `docs.kie.ai` was unreachable from the session, so the doc-page path below is **inferred** and must be confirmed with `/verify-catalog`.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `flux-2/pro-text-to-image` | text-to-image | image | `market/flux2/pro-text-to-image.md` (inferred) |
| 2 | `flux-3/klein-text-to-image` | text-to-image | image | `market/flux3/klein-text-to-image.md` (inferred) |

**The version is the prefix, the tier is the path.** `flux-2/pro-…`, `flux-3/klein-…` — never `flux/…`.

## Two generations, two vocabularies

| | FLUX.2 Pro | FLUX.3 Klein |
|---|---|---|
| `aspect_ratio` | **required**, 7 values | optional, 10 values incl. `auto`, `21:9`, `9:21` |
| `resolution` | **required**, `1K` `2K` | optional, `1K` `2K` `4K` |
| pixel size | — | `width` + `height`, override ratio and resolution |
| batch | — | `num_images` 1–4 |
| seed | — | 0–2147483647 |
| prompt rewrite | — | `enhance_prompt` |
| prompt length | 3–5000 | ≤ 5000 |

## 1. `flux-2/pro-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 3 – 5000 chars | — | |
| `aspect_ratio` | string | ✓ | `1:1` `4:3` `3:4` `16:9` `9:16` `3:2` `2:3` | `1:1` | Description mentions `auto` (match first input image) but it is **not in the enum** and this endpoint takes no image |
| `resolution` | string | ✓ | `1K` `2K` | `1K` | |
| `nsfw_checker` | boolean | | | — | "Defaults to true in the Playground" — a Playground statement, not an API default; none recorded |

## 2. `flux-3/klein-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | Any language |
| `width` | number | | 256 – 4096, step 1 | — | With `height`; ratio 1:2.5 – 2.5:1. Page shows `256` as an example value |
| `height` | number | | 256 – 4096, step 1 | — | With `width`. Page shows `640` as an example value |
| `aspect_ratio` | string | | `1:1` `4:3` `3:4` `3:2` `2:3` `16:9` `9:16` `21:9` `9:21` `auto` | `1:1` | Ignored once width/height passed |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | Ignored once width/height passed |
| `output_format` | string | | `png` `jpeg` `webp` | `png` | |
| `num_images` | number | | 1 – 4, step 1 | `1` | |
| `seed` | number | | 0 – 2147483647 | — | "Omit for a random result"; image *i* uses seed + *i*. Page shows `1` as an example |
| `enhance_prompt` | boolean | | | `true` | Turn off for literal prompts or lower latency |
| `nsfw_checker` | boolean | | | — | As on FLUX.2 Pro |

### Constraints

| Doc says | Encoded as |
|---|---|
| "Both must be passed at the same time" | `requires` width → height and height → width |
| "Once passed, aspect_ratio and resolution are ignored" | `forbiddenWhen` on `aspect_ratio`, `resolution` while `width` / `height` present — an ignored field is a silent wrong result |
| "aspect ratio between 1:2.5 and 2.5:1" | Not machine-checked; in `describe` and `notes` |

### Why no defaults on width / height / seed

The page lists `256`, `640` and `1` as "Default Value", but they are its request example: sending a
width and height would override the chosen ratio on every request, and the seed's own description says
to omit it for a random result.
