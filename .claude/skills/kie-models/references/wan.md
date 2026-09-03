# Wan — 20 models (18 video + 2 image)

Transcribed from `docs.kie.ai`. All models POST to `https://api.kie.ai/api/v1/jobs/createTask`.

Three parameter dialects live in this family — do not carry a field name across generations:

| Generation | Aspect field | Duration type | Prompt-rewrite field |
|---|---|---|---|
| 2.2 A14B | `aspect_ratio` | n/a (frame count) | `enable_prompt_expansion` |
| 2.5 | `aspect_ratio` | **string** `"5"`/`"10"` | `enable_prompt_expansion` |
| 2.6 / 2.6-flash | none (from input) | **string** `"5"`/`"10"`/`"15"` | none |
| 2.7 | `ratio` on t2v, `aspect_ratio` elsewhere | **integer** | `prompt_extend` |
| 3.0 | `aspect_ratio` | **integer** | none |

`resolution` casing also flips: 2.x uses lowercase `720p`, **3.0 uses uppercase `720P`**.

| # | Model slug | Capability | Doc page |
|---|---|---|---|
| 1 | `wan/2-2-a14b-text-to-video-turbo` | text-to-video | `market/wan/2-2-a14b-text-to-video-turbo.md` |
| 2 | `wan/2-2-a14b-image-to-video-turbo` | image-to-video | `market/wan/2-2-a14b-image-to-video-turbo.md` |
| 3 | `wan/2-2-a14b-speech-to-video-turbo` | speech-to-video | `market/wan/2-2-a14b-speech-to-video-turbo.md` |
| 4 | `wan/2-2-animate-move` | video-to-video | `market/wan/2-2-animate-move.md` |
| 5 | `wan/2-2-animate-replace` | video-to-video | `market/wan/2-2-animate-replace.md` |
| 6 | `wan/2-5-text-to-video` | text-to-video | `market/wan/2-5-text-to-video.md` |
| 7 | `wan/2-5-image-to-video` | image-to-video | `market/wan/2-5-image-to-video.md` |
| 8 | `wan/2-6-text-to-video` | text-to-video | `market/wan/2-6-text-to-video.md` |
| 9 | `wan/2-6-image-to-video` | image-to-video | `market/wan/2-6-image-to-video.md` |
| 10 | `wan/2-6-video-to-video` | video-to-video | `market/wan/2-6-video-to-video.md` |
| 11 | `wan/2-6-flash-image-to-video` | image-to-video | `market/wan/2-6-flash-image-to-video.md` |
| 12 | `wan/2-6-flash-video-to-video` | video-to-video | `market/wan/2-6-flash-video-to-video.md` |
| 13 | `wan/2-7-text-to-video` | text-to-video | `market/wan/2-7-text-to-video.md` |
| 14 | `wan/2-7-image-to-video` | image-to-video | `market/wan/2-7-image-to-video.md` |
| 15 | `wan/2-7-videoedit` | video-to-video | `market/wan/2-7-videoedit.md` |
| 16 | `wan/2-7-r2v` | reference-to-video | `market/wan/2-7-r2v.md` |
| 17 | `wan/3-0-video` | multi-modal video | `market/wan/3-0-video.md` |
| 18 | `wan/3-0-video-prime` | multi-modal video | `market/wan/3-0-video-prime.md` |
| 19 | `wan/2-7-image` | text-to-image / image-to-image | `market/wan/2-7-image.md` |
| 20 | `wan/2-7-image-pro` | text-to-image / image-to-image | `market/wan/2-7-image-pro.md` |

---

## Wan 2.2 A14B Turbo (models 1–3)

The only Wan models exposing raw diffusion controls (`num_inference_steps`, `guidance_scale`, `shift`)
and frame-count timing rather than seconds.

