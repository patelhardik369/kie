# UX specification

The design problem is not "make generation pretty." It is: **59 models with overlapping names and
three incompatible parameter dialects, and none of it may be hidden.** Everything below serves
legibility under that constraint.

## Global frame

A persistent left rail — Studio, Gallery, Models, Presets, Prompts, Settings — and a header showing
the credit balance and a live count of running jobs. A right-hand **queue rail** is visible on every
screen: running jobs with state and elapsed time, most recent first. Generation is asynchronous and
slow; you should never have to navigate somewhere to find out whether your video is done.

Dark by default. Media is the content; chrome stays quiet.

---

## Studio

Three panes: **model picker** (left), **parameter form** (center), **preview + queue** (right).

### Choosing a model

Progressive narrowing, because a flat list of 59 slugs is unusable:

```
Family          Capability              Model
─────────       ──────────────          ──────────────────────────
Kling           Text to video           Kling 3.0 Omni       4k · multi-shot · 3-15s
ByteDance       Image to video          Kling 3.0            multi-shot · @elements
Wan             Reference to video      Kling v3 Turbo       fast · 720p/1080p
                Video to video          Kling 2.6            sound · 5s/10s
                Motion control          ...
                Avatar
                Text to image
                Image to image
                Layer decomposition
```

Every model row carries a one-line differentiator — the capability alone doesn't distinguish nine
Kling text-to-video models. A compare view shows two models' parameter tables side by side.

### The parameter form

Generated from the model's `ModelDefinition`. Two zones:

- **Always visible** — `core` and `framing` groups: prompt, assets, aspect ratio, resolution, duration.
- **Advanced** (collapsed, with a count badge) — `motion`, `audio`, `advanced`: seed, cfg_scale,
  negative prompt, inference steps, guidance scale, shift, watermark, nsfw_checker, prompt_extend.

Collapsed is not hidden: the badge shows how many controls are inside, the section remembers its
state, and any advanced field changed from its default is surfaced as a chip on the collapsed header.
You always know what you're sending.

### Control mapping

| `ParamType` | Control |
|---|---|
| `text` | Auto-growing textarea with a live `n / maxLength` counter |
| `string` | Single-line input |
| `enum` | Segmented control at ≤4 options, select above that |
| `number` | Slider **plus** a numeric input — the slider for feel, the box for exactness. Honors `step` |
| `boolean` | Switch, with cost implications labelled ("increases generation cost") |
| `url` | Dropzone: drag-drop, file picker, paste a URL, or pick from the asset library. Shows a thumbnail once set |
| `url[]` | Same, multiple, reorderable, with an `n / maxItems` counter |
| `seed` | Number input with a dice button, and a "lock" that carries the seed to the next run |
| `object[]` | Repeating card list with add / remove / drag-reorder |

Every control shows its `describe` text on hover, and its documented default is visibly marked as
default so a deliberate change reads as deliberate.

### What a fresh form opens on

Documented defaults, with three studio preferences layered over them
(`lib/kie/studio-defaults.ts`):

| Preference | Value | Applies to |
|---|---|---|
| Output count | `1` | `n`, `max_images` |
| Image resolution | `1K` | `resolution`, `image_resolution` on image models |
| Video resolution | `720p` | `resolution` on video models, matching each family's casing |

A fresh form should cost the least it can while still being the shape you usually want; Kie's own
defaults lean the other way, and Wan 2.7 Image shipping `n: 4` at `2K` is eight times the credits of
one 1K image for a prompt you are probably still iterating on. It raises as readily as it lowers —
Wan Animate's documented `480p` opens at `720p` too.

This is a layer, never an edit to the registry. `param.default` stays exactly what `docs.kie.ai`
says, because it answers a different question — what Kie does with the field omitted — and both
numbers are printed under the control: *Default: `4`. Opens on `1`.* A preference that cannot be
expressed in a model's own vocabulary is dropped rather than approximated, so nothing here can put a
value in the form that the model would reject: `seedream/5-pro-layer-decomposition` keeps its `auto`
size, which follows the source image rather than downscaling it to 1K.

