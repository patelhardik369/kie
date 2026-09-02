# ByteDance — 20 models (10 Seedance video + 10 Seedream image)

Transcribed from `docs.kie.ai`. All models POST to `https://api.kie.ai/api/v1/jobs/createTask`.

> **Slug prefixes are inconsistent and must be copied exactly.** Video models and the two oldest image
> models use the `bytedance/` prefix; Seedream 4.5 and 5.x use a bare `seedream/` prefix. Version
> punctuation also varies: `bytedance/seedance-1.5-pro` (dot) versus `bytedance/seedance-2-5` (dash)
> versus `seedream/4.5-edit` (dot). These are not typos.

| # | Model slug | Capability | Doc page |
|---|---|---|---|
| 1 | `bytedance/seedance-2` | text/image/reference-to-video | `market/bytedance/seedance-2.md` |
| 2 | `bytedance/seedance-2-fast` | text/image/reference-to-video | `market/bytedance/seedance-2-fast.md` |
| 3 | `bytedance/seedance-2-mini` | text/image/reference-to-video | `market/bytedance/seedance-2-mini.md` |
| 4 | `bytedance/seedance-2-5` | text/image/reference-to-video | `market/bytedance/seedance-2-5.md` |
| 5 | `bytedance/seedance-1.5-pro` | text-to-video / image-to-video | `market/bytedance/seedance-1-5-pro.md` |
| 6 | `bytedance/v1-pro-text-to-video` | text-to-video | `market/bytedance/v1-pro-text-to-video.md` |
| 7 | `bytedance/v1-pro-image-to-video` | image-to-video | `market/bytedance/v1-pro-image-to-video.md` |
| 8 | `bytedance/v1-pro-fast-image-to-video` | image-to-video | `market/bytedance/v1-pro-fast-image-to-video.md` |
| 9 | `bytedance/v1-lite-text-to-video` | text-to-video | `market/bytedance/v1-lite-text-to-video.md` |
| 10 | `bytedance/v1-lite-image-to-video` | image-to-video | `market/bytedance/v1-lite-image-to-video.md` |
| 11 | `bytedance/seedream` | text-to-image | `market/seedream/seedream.md` |
| 12 | `bytedance/seedream-v4-text-to-image` | text-to-image | `market/seedream/seedream-v4-text-to-image.md` |
| 13 | `bytedance/seedream-v4-edit` | image-to-image | `market/seedream/seedream-v4-edit.md` |
| 14 | `seedream/4.5-text-to-image` | text-to-image | `market/seedream/4-5-text-to-image.md` |
| 15 | `seedream/4.5-edit` | image-to-image | `market/seedream/4-5-edit.md` |
| 16 | `seedream/5-lite-text-to-image` | text-to-image | `market/seedream/5-lite-text-to-image.md` |
| 17 | `seedream/5-lite-image-to-image` | image-to-image | `market/seedream-5-lite-image-to-image.md` |
| 18 | `seedream/5-pro-text-to-image` | text-to-image | `market/seedream/5-pro-text-to-image.md` |
| 19 | `seedream/5-pro-image-to-image` | image-to-image | `market/seedream/5-pro-image-to-image.md` |
| 20 | `seedream/5-pro-layer-decomposition` | layer-decomposition | `market/seedream/5-pro-layer-decomposition.md` |

---

# Seedance — video

## Seedance 2.x family (models 1–4)

All four share one schema and one hard constraint.

> **Mutual exclusion, quoted from the docs:** "**Image-to-Video (First Frame)**, **Image-to-Video
> (First & Last Frames)**, and **Multimodal Reference-to-Video** (including reference images, videos,
> and audio) are three mutually exclusive scenarios and **cannot be used simultaneously**."
>
> In practice: `first_frame_url` (+ optional `last_frame_url`) **XOR** any `reference_*_urls`.
> `last_frame_url` additionally requires `first_frame_url`.

