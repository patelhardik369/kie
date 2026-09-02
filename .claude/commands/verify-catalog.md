---
description: Diff the local Kie model catalog against the live docs and report drift
---

Audit the Kie Studio model catalog for drift. Kie ships models frequently and renames slugs, so this
is expected to find something.

1. Fetch `https://docs.kie.ai/llms.txt` — the authoritative index of every documented page.
2. Extract the entries under **Video Models - Kling**, **Video Models - Bytedance**,
   **Video Models - Wan**, **Image Models - Seedream**, and **Image Models - Wan**. Ignore every other
   family; they are out of scope.
3. Compare against the slugs recorded in `.claude/skills/kie-models/references/{kling,bytedance,wan}.md`
   and, if the app code exists, `lib/kie/registry/`.
4. Report three lists:
   - **New upstream** — documented but not in the registry.
   - **Missing upstream** — in the registry but no longer documented (likely retired; flag before removing).
   - **Count check** — reference-file totals against the expected baseline of 19 Kling / 20 ByteDance /
     20 Wan = 59.
5. For anything new, spot-check whether the page slug differs from the `model` enum value — these
   routinely diverge (`.../kling/v25-turbo-text-to-video-pro.md` serves model
   `kling/v2-5-turbo-text-to-video-pro`).

Report only. Do not add or remove models — hand the list to the user and let them choose, then use
`/add-model` for the ones they want.
