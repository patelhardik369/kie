# Google — 14 models (5 video + 8 image + 1 audio)

Transcribed from `docs.kie.ai`. **13 of the 14 POST to `https://api.kie.ai/api/v1/jobs/createTask`
with the model-specific fields nested under `input`. Veo does not** — see the Veo section.

> **Slug prefixes are inconsistent and must be copied exactly.** Imagen 4, Nano Banana 1, Gemini Omni
> 1.1 Flash, and Gemini TTS carry a `google/` prefix. Nano Banana 2, 2 Lite, Pro, and Gemini Omni
> Video carry **no prefix at all**. Veo's slug is its `model` field value (`veo3`, `veo3_fast`,
> `veo3_lite`), which uses underscores where the rest of the catalog uses hyphens. These are not typos.
>
> **Doc page paths do not predict slugs.** `market/google/nanobanana2.md` serves `nano-banana-2`;
> `market/google/pro-image-to-image.md` serves `nano-banana-pro`.

| # | Model slug | Capability | Out | Doc page |
|---|---|---|---|---|
| 1 | `google/imagen4` | text-to-image | image | `market/google/imagen4.md` |
| 2 | `google/imagen4-fast` | text-to-image | image | `market/google/imagen4-fast.md` |
| 3 | `google/imagen4-ultra` | text-to-image | image | `market/google/imagen4-ultra.md` |
| 4 | `google/nano-banana` | text-to-image | image | `market/google/nano-banana.md` |
| 5 | `google/nano-banana-edit` | image-to-image | image | `market/google/nano-banana-edit.md` |
| 6 | `nano-banana-2` | text-to-image / image-to-image | image | `market/google/nanobanana2.md` |
| 7 | `nano-banana-2-lite` | text-to-image / image-to-image | image | `market/google/nano-banana-2-lite.md` |
| 8 | `nano-banana-pro` | image-to-image / text-to-image | image | `market/google/pro-image-to-image.md` |
| 9 | `gemini-omni-video` | text/image/reference/video-to-video | video | `market/gemini-omni-video.md` |
| 10 | `google/gemini-omni-flash-1-1` | text/image/reference/video-to-video | video | `market/google/gemini-omni-flash-1-1.md` |
| 11 | `google/gemini-3-1-flash-tts` | text-to-speech | audio | `market/google/gemini-3-1-flash-tts.md` |
| 12 | `veo3` | text-to-video / image-to-video | video | `veo3-api/generate-veo-3-video.md` |
| 13 | `veo3_fast` | text/image/reference-to-video | video | `veo3-api/generate-veo-3-video.md` |
| 14 | `veo3_lite` | text/image/reference-to-video | video | `veo3-api/generate-veo-3-video.md` |

---

# Imagen 4 — image (models 1–3)

All three share one schema. **The one difference is `seed`, and it is a trap:**

| Model | `seed` type | `aspect_ratio` default |
|---|---|---|
| `google/imagen4` | **string**, maxLength 500 | `1:1` |
| `google/imagen4-ultra` | **string**, maxLength 500 | `1:1` |
| `google/imagen4-fast` | **integer** | `16:9` |

Sending an integer seed to `google/imagen4` — or a string to `google/imagen4-fast` — is a `422`.
The registry types the first two as `string` and only `imagen4-fast` as `seed`, so the randomize dice
appears on exactly the one model whose API takes a number.

### 1. `google/imagen4` · 3. `google/imagen4-ultra`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | |
| `negative_prompt` | string | | ≤ 5000 chars | — | What to discourage |
| `aspect_ratio` | string | | `1:1` `16:9` `9:16` `3:4` `4:3` `auto` | `1:1` | |
| `seed` | **string** | | ≤ 500 chars | — | Not a number. See above. |

### 2. `google/imagen4-fast`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | |
| `negative_prompt` | string | | ≤ 5000 chars | — | |
| `aspect_ratio` | string | | `1:1` `16:9` `9:16` `3:4` `4:3` `auto` | `16:9` | Differs from its siblings |
| `seed` | **integer** | | — | — | No documented range |

---

# Nano Banana — image (models 4–8)

Two generations with two incompatible vocabularies. Do not carry a field across the boundary.

