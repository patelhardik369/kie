'use client'

import { useEffect, useMemo, useState } from 'react'

import { GenerationStatus } from '@/components/queue/GenerationStatus.tsx'
import { deriveFields, pendingRequirements } from '@/lib/kie/constraints.ts'
import type { ModelDefinition, ParamGroup } from '@/lib/kie/registry/types.ts'
import { buildRequestInput } from '@/lib/kie/request.ts'
import { openingValues, studioDefaults } from '@/lib/kie/studio-defaults.ts'
import { validateInput } from '@/lib/kie/validate.ts'
import { Field } from './Field.tsx'
import { SavePreset } from './SavePreset.tsx'
import {
  INITIAL_SWEEP,
  SweepControls,
  resolveSweep,
  type SweepState,
} from './SweepControls.tsx'

/**
 * The generation form for any model.
 *
 * Generated entirely from `model.params` and `model.constraints`. There is no
 * per-model code here or in Field/controls — adding a model to the registry
 * yields a complete, usable form with no component changes.
 */

/** core and framing stay visible; the rest sit behind a disclosure. */
const PRIMARY_GROUPS: ParamGroup[] = ['core', 'framing']
const SECONDARY_GROUPS: ParamGroup[] = ['motion', 'audio', 'advanced']

export function ParamForm({ model }: { model: ModelDefinition }) {
  // Documented defaults, with the studio preferences over them — one output, 1K
  // images, 720p video. See lib/kie/studio-defaults.ts for why that is a layer
  // rather than an edit to the registry.
  const opening = useMemo(() => openingValues(model), [model])
  /** Only the overridden keys, so a field can show both numbers. */
  const preferences = useMemo(() => studioDefaults(model), [model])
  const [values, setValues] = useState<Record<string, unknown>>(opening)
  /**
   * Which fields the user has actually edited, and whether Generate has been
   * pressed.
   *
   * A form that opens shouting "Prompt is required." is telling you off for
   * something you have not had the chance to do yet. Validation runs from the
   * first render either way — the submit path depends on it — but a message only
   * becomes visible once the field has been touched, or once you have asked to
   * generate and it is genuinely what stopped you.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [attempted, setAttempted] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  /** Ids of this session's submissions, newest first. The DB is the real record. */
  const [jobs, setJobs] = useState<string[]>([])
  const [sweep, setSweep] = useState<SweepState>(INITIAL_SWEEP)
  /**
   * Marks the run private before it is submitted.
   *
   * Set here rather than afterwards because "afterwards" is too late: a run
   * marked from the gallery has already spent time on the home page. This is
   * also not a model parameter — it never reaches Kie, and it does not change
   * what is generated, only where it shows up.
   */
  const [keepPrivate, setKeepPrivate] = useState(false)

  /**
   * `?from=<id>` is the Tweak flow: prefill from a past generation and record it
   * as the parent, so the lineage survives the edit.
   *
   * Read from `window.location` inside an effect rather than with
   * `useSearchParams()`. That hook forces a client-side-rendering bailout unless
   * the whole form sits inside a Suspense boundary, which would take these 59
   * pages out of the prerendered HTML entirely — a real cost, to support a query
   * parameter that only matters after hydration anyway.
   */
  const [parentId, setParentId] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<{ state: 'loading' | 'done' | 'error'; message?: string }>(
    { state: 'done' },
  )

  /** What a preset could not carry over, reported rather than swallowed. */
  const [presetReport, setPresetReport] = useState<{
    name: string
    dropped: { key: string; message: string }[]
  } | null>(null)

  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const from = search.get('from')
    const presetId = search.get('preset')
    if (!from && !presetId) return

    let cancelled = false
    if (from) setParentId(from)
    setPrefill({ state: 'loading' })

    void (async () => {
      try {
        if (from) {
          const response = await fetch(`/api/kie/task/${from}`, { cache: 'no-store' })
          if (!response.ok) throw new Error('That generation could not be loaded.')
          const task = await response.json()
          if (cancelled) return

          if (task.modelSlug !== model.slug) {
            // Only reachable by hand-editing the URL. Parameters are
            // model-scoped, so applying them across models would submit nonsense.
            setPrefill({
              state: 'error',
              message: `Those parameters are for ${task.modelSlug}, not ${model.slug}.`,
            })
            return
          }

          // Replaces the defaults wholesale: the stored input IS the
          // configuration, and merging with defaults could reintroduce a field
          // it deliberately omitted.
          setValues(task.input ?? {})
          // Inherited, never reset: a variation on private work is private work.
          if (task.nsfw) setKeepPrivate(true)
          setPrefill({ state: 'done' })
          return
        }

        const response = await fetch(`/api/presets/${presetId}`, { cache: 'no-store' })
        const data = await response.json()
        if (cancelled) return
        if (!response.ok) throw new Error(data?.error ?? 'That preset could not be loaded.')

        if (data.modelMissing || data.preset.modelSlug !== model.slug) {
          setPrefill({
            state: 'error',
            message:
              data.message ??
              `That preset is for ${data.preset.modelSlug}, not ${model.slug}.`,
          })
          return
        }

        // A preset is PARTIAL, so it layers over the documented defaults rather
        // than replacing them. The server already dropped anything the registry
        // no longer accepts; what it dropped is reported below, never swallowed.
        setValues((defaults) => ({ ...defaults, ...data.values }))
        setPresetReport({ name: data.preset.name, dropped: data.dropped })
        setPrefill({ state: 'done' })
      } catch (cause) {
        if (!cancelled) {
          setPrefill({
            state: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [model.slug])

  const derived = useMemo(() => deriveFields(model, values), [model, values])

  // A disabled field's value must not reach the payload — otherwise clearing a
  // conflict in the UI would still submit the excluded field.
  const activeValues = useMemo(() => {
    const active: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (!derived[key]?.disabled) active[key] = value
    }
    return active
  }, [values, derived])

  const payload = useMemo(
    () => buildRequestInput(model, activeValues),
    [model, activeValues],
  )
  const validation = useMemo(() => validateInput(model, payload), [model, payload])
  const pending = useMemo(
    () => pendingRequirements(model, activeValues),
    [model, activeValues],
  )

  const errorsByKey = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const issue of validation.issues) {
      if (!issue.key) continue
      const root = issue.key.split(/[[.]/)[0]!
      ;(map[root] ??= []).push(issue.message)
    }
    return map
  }, [validation])

  const set = (key: string, value: unknown) => {
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    setValues((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })
  }

  /** A field's messages, once it is fair to show them. */
  const errorsFor = (key: string) =>
    attempted || touched.has(key) ? errorsByKey[key] : undefined

  const inGroups = (groups: ParamGroup[]) =>
    model.params.filter((p) => groups.includes(p.group))

  const primary = inGroups(PRIMARY_GROUPS)
  const secondary = inGroups(SECONDARY_GROUPS)

  // Surfaced on the collapsed header so a changed advanced value is never hidden.
  // Compared against what the form OPENED on, not the documented default: a
  // studio preference is not something the user changed, and badging it as such
  // on an untouched form would make the marker meaningless.
  const changedAdvanced = secondary.filter(
    (p) => values[p.key] !== undefined && values[p.key] !== opening[p.key],
  )

  const blocking = [
    ...pending,
    ...validation.issues.filter((i) => !i.key).map((i) => i.message),
  ]

  const resolution = useMemo(() => resolveSweep(model, sweep), [model, sweep])

  /** Everything the request needs is present and legal. */
  const ready =
    validation.ok &&
    pending.length === 0 &&
    (sweep.mode === 'single' || resolution.plan !== null)

  /**
   * The button stays live on an incomplete form, and pressing it reveals what is
   * missing. A disabled Generate that silently does nothing is the version of
   * this screen that cannot answer "why not?".
   */
  const canSubmit = !submitting && prefill.state !== 'loading'

  /**
   * Submits and immediately hands the job (or jobs) to the server runner.
   *
   * The response comes back before Kie has been called — the runner may be
   * holding the submission behind the rate gate — so what lands here are ids to
   * watch, not results. The form is deliberately not cleared: the common next
   * action is a tweak-and-resubmit.
   *
   * A sweep goes to `/api/kie/batch`, which validates every run before writing
   * any of them, so a bad value cannot leave half a batch submitted.
   */
  const submit = async () => {
    // From here on, every outstanding message is fair to show: you asked.
    setAttempted(true)
    if (!ready) {
      // Never report an issue inside a drawer that is closed — "3 issues to
      // resolve" above a form with nothing marked is worse than no message.
      if (secondary.some((p) => errorsByKey[p.key]?.length)) setShowAdvanced(true)
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const sweeping = resolution.plan !== null
      const response = await fetch(sweeping ? '/api/kie/batch' : '/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.slug,
          input: payload,
          ...(sweeping ? { plan: resolution.plan } : {}),
          ...(keepPrivate ? { nsfw: true } : {}),
          // Records the lineage when this form was opened from a past generation.
          ...(parentId ? { parentId } : {}),
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        const issues: string[] = (data?.issues ?? []).map(
          (issue: { key?: string; message: string }) =>
            issue.key ? `${issue.key}: ${issue.message}` : issue.message,
        )
        throw new Error([data?.error, ...issues].filter(Boolean).join(' '))
      }

      const ids: string[] = sweeping ? data.ids : [data.id]
      setJobs((prev) => [...ids, ...prev])
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const dismiss = (id: string) => setJobs((prev) => prev.filter((job) => job !== id))

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-5">
        {primary.map((param) => (
          <Field
            key={param.key}
            param={param}
            value={values[param.key]}
            onChange={(v) => set(param.key, v)}
            disabled={derived[param.key]?.disabled}
            reason={derived[param.key]?.reason}
            required={derived[param.key]?.required}
            max={derived[param.key]?.max}
            errors={errorsFor(param.key)}
            studioDefault={preferences[param.key] as string | number | undefined}
          />
        ))}
      </section>

      {secondary.length > 0 && (
        <section className="rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="text-(--color-ink-muted)">{showAdvanced ? '▾' : '▸'}</span>
              Advanced
              <span className="rounded-full border border-(--color-border) px-2 py-0.5 font-mono text-xs text-(--color-ink-muted)">
                {secondary.length}
              </span>
            </span>
            {!showAdvanced && changedAdvanced.length > 0 && (
              <span className="flex flex-wrap justify-end gap-1">
                {changedAdvanced.map((p) => (
                  <span
                    key={p.key}
                    className="rounded border border-(--color-accent)/40 bg-(--color-accent)/10 px-1.5 py-0.5 font-mono text-xs"
                  >
                    {p.key}={JSON.stringify(values[p.key])}
                  </span>
                ))}
              </span>
            )}
          </button>

          {/*
            Kept mounted when collapsed, not unmounted: find-in-page still
            reaches these controls, their state survives toggling, and nothing
            about the payload is ever invisible. Collapsed is not hidden.
          */}
          <div
            className={
              showAdvanced
                ? 'space-y-5 border-t border-(--color-border) px-5 py-5'
                : 'hidden'
            }
          >
            {secondary.map((param) => (
                <Field
                  key={param.key}
                  param={param}
                  value={values[param.key]}
                  onChange={(v) => set(param.key, v)}
                  disabled={derived[param.key]?.disabled}
                  reason={derived[param.key]?.reason}
                  required={derived[param.key]?.required}
                  max={derived[param.key]?.max}
                  errors={errorsFor(param.key)}
                  studioDefault={preferences[param.key] as string | number | undefined}
                />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm"
        >
          <span className="text-(--color-ink-muted)">{showPreview ? '▾' : '▸'}</span>
          Request preview
          <span className="font-mono text-xs text-(--color-ink-muted)">
            POST /api/v1/jobs/createTask
          </span>
        </button>
        {showPreview && (
          <pre className="overflow-x-auto border-t border-(--color-border) px-5 py-4 font-mono text-xs leading-relaxed">
            {JSON.stringify({ model: model.slug, input: payload }, null, 2)}
          </pre>
        )}
      </section>

      <SweepControls
        model={model}
        state={sweep}
        onChange={setSweep}
        resolution={resolution}
      />

      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
          keepPrivate
            ? 'border-fuchsia-400/50 bg-fuchsia-400/5'
            : 'border-(--color-border) bg-(--color-surface-raised)'
        }`}
      >
        <input
          type="checkbox"
          checked={keepPrivate}
          onChange={(e) => setKeepPrivate(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-fuchsia-400"
        />
        <span className="text-sm">
          Keep private
          <span className="ml-2 rounded-full border border-fuchsia-400/50 px-1.5 py-0.5 text-[11px] text-fuchsia-300">
            NSFW
          </span>
          <span className="mt-0.5 block text-xs text-(--color-ink-muted)">
            Kept out of Recent on the home page and out of the gallery grid; it
            appears only under the gallery&rsquo;s NSFW filter. Nothing about the
            generation itself changes &mdash; this is not sent to Kie
            {sweep.mode !== 'single' && ', and it applies to every run of the sweep'}.
          </span>
        </span>
      </label>

      <section className="space-y-3">
        {prefill.state === 'loading' && (
          <p className="rounded border-l-2 border-(--color-accent) bg-(--color-accent)/10 px-3 py-2 text-sm text-(--color-ink-muted)">
            Loading parameters from the generation you are tweaking…
          </p>
        )}
        {prefill.state === 'error' && (
          <p className="rounded border-l-2 border-amber-400 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
            {prefill.message} Showing this model&rsquo;s defaults instead.
          </p>
        )}
        {presetReport && (
          <div className="rounded border border-(--color-border) bg-(--color-surface-raised) px-3 py-2">
            <p className="text-xs text-(--color-ink-muted)">
              Applied preset <span className="text-(--color-ink)">{presetReport.name}</span>
              . Every field stays editable.
            </p>
            {presetReport.dropped.length > 0 && (
              // Reported, never silently swallowed: the registry has moved since
              // this preset was saved, and you should know what did not survive.
              <div className="mt-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5">
                <p className="text-xs text-amber-300">
                  {presetReport.dropped.length} field
                  {presetReport.dropped.length === 1 ? '' : 's'} could not be applied:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {presetReport.dropped.map((d) => (
                    <li key={d.key} className="text-[11px] text-(--color-ink-muted)">
                      {d.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {parentId && prefill.state === 'done' && (
          <p className="text-xs text-(--color-ink-muted)">
            Prefilled from{' '}
            <a href={`/gallery/${parentId}`} className="underline hover:text-(--color-ink)">
              an earlier generation
            </a>
            , which will be recorded as this run&rsquo;s parent.
          </p>
        )}

        {(attempted ? blocking : []).map((message) => (
          <p
            key={message}
            className="rounded border-l-2 border-red-400 bg-red-400/10 px-3 py-2 text-sm text-(--color-ink-muted)"
          >
            {message}
          </p>
        ))}

        {submitError && (
          <p className="rounded border-l-2 border-red-400 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {submitError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-(--color-accent) px-5 py-2.5 text-sm font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting
              ? 'Submitting…'
              : resolution.runs > 1
                ? `Generate ${resolution.runs} runs`
                : 'Generate'}
          </button>
          <span className="text-sm text-(--color-ink-muted)">
            {attempted && !ready
              ? `${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'} to resolve.`
              : 'Runs on the server — it keeps going if you close this tab.'}
          </span>

          <span className="ml-auto">
            <SavePreset model={model} values={activeValues} />
          </span>
        </div>
      </section>

      {jobs.length > 0 && (
        <section className="space-y-3 border-t border-(--color-border) pt-6">
          {jobs.map((id) => (
            <GenerationStatus key={id} id={id} onDismiss={dismiss} />
          ))}
        </section>
      )}
    </div>
  )
}
