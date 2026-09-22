---
description: Diff the local Kie model catalog against the live docs and report drift
---

Audit the Kie Studio model catalog for drift. Kie ships models frequently and renames slugs, so this
is expected to find something.

1. Fetch `https://docs.kie.ai/llms.txt` — the authoritative index of every documented page.
2. Extract the entries for the six in-scope families:

   | Family | llms.txt sections |
   |---|---|
   | `kling` | Video Models > Kling |
   | `bytedance` | Video Models > Bytedance, Image Models > Seedream |
   | `wan` | Video Models > Wan, Image Models > Wan |
   | `google` | Image Models > Google, Video Models > Gemini Omni, Music Models > Gemini, **and the `Veo3.1 API` section, which is not under `market/`** |
   | `openai` | Image Models > GPT Image |
   | `enhance` | Image Models > Topaz, Image Models > Recraft, Video Models > Topaz, and `market/grok-imagine/upscale.md` only |

   Ignore every other family. Ignore **all** of `Chat Models` — Gemini, GPT-5, Codex, and Claude text
   models are permanently out of scope. Ignore `market/gemini-omni-audio.md` and
   `market/gemini-omni-character.md`: they are id-minting endpoints, not models.
3. Compare against the slugs recorded in
   `.claude/skills/kie-models/references/{kling,bytedance,wan,google,openai,enhance}.md` and, if the
   app code exists, `lib/kie/registry/`.
4. Report four lists:
   - **New upstream** — documented but not in the registry.
   - **Missing upstream** — in the registry but no longer documented (likely retired; flag before removing).
   - **Transport risk** — any new page whose OpenAPI `paths:` is not `/api/v1/jobs/createTask`. These
     cannot be added as plain registry entries; call them out separately.
   - **Count check** — reference-file totals against the expected baseline of 19 Kling / 20 ByteDance /
     20 Wan / 14 Google / 8 OpenAI / 11 Qwen / 5 Enhance = 97.
5. For anything new, spot-check the `model` enum against the page path — these routinely diverge
   (`.../kling/v25-turbo-text-to-video-pro.md` serves `kling/v2-5-turbo-text-to-video-pro`;
   `.../google/nanobanana2.md` serves `nano-banana-2`; `.../google/pro-image-to-image.md` serves
   `nano-banana-pro`). A missing vendor prefix is usually correct, not a transcription slip.

Report only. Do not add or remove models — hand the list to the user and let them choose, then use
`/add-model` for the ones they want.