| | Nano Banana 1 (4, 5) | Nano Banana 2 / 2 Lite / Pro (6, 7, 8) |
|---|---|---|
| Input images field | `image_urls` | `image_input` — except **2 Lite**, which uses `image_urls` |
| `output_format` enum | `png` `jpeg` | `png` `jpg` — **not `jpeg`** |
| `resolution` | absent | `1K` `2K` `4K` (absent on 2 Lite) |
| Prompt limit | 5000 | 20000 (Pro: 10000) |
| Deprecated `image_size` | present | absent |

> **`jpeg` vs `jpg` is a real difference, not a docs typo.** Nano Banana 1 documents `jpeg`; Nano
> Banana 2 and Pro document `jpg`. Each rejects the other spelling.

### 4. `google/nano-banana`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | |
| `output_format` | string | | `png` `jpeg` | `png` | |
| `aspect_ratio` | string | | `1:1` `9:16` `16:9` `3:4` `4:3` `3:2` `2:3` `5:4` `4:5` `21:9` `auto` | `1:1` | |
| `image_size` | string | | same enum as `aspect_ratio` | `1:1` | **Deprecated** — replaced by `aspect_ratio`. Kept reachable because the promise is every parameter; the control says so. |
| `nsfw_checker` | boolean | | — | `false` | Doc: "Defaults to false… If set to false, our content filtering will be disabled." |

### 5. `google/nano-banana-edit`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 5000 chars | — | |
| `image_urls` | string[] | ✓ | ≤ 10 items | — | File URLs after upload, max 10.0MB each |
| `output_format` | string | | `png` `jpeg` | `png` | |
| `aspect_ratio` | string | | same 11 values as model 4 | `1:1` | |
| `image_size` | string | | same enum | `1:1` | **Deprecated** |

No `nsfw_checker` on the edit endpoint.

### 6. `nano-banana-2`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 20000 chars | — | |
| `image_input` | string[] | | ≤ **14** items | — | Max 30.0MB each; jpeg/png/webp. Omit for pure text-to-image. |
| `aspect_ratio` | string | | `1:1` `2:3` `3:2` `1:4` `4:1` `3:4` `4:3` `4:5` `5:4` `1:8` `8:1` `9:16` `16:9` `21:9` `auto` | `auto` | 15 values — widest of any model here |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | |
| `output_format` | string | | `png` `jpg` | `jpg` | Note the default is **jpg**, unlike its siblings |

### 7. `nano-banana-2-lite`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 20000 chars | — | |
| `aspect_ratio` | string | ✓ | `1:1` `1:4` `1:8` `2:3` `3:2` `3:4` `4:1` `4:3` `4:5` `5:4` `8:1` `9:16` `16:9` `21:9` `auto` | `auto` | **Required**, unlike every other Nano Banana |
| `image_urls` | string[] | | ≤ 10 items | `[]` | Uses `image_urls`, **not** `image_input`, unlike 2 and Pro |

No `resolution` and no `output_format` — Lite is the only Nano Banana 2 variant without them.

### 8. `nano-banana-pro`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ **10000** chars | — | Half of `nano-banana-2`'s limit |
| `image_input` | string[] | | ≤ **8** items | — | Max 30.0MB each |
| `aspect_ratio` | string | | `1:1` `2:3` `3:2` `3:4` `4:3` `4:5` `5:4` `9:16` `16:9` `21:9` `auto` | `1:1` | 11 values — no `1:4`/`4:1`/`1:8`/`8:1` |
| `resolution` | string | | `1K` `2K` `4K` | `1K` | |
| `output_format` | string | | `png` `jpg` | `png` | Default differs from `nano-banana-2` |

---

# Gemini Omni — video (models 9, 10)

Multimodal video. `audio_ids` and `character_ids` are **not** URLs — they are ids minted by two
separate synchronous endpoints (`POST /api/v1/omni/audio/create`, `POST /api/v1/omni/character/create`)
which are deliberately not in the registry. Until those are built, the fields take pasted ids, which is
why they are typed `string[]` rather than `url[]`.

### Image-slot budget (both models)

