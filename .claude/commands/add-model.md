---
description: Transcribe a Kie model's doc page into the reference table and the typed registry
argument-hint: <model-slug> [doc-url]
---

Add `$1` to the Kie Studio model registry.

1. Confirm `$1` belongs to an in-scope family (`kling`, `bytedance`/Seedream, `wan`). If it does not,
   stop and say so — other Kie families are deliberately out of scope.
2. Run the `kie-model-scout` agent on `$1` (pass `$2` as the doc URL if given) to get the parameter
   table and the `ModelDefinition`.
3. Append the model's section to the matching `.claude/skills/kie-models/references/<family>.md`,
   keeping the existing table format and including the source doc URL.
4. Add the `ModelDefinition` to `lib/kie/registry/<family>.ts` and export it from the registry index.
   If the app code does not exist yet, do step 3 only and say so.
5. Verify: the slug is character-for-character what the doc's `model` enum states; every enum value
   is copied verbatim including whether numbers are quoted; any mutual exclusions in the doc's prose
   are encoded as `Constraint` entries.
6. Run `npx tsc --noEmit` if the project has code.

Do not invent any field, default, or limit the doc does not state.