### Constraints in the UI

When a `Constraint` is violated, the app **prevents** the state rather than reporting it afterwards.
Choosing a first frame on Seedance 2.0 disables the reference-asset fields and shows a banner:

> Seedance 2.0 supports **one** input mode per generation: first frame, first + last frame, or
> multimodal references. Clear the first frame to use references instead.

Never a bare "invalid combination", and never a `422` the user has to decode.

### Model-specific affordances that earn their place

- **Derived duration** — `wan/2-2-a14b-speech-to-video-turbo` sets length via `num_frames` and
  `frames_per_second`; show the resulting seconds live.
- **Element references** — Kling 3.0 and Omni let elements be named and cited as `@name` in prompts.
  The prompt editor autocompletes defined element names and highlights them. Kling 3.0's rule that
  each `@element` consumes 37 characters of the 500-char shot budget is reflected in the counter.
- **Multi-shot timeline** — `multi_prompt` renders as a horizontal strip of shot cards with a running
  total against the model's duration cap.
- **Layer decomposition** — results render as a layer stack with visibility toggles, ordered by
  `z_index`, not a flat grid of images.

### Submit

A collapsible **request preview** shows the exact JSON that will be POSTed. Submit is disabled while
any validation fails, with the blocking reason shown next to the button, not in a toast.

Below submit: **Generate**, **Generate ×N** (batch), and **Sweep** — pick one parameter and a range
to vary across runs.

---

## Gallery

Masonry grid, newest first, video items playing muted on hover.

Filters across the top: family, model, capability, date range, favorites, state (to find failures),
plus free-text search over prompts. Persisted across visits.

Each tile: the media, the model slug, and a favorite toggle. Hover reveals re-run and open-folder
actions. Failed generations appear as cards showing `failCode` / `failMsg`, not as gaps — a failure
you can read is worth more than a clean grid.

## Generation detail

- The media, full size, with a download button and reveal-in-folder.
- The complete parameter set as a readable table, plus raw `input_json` for copying.
- Metadata: model slug, state, credits consumed, generation time, `kie_task_id`, timestamps.
- **Lineage** — parent and children as a small graph. This is how iteration becomes visible.
- Actions: **Re-run identical**, **Tweak** (opens the Studio prefilled), **Save as preset**.

## Models

The catalog, browsable. Search across slugs, capabilities, and descriptions. Each model's page shows
its full parameter table, its constraints, its asset limits, and a link to its `docs.kie.ai` page.

Prominently: the traps. That Seedream 5 Pro's `high` is 2K while 5 Lite's is 3K. That Kling durations
are strings but Kling Omni's are integers. That `wan/2-7-text-to-video` uses `ratio`, not
`aspect_ratio`. Surfacing these is a feature — they are exactly what costs an hour otherwise.

## Presets, Prompts, Settings

**Presets** — grouped by model, with a parameter summary; applying one opens the Studio prefilled.
Dropped fields after a registry change are reported, not silently swallowed.

**Prompts** — taggable saved prompts, searchable, insertable into any prompt field.

**Settings** — API key status (never the value), credit balance and spend history, `KIE_OUTPUT_DIR`
with disk usage, and the webhook URL when `KIE_PUBLIC_URL` is configured.

## Interaction principles

1. **Nothing is hidden, only grouped.** Collapsed sections announce their contents.
2. **Prevent, don't reject.** Constraints disable controls up front and explain why.
3. **Async is visible.** The queue rail is always present; jobs survive navigation and restarts.
4. **Every output is traceable.** No item exists without the parameters that produced it.
5. **Verbatim over friendly.** Model slugs, `failMsg`, and enum values appear exactly as the API
   spells them, so what you see here matches what you'd read in the docs.
