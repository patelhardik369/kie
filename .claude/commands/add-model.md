---
description: Transcribe a Kie model's doc page into the reference table and the typed registry
argument-hint: <model-slug> [doc-url]
---

Add `$1` to the Kie Studio model registry.

1. Confirm `$1` belongs to an in-scope family — `kling`, `bytedance`/Seedream, `wan`, `google`
   (Veo, Gemini Omni, Imagen 4, Nano Banana, Gemini TTS), `openai` (GPT Image), or `enhance` (any
   upscaler or background remover, whoever makes it). If it does not, stop and say so — other Kie
   families are deliberately out of scope, and chat/text models are permanently out of scope.
2. Run the `kie-model-scout` agent on `$1` (pass `$2` as the doc URL if given) to get the parameter
   table and the `ModelDefinition`.
3. **Check the scout's reported `paths:` value.** If it is not `/api/v1/jobs/createTask`, stop and
   report it — the model needs a new transport, which is an architectural change to `lib/kie/`, not a
   registry addition. Only `'veo'` exists today.
4. Append the model's section to the matching `.claude/skills/kie-models/references/<family>.md`,
   keeping the existing table format and including the source doc URL.
5. Add the `ModelDefinition` to `lib/kie/registry/<family>.ts` and export it from the registry index.
   Update the model count in `lib/kie/registry/index.ts`, `registry.test.ts`, the family table in
   `.claude/CLAUDE.md`, and `docs/MODEL-CATALOG.md`.
6. Verify: the slug is character-for-character what the doc's `model` enum states — including any
   missing vendor prefix; every enum value is copied verbatim including quoting and capitalization;
   any mutual exclusions or value restrictions in the doc's prose are encoded as `Constraint` entries;
   deprecated fields are kept with `deprecated: true` rather than dropped.
7. Run `npx tsc --noEmit` and `node --test`.

Do not invent any field, default, or limit the doc does not state, and do not transcribe a field that
appears only in the page's `example` block.
