# Kling — 19 video models

Transcribed from `docs.kie.ai`. Every enum, default, and limit below is copied from its doc page.
All models POST to `https://api.kie.ai/api/v1/jobs/createTask` with `{ model, callBackUrl?, input }`.

> **Page slug ≠ model slug.** `kling/v2-5-turbo-text-to-video-pro` is documented at
> `.../kling/v25-turbo-text-to-video-pro.md`, and the Kling 2.6 pages under `.../kling/text-to-video.md`
> serve model `kling-2.6/text-to-video`. Always trust the `model` enum in the page's OpenAPI block.

Shared trait across the family: **`duration` is a quoted string** (`"5"`), except on Kling 3.0 Omni
where it is an **integer** (`5`). Sending the wrong JSON type returns `422`.

| # | Model slug | Capability | Doc page |
|---|---|---|---|
| 1 | `kling-2.6/text-to-video` | text-to-video | `market/kling/text-to-video.md` |
| 2 | `kling-2.6/image-to-video` | image-to-video | `market/kling/image-to-video.md` |
| 3 | `kling/v2-5-turbo-text-to-video-pro` | text-to-video | `market/kling/v25-turbo-text-to-video-pro.md` |
| 4 | `kling/v2-5-turbo-image-to-video-pro` | image-to-video | `market/kling/v25-turbo-image-to-video-pro.md` |
| 5 | `kling/v2-1-master-text-to-video` | text-to-video | `market/kling/v2-1-master-text-to-video.md` |
| 6 | `kling/v2-1-master-image-to-video` | image-to-video | `market/kling/v2-1-master-image-to-video.md` |
| 7 | `kling/v2-1-pro` | image-to-video | `market/kling/v2-1-pro.md` |
| 8 | `kling/v2-1-standard` | image-to-video | `market/kling/v2-1-standard.md` |
| 9 | `kling/ai-avatar-standard` | avatar | `market/kling/ai-avatar-standard.md` |
| 10 | `kling/ai-avatar-pro` | avatar | `market/kling/ai-avatar-pro.md` |
| 11 | `kling-2.6/motion-control` | motion-control | `market/kling/motion-control.md` |
| 12 | `kling-3.0/motion-control` | motion-control | `market/kling/motion-control-v3.md` |
| 13 | `kling-3.0/video` | text-to-video / image-to-video | `market/kling/kling-3-0.md` |
| 14 | `kling/v3-turbo-text-to-video` | text-to-video | `market/kling/v3-turbo-text-to-video.md` |
| 15 | `kling/v3-turbo-image-to-video` | image-to-video | `market/kling/v3-turbo-image-to-video.md` |
| 16 | `kling-3.0-omni/text-to-video` | text-to-video | `market/kling/v3-omni-text-to-video.md` |
| 17 | `kling-3.0-omni/image-to-video` | image-to-video | `market/kling/v3-omni-image-to-video.md` |
| 18 | `kling-3.0-omni/reference-to-video` | reference-to-video | `market/kling/v3-omni-reference-to-video.md` |
| 19 | `kling-3.0-omni/transformation` | video-to-video | `market/kling/v3-omni-transformation.md` |

---

## 1. `kling-2.6/text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 1000 | — | Text prompt |
| `sound` | boolean | ✓ | — | — | Whether the video contains sound |
| `aspect_ratio` | string | ✓ | `'1:1'` `'16:9'` `'9:16'` | `'1:1'` | |
| `duration` | string | ✓ | `'5'` `'10'` | `'5'` | Seconds |

## 2. `kling-2.6/image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 1000 | — | |
| `image_urls` | string[] | ✓ | maxItems **1** | — | jpeg/png, ≤10 MB. Array even though only one is allowed |
| `sound` | boolean | ✓ | — | — | |
| `duration` | string | ✓ | `'5'` `'10'` | `'5'` | |

## 3. `kling/v2-5-turbo-text-to-video-pro`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 2500 | — | |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` `'1:1'` | `'16:9'` | |
| `negative_prompt` | string | | maxLength 2500 | — | |
| `cfg_scale` | number | | 0–1, step 0.1 | `0.5` | Prompt adherence |

## 4. `kling/v2-5-turbo-image-to-video-pro`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 2500 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png, ≤10 MB. First frame |
| `tail_image_url` | string | | — | — | Tail/last frame |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `negative_prompt` | string | | maxLength **500** | — | |
| `cfg_scale` | number | | 0–1, step 0.1 | `0.5` | |

## 5. `kling/v2-1-master-text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` `'1:1'` | `'16:9'` | |
| `negative_prompt` | string | | maxLength 500 | — | |
| `cfg_scale` | number | | 0–1, step 0.1 | `0.5` | |

## 6. `kling/v2-1-master-image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png, ≤10 MB |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `negative_prompt` | string | | maxLength 500 | — | |
| `cfg_scale` | number | | 0–1, step 0.1 | `0.5` | |

## 7. `kling/v2-1-pro`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png, ≤10 MB. First frame |
| `tail_image_url` | string | | — | — | End frame |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `negative_prompt` | string | | maxLength 500 | — | |
| `cfg_scale` | number | | 0–1, step 0.1 | `0.5` | |