### 1. `wan/2-2-a14b-text-to-video-turbo`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `resolution` | string | | `'480p'` `'720p'` | `'720p'` | |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` | `'16:9'` | Only two options |
| `enable_prompt_expansion` | boolean | | — | — | LLM prompt expansion |
| `seed` | number | | 0–2147483647 | `0` | |
| `acceleration` | string | | `'none'` `'regular'` | `'none'` | Faster but lower quality; `none` recommended |
| `nsfw_checker` | boolean | | — | `false` | |

### 2. `wan/2-2-a14b-image-to-video-turbo`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `image_url` | string | ✓ | — | — | jpeg/png/webp ≤10 MB. Resized and center-cropped to the aspect ratio |
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `resolution` | string | | `'480p'` `'720p'` | `'720p'` | |
| `enable_prompt_expansion` | boolean | | — | — | |
| `seed` | number | | 0–2147483647 | `0` | |
| `acceleration` | string | | `'none'` `'regular'` | `'none'` | |
| `nsfw_checker` | boolean | | — | `false` | |

### 3. `wan/2-2-a14b-speech-to-video-turbo`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `image_url` | string | ✓ | — | — | jpeg/png/webp, ≤10 MB |
| `audio_url` | string | ✓ | — | — | mp3/wav/ogg/m4a/flac/aac/wma/mpeg, ≤10 MB |
| `num_frames` | number | | 40–120, **step 4** | `80` | Must be a multiple of 4 |
| `frames_per_second` | number | | 4–60, step 1 | `16` | Final fps may shift with interpolation |
| `resolution` | string | | `'480p'` `'580p'` `'720p'` | `'480p'` | `580p` is unique to the Animate/speech models |
| `negative_prompt` | string | | maxLength 500 | — | |
| `seed` | integer | | — | — | |
| `num_inference_steps` | number | | 2–40, step 1 | `27` | |
| `guidance_scale` | number | | 1–10, step 0.1 | `3.5` | |
| `shift` | number | | 1–10, step 0.1 | `5` | |
| `nsfw_checker` | boolean | | — | `false` | |

> Output length is `num_frames / frames_per_second` seconds — the UI should show the derived duration
> live, since neither field is expressed in seconds.

## Wan Animate (models 4–5)

### 4. `wan/2-2-animate-move` &nbsp;·&nbsp; ### 5. `wan/2-2-animate-replace`

Identical schemas. **Move** transfers the video's motion onto the image's character; **replace**
swaps the character in the video for the one in the image.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `video_url` | string | ✓ | — | — | mp4/quicktime/x-matroska, **≤10 MB** |
| `image_url` | string | ✓ | — | — | jpeg/png/webp, ≤10 MB. Resized and center-cropped |
| `resolution` | string | | `'480p'` `'580p'` `'720p'` | `'480p'` | |
| `nsfw_checker` | boolean | | — | `false` | |

> No prompt on either model. The 10 MB video ceiling is low — expect to compress source clips.

## Wan 2.5 (models 6–7)

Shortest prompt limit in the family (800 characters) and the only Wan generation where `duration` is
required with no default.

### 6. `wan/2-5-text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength **800** | — | |
| `duration` | string | ✓ | `'5'` `'10'` | — | No documented default |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` `'1:1'` | — | No documented default |
| `resolution` | string | | `'720p'` `'1080p'` | — | No documented default |
| `negative_prompt` | string | | maxLength 500 | — | |
| `enable_prompt_expansion` | boolean | | — | — | |
| `seed` | integer | | — | — | |
| `nsfw_checker` | boolean | | — | `false` | |

### 7. `wan/2-5-image-to-video`

Same as #6, with `image_url` (string, ✓, jpeg/png/webp ≤10 MB, publicly accessible, used as the first
frame) replacing `aspect_ratio`.

## Wan 2.6 (models 8–12)

Adds `multi_shots`. No aspect-ratio control anywhere in this generation — output framing follows the
input. `duration` is a string.

### 8. `wan/2-6-text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1–5000 chars | — | Chinese and English |
| `duration` | string | | `'5'` `'10'` `'15'` | `'5'` | |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `multi_shots` | boolean | | — | `false` | Single continuous shot vs. multiple shots with transitions |
| `nsfw_checker` | boolean | | — | `false` | |

