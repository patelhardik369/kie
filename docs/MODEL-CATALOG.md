# Model catalog — 59 endpoints

Index only. **Parameter detail lives in `.claude/skills/kie-models/references/`** so there is exactly
one source of truth; each family section links there.

| Family | Video | Image | Total |
|---|---|---|---|
| Kling | 19 | — | 19 |
| ByteDance (Seedance / Seedream) | 10 | 10 | 20 |
| Wan | 18 | 2 | 20 |
| | | | **59** |

Verify against upstream with `/verify-catalog`. Add one with `/add-model <slug>`.

---

## Kling — 19 video models
→ [`references/kling.md`](../.claude/skills/kie-models/references/kling.md)

| Model slug | Capability | Pick it for |
|---|---|---|
| `kling-2.6/text-to-video` | text-to-video | Current-gen default. Native sound toggle, 5s/10s |
| `kling-2.6/image-to-video` | image-to-video | Animating a still with sound |
| `kling/v3-turbo-text-to-video` | text-to-video | Fast v3, free duration 3–15s, 720p/1080p |
| `kling/v3-turbo-image-to-video` | image-to-video | Fast v3 from a still; ratio follows the image |
| `kling-3.0/video` | text/image-to-video | Multi-shot sequences and `@named` element references |
| `kling-3.0-omni/text-to-video` | text-to-video | Top tier: 4k, multi-shot, subject elements |
| `kling-3.0-omni/image-to-video` | image-to-video | Omni from a first frame, or first+last |
| `kling-3.0-omni/reference-to-video` | reference-to-video | Character consistency from up to 7 reference images |
| `kling-3.0-omni/transformation` | video-to-video | Restyling an existing clip |
| `kling-2.6/motion-control` | motion-control | Driving a still portrait with a 3–30s video |
| `kling-3.0/motion-control` | motion-control | Same, with background-source control |
| `kling/ai-avatar-standard` | avatar | Talking head from image + audio, up to 5 min |
| `kling/ai-avatar-pro` | avatar | Same, higher quality tier |
| `kling/v2-5-turbo-text-to-video-pro` | text-to-video | v2.5 with `cfg_scale` and negative prompt |
| `kling/v2-5-turbo-image-to-video-pro` | image-to-video | v2.5 with first + tail frame |
| `kling/v2-1-master-text-to-video` | text-to-video | v2.1 top quality, 5000-char prompts |
| `kling/v2-1-master-image-to-video` | image-to-video | v2.1 top quality from a still |
| `kling/v2-1-pro` | image-to-video | v2.1 mid tier, supports a tail frame |
| `kling/v2-1-standard` | image-to-video | v2.1 cheapest |

**Traps:** `duration` is a quoted string everywhere except Kling 3.0 Omni, where it's an integer.
Page slugs differ from model slugs (`v25-...` in the URL, `v2-5-...` in the API). Kling 2.6 models
carry a `kling-2.6/` prefix, not `kling/`.

---

## ByteDance — 20 models
→ [`references/bytedance.md`](../.claude/skills/kie-models/references/bytedance.md)

### Seedance — 10 video models

| Model slug | Capability | Pick it for |
|---|---|---|
| `bytedance/seedance-2` | text/image/reference-to-video | Flagship. Up to 4k, 15s, multimodal references |
| `bytedance/seedance-2-fast` | same | Same features, capped at 720p, cheaper |
| `bytedance/seedance-2-mini` | same | Cheapest 2.0 tier |
| `bytedance/seedance-2-5` | same | Long-form: 30s output, 30k prompts, 30 reference images, mov output |
| `bytedance/seedance-1.5-pro` | text/image-to-video | Prior gen. `fixed_lens` camera lock, 4–12s |
| `bytedance/v1-pro-text-to-video` | text-to-video | V1 quality tier with seed control |
| `bytedance/v1-pro-image-to-video` | image-to-video | V1 from a still |
| `bytedance/v1-pro-fast-image-to-video` | image-to-video | Fastest V1; no seed or camera controls |
| `bytedance/v1-lite-text-to-video` | text-to-video | Cheapest V1; adds a `9:21` ratio |
| `bytedance/v1-lite-image-to-video` | image-to-video | Cheapest V1; supports an end frame |

