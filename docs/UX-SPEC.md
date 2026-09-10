# UX specification

The design problem is not "make generation pretty." It is: **86 models with overlapping names and
three incompatible parameter dialects, and none of it may be hidden.** Everything below serves
legibility under that constraint.

## Global frame

A persistent left rail — Studio, Gallery, Models, Presets, Prompts, Settings — and a header showing
the credit balance and a live count of running jobs. A right-hand **queue rail** is visible on every
screen: running jobs with state and elapsed time, most recent first. Generation is asynchronous and
slow; you should never have to navigate somewhere to find out whether your video is done.

A persistent 48px top bar carries the mark, the sections, Settings, and the New-generation action.
It is static — chrome that restyles itself as you scroll competes with the content every time and is
noticed exactly once.

Dark by default, on a fixed near-black canvas. Media is the content; chrome stays quiet.

---

## Theming

Two systems that do not touch.

**The shell is fixed.** Canvas, panels, borders and text are a neutral near-black ramp
(`#09090b` → `#ededf0`) that never moves. A tool should read as one stable dark surface; tinting the
neutrals is what makes an app look sprayed with a colour rather than built around one.

**The accent is derived at runtime** from one hex chosen in Settings, and colours only what is
interactive or stateful: the primary action, focus, selection, links, the running state. Presets are
eleven starting points around the hue circle; the picker itself takes any value.

| Piece | Where |
|---|---|
| Derivation + the pre-paint bootstrap | `lib/theme/accent.ts` |
| Inline `<script>` in `<head>` | `components/theme/AccentScript.tsx` |
| The control | `components/theme/AccentPicker.tsx` |
| Token fallbacks + component primitives | `app/globals.css` |

Rules the implementation holds to:

1. **OKLCH, not HSL.** Only there does holding lightness constant while swapping hue actually look
   constant — an HSL ramp makes yellow glare and blue vanish at the same nominal lightness.
2. **The pick is corrected, never honoured blindly.** Lightness is pulled into `0.58…0.80` and chroma
   capped at `0.19`, because a near-black accent cannot carry a button label on a black shell and an
   over-saturated one clips its own derived tints out of gamut. Hue always survives.
3. **The accent never reaches the neutrals.** The canvas is the same black under every choice — see
   above.
4. **Status colours do not move.** `--color-ok`, `--color-warn`, `--color-bad` and `--color-private`
   are fixed hues. "Failed" must read as failed under every accent.
5. **Applied before first paint.** An inline script in `<head>`, not an effect — otherwise every load
   flashes the default blue first.
6. **Browser-local.** The chosen hex lives in `localStorage` and never reaches Kie or the database.
   Storage being unavailable degrades to a session-only theme, never to an error.

Markup consumes recipes (`.panel`, `.row`, `.tile`, `.btn`, `.input`, `.chip`, `.note`,
`.grid-divided`), not raw colours. They live in `@layer components` so a utility beside them in the
markup still wins — unlayered, `.input { width: 100% }` would silently beat the `w-auto` next to it.

---

## Type, density and motion

**Type.** Geist Sans and Geist Mono, shipped as an npm package rather than fetched from Google Fonts:
the files sit in `node_modules`, so a build never needs the network and there is no third-party
request at runtime. Sans and Mono share a skeleton, which is why a table of slugs reads as typeset
rather than as two fonts colliding. Body is 14px at `-0.011em`; headings tighten to `-0.021em`
because tracking that looks right at 14px looks gappy at 22px. Slugs, ids, paths and counts use
`.mono` (12px, tabular figures) so numbers do not jitter as a polling view updates.

**Density.** This is a workspace, not a document. Rows are 2.5rem-ish, buttons are 2rem, panel
padding is 1rem, and the home screen is two columns rather than one centred stack. There is no hero:
a hero on the screen you open fifty times a day is fifty wasted screenfuls.

**Icons.** One hand-drawn set on a 16px grid at 1.5 stroke (`components/shell/icons.tsx`), all
`currentColor`. Unicode glyphs (★ ▶ ✕ →) were doing this job and cannot: they render in whatever
font the platform picks, sit off the baseline, and ignore stroke weight.