### 9. `wan/2-6-image-to-video`

Same as #8 plus `image_urls` (string[], ✓, **maxItems 1**, jpeg/png/webp ≤10 MB, min 256×256 px).
Prompt minimum is 2 characters.

### 10. `wan/2-6-video-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 2–5000 chars | — | |
| `video_urls` | string[] | ✓ | maxItems **3** | — | mp4/quicktime/x-matroska, ≤10 MB |
| `duration` | string | | `'5'` `'10'` | `'5'` | **No `'15'`** on video-to-video |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `multi_shots` | boolean | | — | `false` | |
| `nsfw_checker` | boolean | | — | `false` | |

### 11. `wan/2-6-flash-image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength **1500** | — | Flash caps prompts much lower than standard 2.6 |
| `image_urls` | string[] | ✓ | maxItems 1 | — | Min 256×256 px |
| `duration` | string | | `'5'` `'10'` `'15'` | `'5'` | |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `audio` | boolean | ✓ | — | — | **Required.** "Audio directly affects the cost" |
| `multi_shots` | boolean | | — | — | |
| `nsfw_checker` | boolean | | — | `false` | |

### 12. `wan/2-6-flash-video-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 1500 | — | |
| `video_urls` | string[] | ✓ | maxItems 3 | — | mp4/quicktime/x-matroska, ≤10 MB |
| `duration` | string | | `'5'` `'10'` | `'5'` | |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `audio` | boolean | | — | — | Optional here, unlike flash image-to-video. Affects pricing |
| `multi_shots` | boolean | | — | — | |
| `nsfw_checker` | boolean | | — | `false` | |

## Wan 2.7 video (models 13–16)

Integer `duration`, `prompt_extend` instead of `enable_prompt_expansion`, and a `watermark` toggle
that stamps "AI generated" in the lower-right corner.

### 13. `wan/2-7-text-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | 1–5000 chars | — | |
| `negative_prompt` | string | | 0–500 chars | — | |
| `audio_url` | string | | — | — | Custom audio track |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `ratio` | string | | `'16:9'` `'9:16'` `'1:1'` `'4:3'` `'3:4'` | `'16:9'` | ⚠️ Field is **`ratio`**, not `aspect_ratio` — unique to this model |
| `duration` | **integer** | | 2–15 | `5` | |
| `prompt_extend` | boolean | | — | `true` | |
| `watermark` | boolean | | — | `false` | |
| `seed` | integer | | 0–2147483647 | — | |
| `nsfw_checker` | boolean | | — | `false` | |

### 14. `wan/2-7-image-to-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `negative_prompt` | string | | maxLength 500 | — | |
| `first_frame_url` | string | | — | — | |
| `last_frame_url` | string | | — | — | |
| `first_clip_url` | string | | — | — | Video-continuation mode |
| `driving_audio_url` | string | | — | — | Audio-guided motion |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `duration` | **integer** | | 2–15 | `5` | |
| `prompt_extend` | boolean | | — | `true` | |
| `watermark` | boolean | | — | `false` | |
| `seed` | integer | | 0–2147483647 | — | |
| `nsfw_checker` | boolean | | — | `false` | |

**Three modes, one per invocation:** first-frame → `first_frame_url` only; first-and-last-frame →
both frame fields; video continuation → `first_clip_url`. Provide exactly one mode's inputs.