Multimodal reference-to-video can approximate first/last-frame behavior by naming reference images as
the first or last frame in the prompt — but when the frames must match exactly, use the dedicated
first-and-last-frame path.

Image URLs also accept the `asset://{assetId}` form in addition to plain URLs.

### 1. `bytedance/seedance-2`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 3–20000 chars | — | |
| `first_frame_url` | string | | — | — | URL or `asset://{assetId}` |
| `last_frame_url` | string | | — | — | Requires `first_frame_url` |
| `reference_image_urls` | string[] | | maxItems **9** | — | jpeg/png/webp/bmp/tiff/gif, aspect 0.4–2.5, 300–6000 px, <30 MB each |
| `reference_video_urls` | string[] | | maxItems **3** | — | mp4/mov, 480–720p, 2–15 s each, total ≤15 s, 409600–927408 px, <50 MB, 24–60 fps |
| `reference_audio_urls` | string[] | | maxItems **3** | — | wav/mp3, 2–15 s each, total ≤15 s, <15 MB each |
| `return_last_frame` | boolean | | — | `false` | Deprecated |
| `generate_audio` | boolean | | — | **`true`** | Increases cost |
| `resolution` | string | | `480p` `720p` `1080p` `4k` | `720p` | |
| `aspect_ratio` | string | | `1:1` `4:3` `3:4` `16:9` `9:16` `21:9` `adaptive` | `16:9` | |
| `duration` | **integer** | | 4–15 | `5` | |
| `web_search` | boolean | | — | — | Text-to-video only |
| `nsfw_checker` | boolean | | — | `false` | |

### 2. `bytedance/seedance-2-fast`

Identical to Seedance 2.0 except:

| field | difference |
|---|---|
| `resolution` | `480p` `720p` only (no 1080p / 4k), default `720p` |

### 3. `bytedance/seedance-2-mini`

Identical to Seedance 2.0 Fast except `return_last_frame` is not documented on this model.

| field | difference |
|---|---|
| `resolution` | `480p` `720p` only, default `720p` |
| `return_last_frame` | not present |

### 4. `bytedance/seedance-2-5`

The long-form variant — bigger prompt, more references, longer output.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength **30000** | — | |
| `first_frame_url` | string | | — | — | Exclusive with `reference_*_urls` |
| `last_frame_url` | string | | — | — | Requires `first_frame_url` |
| `reference_image_urls` | string[] | | maxItems **30** | — | Aspect 0.4–2.5, 300–6000 px, <30 MB each |
| `reference_video_urls` | string[] | | maxItems **10** | — | mp4/mov, 480p/720p, 2–**30** s, total ≤30 s, <200 MB |
| `reference_audio_urls` | string[] | | maxItems **10** | — | wav/mp3, 2–30 s, total ≤30 s, <15 MB each |
| `return_last_frame` | boolean | | — | `false` | |
| `generate_audio` | boolean | | — | `true` | Increases cost |
| `resolution` | string | | `480p` `720p` `1080p` | `720p` | No 4k |
| `aspect_ratio` | string | | `1:1` `4:3` `3:4` `16:9` `9:16` `21:9` `adaptive` | **`adaptive`** | |
| `duration` | integer | | 4–**30**, or `-1` | `5` | `-1` = model chooses |
| `output_format` | string | | `mp4` `mov` | `mp4` | Only Seedance model with this field |
| `web_search` | boolean | | — | — | |
| `nsfw_checker` | boolean | | — | `false` | |

### 5. `bytedance/seedance-1.5-pro`

A different schema from the 2.x line — image input is a single `input_urls` array of 0–2 images, not
named frames.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 3–20000 chars | — | |
| `input_urls` | string[] | | **0–2 items** | — | jpeg/png/webp, 10 MB each. 1 = first frame; 2 = first + last |
| `aspect_ratio` | string | ✓ | `1:1` `4:3` `3:4` `16:9` `9:16` `21:9` | `1:1` | No `adaptive` on this model |
| `resolution` | string | | `480p` `720p` `1080p` | `720p` | |
| `duration` | number | ✓ | 4–12 | — | No documented default |
| `fixed_lens` | boolean | | — | `false` | Locks the camera for static shots |
| `generate_audio` | boolean | | — | **`false`** | "Enabling audio will increase the generation cost" |
| `nsfw_checker` | boolean | | — | `false` | |