**Motion.** Utility register — feedback and state only. Four durations (110/140/180/220ms) and three
easings, tokenised in `:root` and reused everywhere; uncoordinated one-off timings are what make an
interface feel assembled. There is no load choreography and nothing scroll-triggered: content on a
tool appears immediately, and animating a dashboard's arrival only makes it feel slow. Only
`transform` and `opacity` are animated. The one looping animation in the app is the indeterminate bar
on a running generation, and it means something. Under `prefers-reduced-motion` that bar stops
travelling and becomes a static accent fill — movement removed, meaning kept.

---

## Studio

Three panes: **model picker** (left), **parameter form** (center), **preview + queue** (right).

### Choosing a model

Progressive narrowing, because a flat list of 86 slugs is unusable:

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

**Pinned sits above all of it.** Most visits want one of four models, and progressive narrowing is
still four decisions to reach a model you used yesterday. A star on every model row — in the picker,
in the catalog, and in the generate screen's own header — puts it in a shortlist that renders at the
top of the picker, in the home sidebar, and in a nav popover reachable from any screen. The order is
editable by arrows rather than drag: it is five rows on a local single-user tool, and two buttons owe
nothing to touch, keyboard or pointer-capture.

A star never navigates, and never sits *inside* the row link — a `<button>` in an `<a>` is invalid
and behaves like it. A pin whose model has left the registry is shown, unlinkable, saying so; it is
not silently dropped, because the pin is a statement about how you work.

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
| `enum` | Segmented control at ≤4 options, select above that (`.select-field`) |
| `number` | Slider **plus** a numeric input — the slider for feel, the box for exactness. Honors `step` |
| `boolean` | Switch, with cost implications labelled ("increases generation cost") |
| `url` | Paste a URL, **Reuse** (a past output or an earlier upload), or **Upload** a local file |
| `url[]` | Same, per row and appending, with an `n / maxItems` counter |
| `seed` | Number input with a dice button, and a "lock" that carries the seed to the next run |
| `object[]` | Repeating card list with add / remove / drag-reorder |
| `color[]` | Swatch plus a share-of-image percentage per stop, with a running total and an even-shares button. The `xx.xx%` string Kie demands is produced from the number, never typed |
| `bbox[][]` | One drawing surface per image in the param's `drawsOn` list: drag a rectangle on the picture and the box is recorded in that image's own pixels. Falls back to four number inputs for an image the browser cannot load |

Every control shows its `describe` text on hover, and its documented default is visibly marked as
default so a deliberate change reads as deliberate.

**Reuse** is listed before **Upload** on purpose. The file you want is usually something this studio
made twenty minutes ago, and the old answer to that was to go and find it in the output folder. The
picker has two tabs — *Outputs* (thumbnails, the model slug and the prompt that made each one) and
*Uploads* (the input library, with `live` / `expired` on each row) — filtered to the kinds the
ParamDef accepts, so a video field never offers a PNG. An output already uploaded and still live is
badged `ready`: picking it costs nothing at all.

Generations marked private are excluded until asked for, here as everywhere. **Include private**
*adds* them to the list rather than filtering down to them, which is the opposite of the gallery's
`?nsfw=1` — a picker wants everything at once, a browse surface wants the thing you went looking for.
The label says which, because a checkbox reading only "Private" does not.

The list carries a count and its own limit: *"5 shown"*, *"the 60 most recent — search to narrow"*,
*"private hidden"*. A truncated list that says nothing is indistinguishable from a library that only
holds that much, and that is not a hypothetical — a page size that silently resolved to 1 read as a
broken private filter rather than as a page size.

Every `<select>` carries `.select-field`. A native dropdown draws its arrow hard against the right
border and the position is not stylable, so the arrow is turned off and redrawn inset from the edge
with the label padded clear of it — the same treatment the date fields' picker icon gets. New
dropdowns need the class; a bare `<select>` will not pick it up on its own.

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

### When validation speaks

Validation runs from the first render — the submit path depends on it — but a message is only shown
once it is about something you did:

| Moment | What is visible |
|---|---|
| Form opens | Nothing. A required field is marked `*` with a `Required` placeholder, which is guidance, not a complaint |
| A field is edited | That field's messages, and only that field's |
| Generate is pressed | Everything outstanding, plus the issue count beside the button. An advanced field among them opens the drawer |

