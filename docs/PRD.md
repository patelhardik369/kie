# Kie Studio — Product Requirements

## 1. Problem

Hosted generation tools like Higgsfield are pleasant but opinionated. They expose a curated slice of
each model's controls, bury the rest behind presets, hold your outputs on their servers, meter you
through their pricing, and pick which models you get. Meanwhile Kie AI already resells the same
underlying models — Kling, Seedance, Seedream, Wan — through one uniform API at wholesale credit cost.

What's missing is the front end: something that turns 59 raw JSON endpoints into a studio you'd
actually want to sit in front of, **without hiding a single parameter.**

## 2. Product

A local, single-user web app that is the complete interface to three Kie model families.

**The promise:** every parameter of every supported model is reachable, and every generation is
permanently yours — bytes on your disk, parameters in your database, reproducible forever.

Presets sit *on top of* full manual control. They are never a substitute for it.

## 3. Goals

| # | Goal | Why |
|---|---|---|
| G1 | Expose 100% of documented parameters for all 59 models | The core differentiator. A hidden parameter is a bug |
| G2 | Never lose an output | Kie deletes generated media after 14 days |
| G3 | Make every past generation re-runnable and tweakable | Iteration is the actual creative workflow |
| G4 | Make model choice legible | 59 endpoints with overlapping names is otherwise unusable |
| G5 | Keep cost visible per generation | Credits are the real constraint |

## 4. Non-goals

Multi-user accounts, auth, sharing, or a public gallery. Billing or credit resale. Model families
beyond Kling / ByteDance / Wan. Hosting or fine-tuning models. A mobile app. Video editing or
compositing beyond what the models do — this is a generation front end, not an NLE.

## 5. User

One person: the machine's owner. Technically comfortable, has a Kie API key, generates constantly,
and cares about controls that hosted tools hide — `cfg_scale`, `seed`, `num_inference_steps`,
`shift`, `guidance_scale`, negative prompts, exact frame counts. Wants outputs archived locally and
organized, not scattered across a vendor's CDN.

## 6. Features

### F1 — Studio: schema-driven generation

Pick a family, then a capability, then a model; get a form generated from that model's
`ModelDefinition`. Submit, watch it run, see the result.

The form is generated, never hand-written per model. Adding a model to the registry must add a
working, complete UI with no component changes.

**Acceptance**
- Every field in the model's reference table renders with a control of the right type.
- Enum controls offer exactly the documented values — no more, no fewer.
- Documented defaults are pre-filled; undocumented ones are left empty, not guessed.
- Min/max/step/maxLength are enforced client-side before submission.
- Documented constraints (Seedance 2.x's three exclusive modes, Wan 3.0's frame-vs-reference split,
  Kling Omni's `prefer_multi_shots` XOR `customize_multi_shots`) disable the conflicting controls and
  explain why, rather than letting the request fail with a `422`.
- Repeating groups (`multi_prompt`, `kling_elements`, `elements`) support add/remove/reorder.
- Asset fields accept drag-drop, file picker, pasted URL, or selection from the asset library, and
  upload through Kie's file API transparently.
- A live JSON preview of the exact request body is available. Nothing in the form is unexplainable.

### F2 — Durable output archive

Every successful generation's bytes are downloaded to `KIE_OUTPUT_DIR` and recorded before the job is
marked complete.

**Acceptance**
- Files land in a dated, model-named path; the `assets` row records the local path.
- The gallery renders from local files, never from Kie URLs.
- A generation completed >14 days ago still plays.
- Layer-decomposition outputs preserve per-layer `z_index`, `name`, and `bounding_box`.
- A download failure marks the generation as needing retry rather than silently succeeding.

### F3 — Queue and job runner

Submissions enter a local queue, are throttled beneath Kie's 20-per-10-seconds limit, and are polled
to completion with backoff.

**Acceptance**
- Multiple concurrent jobs show live state (`waiting` → `queuing` → `generating` → terminal).
- A `429` backs off and retries rather than dropping the job.
- Closing and reopening the browser doesn't lose an in-flight job — state is in SQLite, and polling
  resumes on server start.
- Failures surface `failCode` and `failMsg` verbatim.

### F4 — Gallery with full provenance

A filterable grid of everything ever generated. Every item carries the parameters that made it.

**Acceptance**
- Filter by family, model, capability, date, and favorite; free-text search over prompts.
- Each item shows its complete `input_json`, its model slug, its credit cost, and its generation time.
- One click re-opens that exact configuration in the Studio.

### F5 — Re-run, tweak, and variations

From any past generation: re-run identical, or open it in the Studio with parameters pre-filled to
change one thing.

**Acceptance**
- Re-runs record `parent_id`, forming a lineage.
- A generation's ancestry and descendants are visible from its detail view.
- Batch mode sweeps one parameter (seed, `cfg_scale`, resolution) across N runs from one submission,
  each row linked to the same parent.

### F6 — Presets

Save a model's current parameter set under a name; apply it later to prefill the form.

**Acceptance**
- Presets are model-scoped and never silently applied across incompatible models.
- Applying a preset is a starting point — every field stays editable afterward.
- A preset saved before a model's registry entry changed still applies, with removed fields dropped
  and reported rather than erroring.

### F7 — Asset library

Reference images, driving videos, and audio used as model inputs are kept locally and reusable, with
their Kie upload URL cached until it expires.

**Acceptance**
- An asset reused within 24h is not re-uploaded.
- An expired upload is re-uploaded transparently on next use.
- Assets can be picked from the library in any asset-typed field.

### F8 — Prompt library

Saved, taggable prompts insertable into any prompt field.

### F9 — Model browser

A searchable view of all 59 models: family, capability, what inputs it takes, what makes it different
from its siblings, and its parameter table.

**Acceptance**
- Answers "which model do I want?" without opening `docs.kie.ai`.
- Surfaces the traps the reference files record — that Seedream 5 Pro's `high` quality is 2K while
  5 Lite's is 4K, that Wan 2.7 t2v uses `ratio` rather than `aspect_ratio`, that Kling durations are
  strings but Kling Omni durations are integers.

### F10 — Credit tracking

Account balance in the header; per-generation `creditsConsumed` on every row; spend totals by model
and by day.

## 7. Constraints

- `KIE_API_KEY` never reaches the browser. All Kie traffic goes through server routes.
- Polling is the primary completion path; webhooks activate only when `KIE_PUBLIC_URL` is set.
- Submission rate stays under 20 per 10 seconds.
- No parameter, default, or enum value may exist in the app that isn't in a model's doc page.

## 8. Success

The app is working when: all 59 models generate successfully; nothing in the gallery has ever been
lost to URL expiry; and there is no reason left to open Kie's own playground — every control is here.