### 15. `wan/2-7-videoedit`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | | maxLength 5000 | — | Optional on this model |
| `negative_prompt` | string | | maxLength 500 | — | |
| `video_url` | string | ✓ | — | — | mp4/mov, **2–10 s**, 240–4096 px, aspect 1:8–8:1, ≤100 MB |
| `reference_image` | string | | — | — | Character / clothing / style guidance. jpeg/jpg/png/bmp/webp, 240–8000 px |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | 1080p costs more |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` `'1:1'` `'4:3'` `'3:4'` | — | Omit to follow the input's ratio |
| `duration` | integer | | `0`, or 2–10 | `0` | **`0` = full input duration, no truncation** |
| `audio_setting` | string | | `'auto'` `'origin'` | `'auto'` | `origin` forces keeping the source audio |
| `prompt_extend` | boolean | | — | `true` | |
| `watermark` | boolean | | — | `false` | |
| `seed` | integer | | 0–2147483647 | — | |
| `nsfw_checker` | boolean | | — | `false` | |

### 16. `wan/2-7-r2v`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | |
| `negative_prompt` | string | | maxLength 500 | — | |
| `reference_image` | string[] | cond. | maxItems 5 | — | **Array**, despite the singular name |
| `reference_video` | string[] | cond. | maxItems 5 | — | **Array**, despite the singular name |
| `first_frame` | string | | 1 URI | — | When supplied, `aspect_ratio` is **ignored** |
| `reference_voice` | string | | 1 URI | — | wav/mp3, 1–10 s, ≤15 MB. Sets the subject's voice timbre |
| `resolution` | string | | `'720p'` `'1080p'` | `'1080p'` | |
| `aspect_ratio` | string | | `'16:9'` `'9:16'` `'1:1'` `'4:3'` `'3:4'` | `'16:9'` | Ignored if `first_frame` is set |
| `duration` | integer | | 2–10 | `5` | |
| `prompt_extend` | boolean | | — | `true` | |
| `watermark` | boolean | | — | `false` | |
| `seed` | integer | | 0–2147483647 | auto | |
| `nsfw_checker` | boolean | | — | `false` | |

**Constraint:** at least one of `reference_image` or `reference_video` is required.

## Wan 3.0 (models 17–18)

The widest input surface of any in-scope model — images, video, audio, documents, and web links all
feed the same endpoint. Note the **uppercase** resolution enum.

### 17. `wan/3-0-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength **20000** | — | Excess is truncated automatically. In reference mode, address inputs as Image1 / Video1 / Audio1 |
| `first_frame_url` | object | | 1 image | — | jpeg/jpg/png/bmp/webp, 240–8000 px, aspect ≤8:1, ≤20 MB |
| `last_frame_url` | object | | 1 image | — | Same specs |
| `reference_image_urls` | string[] | | maxItems 10 | — | All-purpose reference mode |
| `reference_video_urls` | string[] | | maxItems 5 | — | 1–15 s each, total ≤15 s, mp4/mov, 240–4096 px, aspect ≤8:1, ≤100 MB each |
| `reference_audio_urls` | string[] | | maxItems 5 | — | 1–15 s each, total ≤15 s, wav/mp3, ≤15 MB |
| `reference_file_urls` | string[] | | maxItems 1 | — | docx/doc/xlsx/xls/pptx/ppt/pdf/txt/key/pages/numbers/md, ≤100 MB, ≤50 pages |
| `reference_link_urls` | string[] | | maxItems 1 | — | One public webpage, no login required |
| `resolution` | string | | `480P` `720P` `1080P` | `1080P` | **Uppercase P** |
| `aspect_ratio` | string | | `adaptive` `16:9` `4:3` `1:1` `3:4` `9:16` | `adaptive` | |
| `duration` | integer | | 2–30, or `-1` | `5` | `-1` = model decides. Input video duration + `duration` must total ≤30 s |
| `audio` | boolean | | — | `true` | |
| `seed` | integer | | 0–2147483647 | — | |

**Constraints, quoted:**
- `first_frame_url` / `last_frame_url` "cannot be provided together with `reference_*_urls`".
- `reference_file_urls` and `reference_link_urls` "cannot be provided together with the
  first-frame/last-frame parameters".
- `reference_link_urls` "cannot be provided together with `reference_file_urls`".

### 18. `wan/3-0-video-prime`