## Seedance V1 family (models 6–10)

Older generation. `duration` is a **string** here, unlike the 2.x line's integer.

### 6. `bytedance/v1-pro-text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 10000 | — | |
| `aspect_ratio` | string | | `'21:9'` `'16:9'` `'4:3'` `'1:1'` `'3:4'` `'9:16'` | `'16:9'` | |
| `resolution` | string | | `'480p'` `'720p'` `'1080p'` | `'720p'` | |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `camera_fixed` | boolean | | — | — | |
| `seed` | number | | -1 – 2147483647 | `-1` | `-1` = random |
| `enable_safety_checker` | boolean | | — | — | Always on in Playground; API-only override |
| `nsfw_checker` | boolean | | — | `false` | |

### 7. `bytedance/v1-pro-image-to-video`

Same as #6 with `image_url` (string, ✓, jpeg/png/webp ≤10 MB) replacing `aspect_ratio`.

### 8. `bytedance/v1-pro-fast-image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 10000 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png/webp, ≤10 MB |
| `resolution` | string | | `'720p'` `'1080p'` | `'720p'` | **No 480p** despite the description mentioning it |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `nsfw_checker` | boolean | | — | `false` | |

> No `seed`, `camera_fixed`, or `enable_safety_checker` on this model.

### 9. `bytedance/v1-lite-text-to-video`

Same as #6 except:

| field | difference |
|---|---|
| `aspect_ratio` | `'16:9'` `'4:3'` `'1:1'` `'3:4'` `'9:16'` **`'9:21'`** (no `21:9`; adds `9:21`), default `'16:9'` |
| `seed` | integer; no documented default |

### 10. `bytedance/v1-lite-image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 10000 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png/webp, ≤10 MB |
| `end_image_url` | string | | — | — | Optional end frame — unique to this V1 model |
| `resolution` | string | | `'480p'` `'720p'` `'1080p'` | `'720p'` | |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `camera_fixed` | boolean | | — | — | |
| `seed` | number | | -1 – 2147483647 | `-1` | |
| `enable_safety_checker` | boolean | | — | — | |
| `nsfw_checker` | boolean | | — | `false` | |

---

# Seedream — image

Two sizing vocabularies exist and must not be mixed:

- **3.0 / 4.0** use `image_size` (named presets like `square_hd`) plus `image_resolution` (`1K`/`2K`/`4K`).
- **4.5 / 5.x** use `aspect_ratio` (`'16:9'` style) plus `quality` (`basic`/`high`/`ultra`), where the
  resolution each quality tier maps to **differs per model** — see each table.

### 11. `bytedance/seedream` (Seedream 3.0)

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `image_size` | string | | `square` `square_hd` `portrait_4_3` `portrait_16_9` `landscape_4_3` `landscape_16_9` | `square_hd` | |
| `guidance_scale` | number | | 1–10, step 0.1 | `2.5` | Prompt adherence |
| `seed` | integer | | — | — | |

### 12. `bytedance/seedream-v4-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `image_size` | string | | `square` `square_hd` `portrait_4_3` `portrait_3_2` `portrait_16_9` `landscape_4_3` `landscape_3_2` `landscape_16_9` `landscape_21_9` | `square_hd` | Wider set than 3.0 |
| `image_resolution` | string | | `1K` `2K` `4K` | `1K` | Combines with `image_size` to set final pixels |
| `max_images` | number | | 1–6 | `1` | Multiple outputs in one run |
| `seed` | integer | | — | — | |
| `nsfw_checker` | boolean | | — | `false` | |

### 13. `bytedance/seedream-v4-edit`