The doc states a budget, not a per-field limit: **7 image slots total.** `image_urls` spends one per
image (max 7). A `video_list` entry spends **2**, leaving at most 3 `character_ids`. A dual-image
character (portrait + body) spends 2 on its own. Not machine-enforceable from a single field limit —
recorded here and in the control's help text.

### 9. `gemini-omni-video`

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | ≤ 20000 chars | — | |
| `duration` | string | ✓ | `'4'` `'6'` `'8'` `'10'` | — | **Quoted strings, not integers.** Ignored when `video_list` is set — the model picks the duration. |
| `image_urls` | string[] | | max 7 images, ≤ 20MB each | — | Reference images for characters, scenes, styles, storyboards |
| `audio_ids` | string[] | | max 3 | — | Ids from `gemini-omni-audio`, not URLs |
| `character_ids` | string[] | | see slot budget | — | Ids from `gemini-omni-character`, not URLs |
| `video_list` | object[] | | max 1 item | — | `{ url, start, ends }` — see below |
| `aspect_ratio` | string | | `16:9` `9:16` | — | No documented default |
| `resolution` | string | | `720p` `1080p` `4k` | `720p` | Lowercase `4k` |
| `seed` | integer | | 0 – 2147483647 | — | |

`video_list[]` item — all three fields required:

| field | type | req | notes |
|---|---|---|---|
| `url` | string | ✓ | ≤ 100MB, ≤ 30s |
| `start` | number | ✓ | Seconds, min 0 |
| `ends` | number | ✓ | Seconds, min 0. Must exceed `start`; `ends - start` ≤ 10s. |

### 10. `google/gemini-omni-flash-1-1`

Every field of model 9, plus first/last-frame inputs and a lower resolution tier.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| *(all fields of model 9)* | | | | | `resolution` adds **`360p`**: `360p` `720p` `1080p` `4k`, default `720p` |
| `first_frame_url` | string | | — | — | Starting frame |
| `last_frame_url` | string | | — | — | Requires `first_frame_url`; cannot be used alone |

> **Mutual exclusion, quoted from the doc:** `first_frame_url` "is mutually exclusive with
> `image_urls`, `audio_ids`, `video_list`, and `character_ids` and cannot be provided at the same
> time." The doc also carries a machine-readable `dependencies: { last_frame_url: [first_frame_url] }`.

Encoded as `mutuallyExclusiveGroups` (`[first_frame_url, last_frame_url]` versus the four multimodal
fields) plus `requires` on `last_frame_url`. Model 9 has neither field and so has neither constraint.

---

# Gemini TTS — audio (model 11)

### 11. `google/gemini-3-1-flash-tts`

Multi-speaker dialogue synthesis. **No `prompt` field** — the text lives inside `dialogue_turns`.
`outputKind: 'audio'`.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `speakers` | object[] | ✓ | — | — | Voice cast — see below |
| `dialogue_turns` | object[] | ✓ | — | — | Script, rendered in order |
| `temperature` | number | | 0 – 2 | `1` | Sampling temperature |
| `scene` | string | | — | `''` | e.g. "A quiet, warm room with a fireplace crackling softly." |
| `sample_context` | string | | — | `''` | Overall tone, e.g. "Audiobook style narration." |

`speakers[]` item:

| field | type | req | enum | notes |
|---|---|---|---|---|
| `speaker_id` | string | ✓ | — | **Must be `Speaker N` format** — the doc is explicit. Joins to `dialogue_turns`. |
| `voice_name` | string | ✓ | `Achernar` `Achird` `Algenib` `Algieba` `Alnilam` `Aoede` `Autonoe` `Callirrhoe` `Charon` `Despina` `Enceladus` `Erinome` `Fenrir` `Gacrux` `Iapetus` `Kore` `Laomedeia` `Leda` `Orus` `Puck` `Pulcherrima` `Rasalgethi` `Sadachbia` `Sadaltager` `Schedar` `Sulafat` `Umbriel` `Vindemiatrix` `Zephyr` `Zubenelgenubi` | 30 voices, **Capitalized**. The `gemini-omni-audio` endpoint spells the same names lowercase; the two are not interchangeable. |
| `accent` | string | ✓ | `Neutral` `American (Gen)` `American (Valley)` `American (South)` `British (RP)` `British (Brixton)` `Transatlantic` `Australian` | |
| `audio_profile` | string | | — | Free text, e.g. "A warm and soothing narrator" |
| `style` | string | | `Vocal Smile` `Newscaster` `Whisper` `Empathetic` `Promo/Hype` `Deadpan` | |
| `pace` | string | | `Natural` `Rapid Fire` `The Drift` `Staccato` | |

