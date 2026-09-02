---
description: Fire one real generation through a registered model and verify the full lifecycle
argument-hint: <model-slug> [prompt]
---

Smoke-test `$1` end to end. This spends real credits — one generation only, cheapest settings.

1. Look up `$1` in `.claude/skills/kie-models/references/` and, if it exists, `lib/kie/registry/`.
   Report any mismatch between the two before proceeding.
2. Build a minimal valid `input`: `$2` as the prompt (or a short neutral one), every required field
   filled, and every optional quality/duration field set to its cheapest documented value — lowest
   `resolution`, shortest `duration`, audio generation off. If the model requires an input asset, ask
   the user for one rather than inventing a URL.
3. Submit through the app's own `POST /api/kie/create` route so the proxy, validation, and persistence
   are exercised — not by calling `api.kie.ai` directly. If the app doesn't exist yet, use the
   `kie-ai` MCP server and say that the app path was not covered.
4. Poll `recordInfo` until terminal. Report the observed state transitions, `costTime`, and
   `creditsConsumed`.
5. Verify the durability rule: the output bytes landed in `KIE_OUTPUT_DIR`, an `assets` row exists,
   and the `generations` row holds the verbatim `input_json`.
6. On `fail`, report `failCode` and `failMsg` verbatim and check whether the cause is a parameter the
   reference table has wrong — a `422` usually means a bad enum value.

Report: pass/fail per step, and any drift found between the docs, the reference table, and the registry.