## 8. `kling/v2-1-standard`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png, ≤10 MB |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `negative_prompt` | string | | maxLength 500 | — | |
| `cfg_scale` | number | | 0–1, step 0.1 | `0.5` | |

## 9. `kling/ai-avatar-standard` &nbsp;·&nbsp; ## 10. `kling/ai-avatar-pro`

Identical input schemas; the slug alone selects the quality tier.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_url` | string | ✓ | — | — | Avatar image. jpeg/png, ≤10 MB |
| `audio_url` | string | ✓ | — | — | mpeg/wav/x-wav/aac/mp4/ogg. **≤100 MB, ≤5 minutes** |
| `prompt` | string | ✓ | maxLength 5000 | — | |

## 11. `kling-2.6/motion-control`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | | maxLength 2500 | — | |
| `input_urls` | string[] | ✓ | maxItems 1 | — | Subject image: head, shoulders, torso visible. jpeg/png/jpg, ≤10 MB, >300 px, aspect 2:5–5:2 |
| `video_urls` | string[] | ✓ | maxItems 1 | — | Driving video. mp4/quicktime, ≤100 MB, **3–30 s** |
| `character_orientation` | string | ✓ | `image` `video` | `video` | `image` = match the still (max 10 s output); `video` = match the driving video (max 30 s) |
| `mode` | string | ✓ | `720p` `1080p` | `720p` | ⚠️ **Doc conflict** — the enum lists `720p`/`1080p` but the description says "use `std` for 720p or `pro` for 1080p". Sibling `kling-3.0/motion-control` uses `std`/`pro`. Verify against a live call before shipping; treat the enum as authoritative until then. |

## 12. `kling-3.0/motion-control`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | | 0–2500 chars | — | |
| `input_urls` | string[] | ✓ | — | — | One image URL |
| `video_urls` | string[] | ✓ | — | — | One video URL |
| `mode` | string | | `std` `pro` | — | std = 720p, pro = 1080p |
| `character_orientation` | string | | `video` `image` | `video` | `video` recommended |
| `background_source` | string | | `input_video` `input_image` | `input_video` | Which input supplies the background |

## 13. `kling-3.0/video`

Single- and multi-shot generation with named element references.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | cond. | — | — | Applies when `multi_shots` is `false` |
| `image_urls` | string[] | | — | — | 1 item = first frame; 2 items = first + last. Multi-shot supports first frame only. Required when elements are referenced |
| `sound` | boolean | | — | `false` | Defaults to `true` in multi-shot mode |
| `duration` | string | cond. | `'3'`…`'15'` | `'5'` | Total seconds, as a **string** |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` `'1:1'` | `'16:9'` | Auto-adapted when `image_urls` is provided |
| `mode` | string | cond. | `'std'` `'pro'` `'4K'` | `'pro'` | Quality tier |
| `multi_shots` | boolean | cond. | — | `false` | |
| `multi_prompt` | object[] | cond. | max 5 shots | — | Required when `multi_shots` is `true` |
| `kling_elements` | object[] | | maxItems 3 | — | Named elements referenced as `@name` in the prompt |

`multi_prompt[]` — `prompt` (string, ✓, max 500 chars; **each `@element` consumes 37 characters**),
`duration` (integer, ✓, 1–12).

`kling_elements[]` — `name` (string, ✓, referenced as `@name`), `description` (string, ✓),
`element_input_urls` (string[], ✓ — **2–4 images** jpg/png ≤10 MB each, **or exactly 1 video** mp4/mov
with 3–8 s effective length), `element_input_audio_urls` (string[], 5–30 s),
`start_time` (integer, ms, default 0), `end_time` (integer, ms — `end_time - start_time` must be
3000–8000 ms).

**Constraints** — `prompt` XOR `multi_prompt` depending on `multi_shots`; a single element mixes
images or video, never both.

## 14. `kling/v3-turbo-text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 2500 | — | |
| `duration` | string | ✓ | 3–15 s (string; no explicit enum in the doc) | `'5'` | |
| `aspect_ratio` | string | ✓ | `'1:1'` `'9:16'` `'16:9'` | `'16:9'` | |
| `resolution` | string | ✓ | `'720p'` `'1080p'` | `'720p'` | |

## 15. `kling/v3-turbo-image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 2500 | — | |
| `image_urls` | string[] | ✓ | — | — | jpeg/png, ≤10 MB |
| `duration` | string | ✓ | 3–15 s (string; no explicit enum in the doc) | `'5'` | |
| `resolution` | string | ✓ | `'720p'` `'1080p'` | `'720p'` | |

> No `aspect_ratio` on this model — it is inferred from the input image.

---

## Kling 3.0 Omni — models 16–19

The Omni family shares a parameter vocabulary. **`duration` is an integer here**, unlike every other
Kling model. `resolution` gains a `4k` tier. Shot control uses two mutually exclusive booleans.

Shared shot/subject shapes:

`multi_prompt[]` — `prompt` (string, ✓, 1–512 chars), `duration` (integer, ✓, 1–15). Max 6 items.