`dialogue_turns[]` item:

| field | type | req | limit | notes |
|---|---|---|---|---|
| `speaker_id` | string | ✓ | — | Must match a `speakers[].speaker_id` |
| `text` | string | ✓ | ≤ 10000 chars | May contain tone tags |

---

# Veo 3.1 — video (models 12–14)

> **Veo is the only model in the catalog that does not use `/jobs/createTask`.** It has its own
> endpoints, its own request shape, and its own status vocabulary. All of that is absorbed by
> `transport: 'veo'` on the `ModelDefinition` and the adapter in `lib/kie/veo.ts`. Full transport
> details are in the `kie-api` skill; this file is the parameter reference.

| Concern | `jobs` transport | `veo` transport |
|---|---|---|
| Create | `POST /api/v1/jobs/createTask` | `POST /api/v1/veo/generate` |
| Poll | `GET /api/v1/jobs/recordInfo` | `GET /api/v1/veo/record-info` |
| Body shape | `{ model, callBackUrl, input: {...} }` | **flat** — every field at top level, no `input` wrapper |
| Status | `state: waiting/queuing/generating/success/fail` | `successFlag: 0 generating, 1 success, 2 and 3 failed` |
| Results | `resultJson` (a JSON **string**) | `data.response.resultUrls` (already an array) |
| Echoed params | `param` | `paramJson` |

`model` is the slug: **`veo3`** (Quality), **`veo3_fast`**, **`veo3_lite`**. All three share one
schema; the only documented difference is which `generationType` values they accept.

| field | type | req | enum / range | default | notes |
|---|---|---|---|---|---|
| `prompt` | string | ✓ | — | — | "Required for all generation modes" |
| `imageUrls` | string[] | | 1–3 depending on mode | — | **camelCase** — the only camelCase input field in the catalog. 1 image: the video unfolds around it. 2 images: first and last frame. `REFERENCE_2_VIDEO`: 1–3 reference images. |
| `generationType` | string | | `TEXT_2_VIDEO` `FIRST_AND_LAST_FRAMES_2_VIDEO` `REFERENCE_2_VIDEO` | — | Omit and Kie infers the mode from whether `imageUrls` is present. **`REFERENCE_2_VIDEO` is documented for `veo3_fast` and `veo3_lite` only** — the `veo3` entry therefore lists only the first two values. |
| `aspect_ratio` | string | | `16:9` `9:16` `Auto` | `16:9` | **Capital `Auto`** — every other model in the catalog writes `auto`. |
| `resolution` | string | | `720p` `1080p` `4k` | `720p` | Lowercase `4k` |
| `duration` | integer | | `4` `6` `8` | `8` | **Bare integers**, unlike Gemini Omni's quoted strings. `REFERENCE_2_VIDEO` supports only `8`. |
| `watermark` | string | | — | — | Watermark text to burn in |
| `enableTranslation` | boolean | | — | `false` | Auto-translates the prompt to English first. Prose says "Default value is true"; the **schema says `false`** — the schema wins, and the conflict is recorded in `notes`. |
| `enableFallback` | boolean | | — | `false` | **Deprecated.** Doc: "Please remove this parameter from your requests." Kept reachable, marked deprecated, never sent by default. |
| `callBackUrl` | string | | — | — | Transport-level, not a model parameter. Supplied by the runner, never by the form. |

**Do not add `seeds`.** It appears once in the page's `example` block and is absent from
`properties`. An undocumented field is an invented field.

## Veo companion endpoints — not models

Registered nowhere; they act on an existing Veo task and belong in the gallery's actions, not the
generate form. Listed so they are not mistaken for missing models:

| Purpose | Endpoint |
|---|---|
| Fetch the 1080p render | `GET /api/v1/veo/get-1080p-video` |
| Fetch the 4K render | `GET /api/v1/veo/get-4k-video` |
| Extend an existing video | `POST /api/v1/veo/extend` |