Generate stays **enabled** on an incomplete form, and pressing it is what reveals the problem. A
disabled Generate is the version of this screen that cannot answer "why not?".

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

### Deleting

Not everything generated is worth keeping, so a tile and a detail page can both throw one away.

| | |
|---|---|
| What goes | The row, its asset rows, and the objects those rows point at, inside the workspace's own prefix. `bytesFreed` comes back so the storage meter can say what it bought |
| How it is asked | Two clicks, never a `confirm()`. The tile's trash arms to **Sure?** and disarms when the pointer leaves; the detail page's **Delete** arms to **Delete for good** and says how many files and how many bytes are about to go |
| What it refuses | Anything in flight — `waiting`, `queuing`, `generating`, `downloading`. The runner is still writing to that row and its downloader would recreate what the delete removed. **409**, with a message saying to wait |
| Lineage | Children are re-pointed at the deleted generation's own parent. Deleting a middle link shortens the chain rather than breaking it |
| Not soft | There is no trash and no undo. `nsfw` already covers "keep it, stop showing it", and a delete that only hid the row would be a second way to do that |

### Marked private

A generation can be marked private — **Keep private** in the Studio before it runs, or **Mark
private** on its detail page afterwards. What that governs:

| Surface | Marked work |
|---|---|
| Recent, on the home page | Never appears. This is the screen you did not choose to open |
| Gallery, unfiltered | Never appears, under any combination of the other filters |
| Gallery, **NSFW** chip on | Appears, and nothing else does — the two sets are disjoint |
| Its own detail page, by id | Appears in full. You went there |
| Lineage on a related generation | Listed, badged `NSFW`, because following the link leads somewhere |

The bytes are locked too, not just the listings. `/api/assets` serves by path, and a path is a date,
a family, a model slug and an id — guessable enough that hiding the tile would have been theatre. A
private generation's files need a capability token (`?k=`), minted server-side by the pages allowed
to render them; without a valid one the route answers **404**, so a probe cannot even confirm the
file is there. The token is derived from `KIE_API_KEY`, so there is nothing extra to configure, and
it does not expire — an expiring one would break a video mid-scrub for no gain against the thing this
defends, which is a pasted path rather than a held token.

The chip is a switch between two libraries rather than one more narrowing filter. "Include them too"
would put marked work back into an ordinary browse, which is the one thing this exists to prevent.
The chip carries a count, so the marked set is findable without being browsable, and the grid's
"N generations" counts the library you are actually in.

Marking up-front rather than after the fact is the point: a run marked from the gallery has already
spent the minutes between finishing and being noticed sitting on the home page. A re-run, a tweak,
and every run of a sweep inherit the mark — having to remember to re-tick it is how it leaks.

## Generation detail

- The media, full size, with a download button and reveal-in-folder.
- The complete parameter set as a readable table, plus raw `input_json` for copying.
- Metadata: model slug, state, credits consumed, generation time, `kie_task_id`, timestamps.
- **Lineage** — parent and children as a small graph. This is how iteration becomes visible.
- Actions: **Re-run identical**, **Tweak** (opens the Studio prefilled), **Save as preset**,
  **Mark private** (and unmark — a mark made by mistake undoes as easily as it was made).
- **Use as input** on each asset copies a URL a model can fetch. Deliberately distinct from the
  `open` link beside it: that one serves the file to *this* browser, and pasting it into a model
  field produces a generation that fails minutes later with a download error.

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

**Settings** — the accent picker (see Theming), API key status (never the value), credit balance and
spend history, the storage meter against the plan's quota, and the webhook URL when `KIE_PUBLIC_URL` is
configured.

## Interaction principles

1. **Nothing is hidden, only grouped.** Collapsed sections announce their contents.
2. **Prevent, don't reject.** Constraints disable controls up front and explain why.
3. **Async is visible.** The queue rail is always present; jobs survive navigation and restarts.
4. **Every output is traceable.** No item exists without the parameters that produced it.
5. **Verbatim over friendly.** Model slugs, `failMsg`, and enum values appear exactly as the API
   spells them, so what you see here matches what you'd read in the docs.
6. **One colour, everywhere.** No component hard-codes an accent; every interactive surface and
   state pill reads the same tokens, so a theme change is instant and complete — and the canvas
   underneath never moves.