**Trap:** Seedance 2.x enforces three mutually exclusive input modes — first frame, first+last frame,
or multimodal reference. `duration` is an integer on 2.x but a string on V1.

### Seedream — 10 image models

| Model slug | Capability | Pick it for |
|---|---|---|
| `seedream/5-pro-text-to-image` | text-to-image | Newest pro tier |
| `seedream/5-pro-image-to-image` | image-to-image | Pro editing, up to 10 inputs |
| `seedream/5-pro-layer-decomposition` | layer-decomposition | Splitting an image into named z-ordered layers |
| `seedream/5-lite-text-to-image` | text-to-image | Lite, but `ultra` quality reaches 4K |
| `seedream/5-lite-image-to-image` | image-to-image | Lite editing, up to 14 inputs |
| `seedream/4.5-text-to-image` | text-to-image | 4.5, 2K/4K via `quality` |
| `seedream/4.5-edit` | image-to-image | 4.5 editing, up to 14 inputs |
| `bytedance/seedream-v4-text-to-image` | text-to-image | 4.0. Only tier with `max_images` batch (1–6) |
| `bytedance/seedream-v4-edit` | image-to-image | 4.0 editing, up to 10 inputs |
| `bytedance/seedream` | text-to-image | 3.0. Only tier with `guidance_scale` |

**Traps:** Two sizing vocabularies — 3.0/4.0 use `image_size` + `image_resolution`; 4.5/5.x use
`aspect_ratio` + `quality`. And `quality` resolves *lower* on Pro than on Lite (Pro `high` = 2K,
Lite `high` = 3K, Lite `ultra` = 4K). Slug prefix changes from `bytedance/` to `seedream/` at 4.5.

---

## Wan — 20 models
→ [`references/wan.md`](../.claude/skills/kie-models/references/wan.md)

### Video — 18

| Model slug | Capability | Pick it for |
|---|---|---|
| `wan/3-0-video` | multi-modal | Widest inputs anywhere: images, video, audio, documents, web links. 30s |
| `wan/3-0-video-prime` | multi-modal | Same, faster tier, adds `nsfw_checker` |
| `wan/2-7-text-to-video` | text-to-video | 2.7 with a custom audio track |
| `wan/2-7-image-to-video` | image-to-video | First frame, first+last, or video continuation |
| `wan/2-7-r2v` | reference-to-video | Reference images/videos plus a voice-timbre sample |
| `wan/2-7-videoedit` | video-to-video | Editing a 2–10s clip with a reference image |
| `wan/2-6-text-to-video` | text-to-video | 2.6 with `multi_shots`, up to 15s |
| `wan/2-6-image-to-video` | image-to-video | 2.6 from a still |
| `wan/2-6-video-to-video` | video-to-video | 2.6 from up to 3 source clips |
| `wan/2-6-flash-image-to-video` | image-to-video | Fast 2.6; audio is required and priced |
| `wan/2-6-flash-video-to-video` | video-to-video | Fast 2.6 clip-to-clip |
| `wan/2-5-text-to-video` | text-to-video | 2.5; 800-char prompts |
| `wan/2-5-image-to-video` | image-to-video | 2.5 from a first frame |
| `wan/2-2-a14b-text-to-video-turbo` | text-to-video | Cheap turbo tier with an `acceleration` switch |
| `wan/2-2-a14b-image-to-video-turbo` | image-to-video | Same from a still |
| `wan/2-2-a14b-speech-to-video-turbo` | speech-to-video | Raw diffusion controls: steps, guidance, shift, frame count |
| `wan/2-2-animate-move` | video-to-video | Transfer a video's motion onto your character |
| `wan/2-2-animate-replace` | video-to-video | Swap the character in a video for yours |

### Image — 2

| Model slug | Capability | Pick it for |
|---|---|---|
| `wan/2-7-image` | text-to-image / image-to-image | Batch up to 12, color palettes, bbox editing, 4K |
| `wan/2-7-image-pro` | text-to-image / image-to-image | Same schema, higher tier |

**Traps:** Three parameter dialects across generations — 2.7 text-to-video uses **`ratio`** where
everything else uses `aspect_ratio`; Wan 3.0 uses **uppercase** `720P`; 2.6 has no aspect control at
all; `wan/2-7-r2v`'s `reference_image` and `reference_video` are arrays despite singular names; the
Animate models cap source video at **10 MB**.