Same schema as #17 plus `nsfw_checker` (boolean, default `false`), which the standard model's page
does not document. Same constraints.

---

# Wan image (models 19–20)

### 19. `wan/2-7-image` &nbsp;·&nbsp; ### 20. `wan/2-7-image-pro`

Identical schemas; the slug selects the quality tier. Both handle text-to-image and image editing
through the same endpoint — supplying `input_urls` switches it to edit mode.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | maxLength 5000 | — | Chinese and English |
| `input_urls` | string[] | | maxItems 9 | — | Presence switches to edit mode |
| `aspect_ratio` | string | | `'1:1'` `'16:9'` `'4:3'` `'21:9'` `'3:4'` `'9:16'` `'8:1'` `'1:8'` | — | Applies only with no image input. Widest ratio set of any in-scope model |
| `enable_sequential` | boolean | | — | `false` | Sequential / group image mode |
| `n` | integer | | **1–4** normally, **1–12** when sequential | `4` | Number of images |
| `resolution` | string | | `'1K'` `'2K'` `'4K'` | `'2K'` | **4K only for text-to-image in standard mode.** `input_urls` or `enable_sequential` caps it at 2K |
| `thinking_mode` | boolean | | — | `false` | **Unavailable** when `enable_sequential` is true or `input_urls` is set |
| `color_palette` | object[] | | 3–10 items | — | `{ hex, ratio }`, **both required** — `{"hex":"#C2D1E6","ratio":"23.51%"}`. `hex` matches `^#[0-9A-Fa-f]{6}$`, `ratio` matches `^\d{1,3}\.\d{2}%$` (two decimals, `23.5%` is rejected). **Unavailable** when `enable_sequential` is true |
| `bbox_list` | array[][] | | max 2 boxes **per image** | — | Interactive editing regions. Outer list length must match `input_urls`, one entry per image in the same order; each entry holds up to 2 boxes of `[x1, y1, x2, y2]` integers. `[[]]` leaves an image unboxed |
| `watermark` | boolean | | — | `false` | |
| `seed` | integer | | 0–2147483647 | `0` | |
| `nsfw_checker` | boolean | | — | `false` | |

**Constraints:** `thinking_mode` conflicts with both `enable_sequential` and `input_urls`;
`color_palette` conflicts with `enable_sequential`; `n`'s upper bound depends on `enable_sequential`
(and so does Kie's own default — 4 outside it, 12 inside); `bbox_list` requires `input_urls` and its
length must match; `aspect_ratio` is inert once `input_urls` is present; `resolution` drops to
`1K`/`2K` once `input_urls` is set or `enable_sequential` is on.

> **The resolution ceiling is enforced at create time, and the doc no longer says so.** A payload with
> `resolution: '4K'` and a non-empty `input_urls` is refused by `createTask` itself with
> `{"code":500,"msg":"resolution is not within the range of allowed options"}` — observed live, on
> `wan/2-7-image`. The current revision of `market/wan/2-7-image.md` describes `resolution` as nothing
> more than "Output resolution… a wrapper field", having dropped the mode wording this table recorded
> from an earlier revision. **Do not "correct" this row against the live page** — the restriction is
> real and the page is the thing that is out of date. The `enable_sequential` half is transcribed from
> that earlier revision and has not been re-confirmed against the API.
>
> Both halves are now encoded as `allowedValuesWhen`, and `aspect_ratio` as `forbiddenWhen`, so the
> form narrows the controls instead of shipping a request that cannot succeed.

> **`aspect_ratio` being *ignored* is worse than being rejected.** In edit mode Kie takes the shape
> from the input image and returns a `200`, so a run submitted as `9:16` comes back landscape with
> nothing anywhere explaining it. `wan/2-7-r2v` behaves the same way once `first_frame` is set. Both
> now disable the control and say why.

**Two shapes worth re-reading before transcribing.** `color_palette` is objects, not strings, and
`bbox_list` is doubly nested. Both look like the simpler thing in a summary and fail as a 422.
