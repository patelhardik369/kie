# Enhance — 5 models (3 image + 2 video)

Transcribed from `docs.kie.ai`. All five POST to `https://api.kie.ai/api/v1/jobs/createTask`.

**`enhance` is a capability family, not a vendor.** It holds every upscaler and background remover in
the catalog regardless of who built it. That is the whole reason `grok-imagine/upscale` is in scope
while every other Grok Imagine endpoint is not — the family is defined by what the model does to an
asset you already have, not by whose model it is.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `topaz/image-upscale` | upscale | image | `market/topaz/image-upscale.md` |
| 2 | `recraft/crisp-upscale` | upscale | image | `market/recraft/crisp-upscale.md` |
| 3 | `recraft/remove-background` | background-removal | image | `market/recraft/remove-background.md` |
| 4 | `topaz/video-upscale` | upscale | video | `market/topaz/video-upscale.md` |
| 5 | `grok-imagine/upscale` | upscale | video | `market/grok-imagine/upscale.md` |

## The input-field name changes on every single model

There is no shared convention here. Four models take one asset and each names the field differently;
the fifth takes no asset at all.

| Model | Input field | Type |
|---|---|---|
| `topaz/image-upscale` | `image_url` | URL |
| `recraft/crisp-upscale` | `image` | URL |
| `recraft/remove-background` | `image` | URL |
| `topaz/video-upscale` | `video_url` | URL |
| `grok-imagine/upscale` | `task_id` | **a Kie task id, not a URL** |

`image` versus `image_url` between Topaz and Recraft is the easiest `422` in the catalog to write.

---

# Image

### 1. `topaz/image-upscale`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_url` | string | ✓ | — | — | jpeg/png/webp, max 10.0MB |
| `upscale_factor` | string | ✓ | `'1'` `'2'` `'4'` | `'2'` | **Quoted strings, not integers.** Also **required** — its Topaz video sibling makes the same field optional. |

The field's own description reads "Factor to upscale the **video** by" — copied from the video model.
It applies to the image; the wording is a docs bug, recorded here so nobody re-files it as one.

### 2. `recraft/crisp-upscale`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image` | string | ✓ | — | — | jpeg/png/webp, max 10.0MB |

One parameter, no options. There is no upscale factor — Recraft picks it.

### 3. `recraft/remove-background`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image` | string | ✓ | — | — | PNG/JPG/WEBP. **Max 5MB** (not 10), max 16MP, max dimension 4096px, **min dimension 256px**. |

The only model in the catalog with a documented *minimum* dimension. The 5MB cap is half of every
other image input here.

---

# Video

### 4. `topaz/video-upscale`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `video_url` | string | ✓ | — | — | mp4/quicktime/x-matroska, max 50.0MB |
| `upscale_factor` | string | | `'1'` `'2'` `'4'` | `'2'` | **Optional here**, required on `topaz/image-upscale`. Same enum, same default. |

### 5. `grok-imagine/upscale`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `task_id` | string | ✓ | ≤ 100 chars | — | A task id from a previously successful Kie video generation, **not a URL and not a file** |
| `resolution` | string | | `720p` `1080p` | `720p` | Target resolution |

> **This model takes no asset.** It re-renders a video Kie still holds, addressed by the `taskId` that
> generated it. The doc says only "Must be from a Kie AI video generation model (e.g.,
> `grok-imagine/text-to-video`)" and "Only Kie AI–generated task IDs are supported" — it does **not**
> state whether a Kling, Wan, Seedance, or Veo task id is accepted. The example is a Grok one.
>
> That ambiguity is recorded in the model's `notes` rather than resolved by guessing. Treat a `422`
> here as "the source model is not supported", not as a bad parameter.

Because the input is a task id, this is the one enhance model whose source cannot be uploaded from the
asset library. Kie's own 14-day retention also bounds it: a task id older than that has no video left
to upscale.