Same as #12 plus:

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_urls` | string[] | ✓ | maxItems **10** | — | jpeg/png/webp, ≤30 MB each |

### 14. `seedream/4.5-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 3000 | — | |
| `aspect_ratio` | string | ✓ | `'1:1'` `'4:3'` `'3:4'` `'16:9'` `'9:16'` `'2:3'` `'3:2'` `'21:9'` | `'1:1'` | |
| `quality` | string | ✓ | `'basic'` `'high'` | `'basic'` | basic → 2K, high → 4K |
| `nsfw_checker` | boolean | | — | `false` | |

> No `seed` and no `output_format` on either 4.5 model.

### 15. `seedream/4.5-edit`

Same as #14 plus:

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_urls` | string[] | ✓ | maxItems **14** | — | jpeg/png/webp, ≤30 MB each |

### 16. `seedream/5-lite-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 3–3000 chars | — | |
| `aspect_ratio` | string | ✓ | `'1:1'` `'4:3'` `'3:4'` `'16:9'` `'9:16'` `'2:3'` `'3:2'` `'21:9'` | `'1:1'` | |
| `quality` | string | ✓ | `'basic'` `'high'` `'ultra'` | `'basic'` | basic → 2K, high → 3K, ultra → 4K |
| `output_format` | string | | `'png'` `'jpeg'` | `'png'` | |
| `nsfw_checker` | boolean | | — | `false` | |

### 17. `seedream/5-lite-image-to-image`

Same as #16 plus `image_urls` (string[], ✓, maxItems **14**, jpeg/png/webp ≤30 MB each).

> Doc page lives at `market/seedream-5-lite-image-to-image.md` — **outside** the `seedream/`
> directory, unlike every sibling. Do not "correct" the path.

### 18. `seedream/5-pro-text-to-image`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 3–5000 chars | — | Longer than Lite's 3000 |
| `aspect_ratio` | string | ✓ | `'1:1'` `'4:3'` `'3:4'` `'16:9'` `'9:16'` `'2:3'` `'3:2'` `'21:9'` | `'1:1'` | |
| `quality` | string | ✓ | `'basic'` `'high'` | `'basic'` | ⚠️ basic → **1K**, high → **2K** — Pro's tiers resolve *lower* than Lite's. Not a transcription error |
| `output_format` | string | | `'png'` `'jpeg'` | `'png'` | |
| `nsfw_checker` | boolean | | — | `false` | |

### 19. `seedream/5-pro-image-to-image`

Same as #18 plus `image_urls` (string[], ✓, maxItems **10** — fewer than Lite's 14, jpeg/png/webp
≤30 MB each).

### 20. `seedream/5-pro-layer-decomposition`

Splits one image into named, z-ordered layers. The only in-scope model returning `resultObject`
alongside `resultUrls`.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | | 0–5000 chars | — | Optional. Names which elements to separate; auto-detects when omitted. Supports `<bbox>x1 y1 x2 y2</bbox>` with normalized 0–1000 coordinates |
| `image_url` | string | ✓ | — | — | png/jpeg/webp/bmp/tiff/gif (**not** heic/heif), ≤30 MB, 262,144–36,000,000 px, aspect 1:16–16:1 |
| `size` | string | | `'auto'` `'1K'` `'1.5K'` `'2K'` | `'auto'` | |
| `output_format` | string | | `'png'` `'jpeg'` | **`'jpeg'`** | Base image only — separated layers always output PNG |

**Output shape** — `resultJson` parses to:

```json
{
  "resultObject": {
    "layers_data": [
      { "z_index": 0, "size": "1080x1080", "output_format": "png",
        "bounding_box": { "absolute": [0,0,0,0], "normalized": [0,0,0,0] },
        "name": "...", "description": "...", "url": "..." }
    ]
  },
  "resultUrls": ["..."]
}
```

The asset downloader must walk `layers_data[].url` and persist `z_index`, `name`, and `bounding_box`
per layer — `resultUrls` alone loses the layer ordering and labels that make this model useful.