`elements[]` — `name` (string, ✓, unique per request, referenced as `@name`), `description`
(string, ✓), `element_input_urls` (string[], ✓ — **2–4 images** or **exactly 1 video**, never mixed),
`element_input_audio_urls` (string[], 5–30 s), `start_time` (integer ms, default 0), `end_time`
(integer ms, default 8000; span must be 3000–8000 ms).

Asset limits: images jpg/jpeg/png, ≤50 MB, ≥300 px per side, aspect 0.4–2.5. Videos mp4/mov, ≤200 MB,
3–15.5 s, 700–4553 px, ≤8,294,400 total pixels, aspect 0.4–2, 24–60 fps.

**Shared constraint:** `prefer_multi_shots` is mutually exclusive with `customize_multi_shots` — both
may be `false`, but they cannot both be `true`. `multi_prompt` is required when
`customize_multi_shots` is `true` and must be empty or omitted otherwise.

### 16. `kling-3.0-omni/text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1–3072 chars | — | Must be non-empty after trimming |
| `customize_multi_shots` | boolean | | — | `true` | |
| `prefer_multi_shots` | boolean | | — | — | Mutually exclusive with the above |
| `multi_prompt` | object[] | cond. | maxItems 6 | `[]` | Required when `customize_multi_shots` is `true` |
| `elements` | object[] | | ≤7 multi-image, or ≤3 video-character | `[]` | |
| `audio` | boolean | | — | `false` | |
| `resolution` | string | | `720p` `1080p` `4k` | `720p` | |
| `aspect_ratio` | string | | `16:9` `9:16` `1:1` | `16:9` | |
| `duration` | **integer** | | 3–15 | `5` | |

### 17. `kling-3.0-omni/image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 3072 | — | |
| `image_urls` | string[] | ✓ | exactly 1 **or** exactly 2 | — | 1 = first frame; 2 = first + last frame |
| `duration` | **integer** | | 3,4,5,…,15 | `5` | |
| `resolution` | string | | `720p` `1080p` `4k` | `720p` | |
| `aspect_ratio` | string | | `16:9` `9:16` `1:1` `auto` | `auto` | Explicit ratios selectable **only** with `customize_multi_shots` enabled; otherwise use `auto` |
| `audio` | boolean | | — | — | |
| `customize_multi_shots` | boolean | | — | `false` | |
| `prefer_multi_shots` | boolean | | — | — | Mutually exclusive with the above |
| `multi_prompt` | object[] | cond. | 1–6 items | — | Required when `customize_multi_shots` is `true` |
| `elements` | object[] | | 0–3 subjects | `[]` | |

### 18. `kling-3.0-omni/reference-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 3072 | — | |
| `image_urls` | string[] | cond. | maxItems 7 | — | Reference images. URI pattern `^(https?\|oss)://` |
| `video_urls` | string[] | cond. | maxItems 1 | — | Exactly 1 video when used |
| `duration` | **integer** | | 3–15 | `5` | |
| `resolution` | string | | `720p` `1080p` `4k` | `720p` | |
| `aspect_ratio` | string | cond. | `16:9` `9:16` `1:1` `auto` | `16:9` | `auto` **only** with video-only input; explicit ratios without video or with both |
| `audio` | boolean | cond. | — | — | **Must be `false`** when a reference video is supplied |
| `customize_multi_shots` | boolean | | — | — | |
| `prefer_multi_shots` | boolean | | — | — | Mutually exclusive with the above |
| `multi_prompt` | object[] | cond. | 1–6 items | `[]` | Required when `customize_multi_shots` is `true` |
| `elements` | object[] | | see below | `[]` | |

**Three valid input scenarios:**

| Scenario | Requires | Forces |
|---|---|---|
| No video | `prompt` + `image_urls` | — |
| Video only | `prompt` + `video_urls` | `aspect_ratio: auto`, `audio: false` |
| Video + images | `prompt` + `image_urls` + `video_urls` | `audio: false` |

**Subject limits by configuration:** no video + multi-image only → images + subjects ≤7; no video,
mixed types → video-character ≤3 and images + subjects ≤4; with video, multi-image only → combined ≤4;
with video, video-character only → ≤1 subject. "Video character subjects cannot be used together with
multi-image subjects or reference images" when a video is provided.

### 19. `kling-3.0-omni/transformation`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1–3072 chars | — | |
| `video_urls` | string[] | ✓ | exactly 1 | — | Source video to transform |
| `image_urls` | string[] | | maxItems 4 | — | Reference images; combined with multi-image subjects, 4 total max |
| `duration` | string | | — | — | Configurable only when using video **with** images |
| `resolution` | string | | `'720p'` `'1080p'` `'4k'` | `'720p'` | |
| `aspect_ratio` | string | | `'auto'` `'16:9'` `'9:16'` `'1:1'` | `'16:9'` | `auto` only with video-only input |
| `audio` | boolean | | — | — | |
| `elements` | object[] | | ≤7 multi-image only; ≤3 video characters; mixed = 3 video + 4 multi-image | `[]` | |

**Constraint:** "Video character subjects cannot be used together with multi-image subjects or
reference images."
