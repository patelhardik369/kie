'use client'

import {
  MAX_SWEEP_RUNS,
  describeSweep,
  hasSeed,
  parseSweepValues,
  sweepableParams,
  type SweepPlan,
} from '@/lib/gallery/sweep.ts'
import type { ModelDefinition } from '@/lib/kie/registry/types.ts'

/**
 * Generate ×N and Sweep, the two ways one submission becomes several.
 *
 * The values box is parsed live against the chosen ParamDef, so an enum typo or
 * an out-of-range number is caught here rather than as a `422` four runs into a
 * batch you have already paid for.
 */

export type SubmitMode = 'single' | 'count' | 'values'

export interface SweepState {
  mode: SubmitMode
  count: number
  key: string
  raw: string
}

export const INITIAL_SWEEP: SweepState = { mode: 'single', count: 4, key: '', raw: '' }

export interface SweepResolution {
  plan: SweepPlan | null
  /** How many generations this will submit. */
  runs: number
  summary?: string
  error?: string
}

/** Turns the control state into a plan, or explains why it is not one yet. */
export function resolveSweep(
  model: ModelDefinition,
  state: SweepState,
): SweepResolution {
  if (state.mode === 'single') return { plan: null, runs: 1 }

  if (state.mode === 'count') {
    if (!Number.isFinite(state.count) || state.count < 2) {
      return { plan: null, runs: 0, error: 'A batch needs at least 2 runs.' }
    }
    if (state.count > MAX_SWEEP_RUNS) {
      return { plan: null, runs: 0, error: `A batch is capped at ${MAX_SWEEP_RUNS} runs.` }
    }
    const plan: SweepPlan = { kind: 'count', count: state.count }
    return { plan, runs: state.count, summary: describeSweep(model, plan) }
  }

  const param = model.params.find((p) => p.key === state.key)
  if (!param) {
    return { plan: null, runs: 0, error: 'Choose a parameter to sweep.' }
  }

  const parsed = parseSweepValues(param, state.raw)
  if (parsed.error) return { plan: null, runs: 0, error: parsed.error }
  if (parsed.values.length === 0) {
    return { plan: null, runs: 0, error: `Give the values to sweep ${param.key} across.` }
  }
  if (parsed.values.length < 2) {
    return { plan: null, runs: 0, error: 'A sweep needs at least 2 values.' }
  }

  const plan: SweepPlan = { kind: 'values', key: param.key, values: parsed.values }
  return { plan, runs: parsed.values.length, summary: describeSweep(model, plan) }
}

const controlClass =
  'rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 text-sm ' +
  'outline-none transition focus:border-(--color-accent)'

export function SweepControls({
  model,
  state,
  onChange,
  resolution,
}: {
  model: ModelDefinition
  state: SweepState
  onChange: (next: SweepState) => void
  resolution: SweepResolution
}) {
  const sweepable = sweepableParams(model)
  const param = sweepable.find((p) => p.key === state.key)

  const set = (patch: Partial<SweepState>) => onChange({ ...state, ...patch })

  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-border) px-4 py-3">
        <Tab active={state.mode === 'single'} onClick={() => set({ mode: 'single' })}>
          Single
        </Tab>
        <Tab active={state.mode === 'count'} onClick={() => set({ mode: 'count' })}>
          Generate ×N
        </Tab>
        <Tab
          active={state.mode === 'values'}
          onClick={() =>
            set({ mode: 'values', key: state.key || sweepable[0]?.key || '' })
          }
          disabled={sweepable.length === 0}
          title={
            sweepable.length === 0
              ? `${model.slug} has no parameter with a listable range to sweep.`
              : undefined
          }
        >
          Sweep
        </Tab>
      </div>

      {state.mode === 'count' && (
        <div className="space-y-2 px-4 py-3">
          <label className="flex items-center gap-2 text-sm">
            Runs
            <input
              type="number"
              min={2}
              max={MAX_SWEEP_RUNS}
              value={state.count}
              onChange={(e) => set({ count: Number(e.target.value) })}
              className={`${controlClass} w-20 font-mono`}
            />
          </label>
          {!hasSeed(model) && (
            // Said plainly rather than implying variation the model cannot give.
            <p className="text-xs text-amber-300">
              {model.slug} has no seed, so these runs are identical requests — N
              times the credits for N chances at the same output.
            </p>
          )}
        </div>
      )}

      {state.mode === 'values' && sweepable.length > 0 && (
        <div className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={state.key}
              onChange={(e) => set({ key: e.target.value, raw: '' })}
              aria-label="Parameter to sweep"
              className={`select-field ${controlClass}`}
            >
              {sweepable.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} ({p.key})
                </option>
              ))}
            </select>

            <input
              value={state.raw}
              onChange={(e) => set({ raw: e.target.value })}
              placeholder={placeholderFor(param)}
              aria-label="Values to sweep across"
              className={`${controlClass} min-w-56 flex-1 font-mono text-xs`}
            />
          </div>

          {param?.enum && (
            <p className="font-mono text-[11px] text-(--color-ink-muted)">
              options: {param.enum.join(', ')}
            </p>
          )}
          {param && (param.type === 'number' || param.type === 'seed') && (
            <p className="text-[11px] text-(--color-ink-muted)">
              A list like <code className="font-mono">1, 2, 4</code> or a range like{' '}
              <code className="font-mono">1..10</code> /{' '}
              <code className="font-mono">0.1..0.5:0.1</code>.
            </p>
          )}
        </div>
      )}

      {state.mode !== 'single' && (
        <p
          className={`border-t border-(--color-border) px-4 py-2 text-xs ${
            resolution.error ? 'text-red-300' : 'text-(--color-ink-muted)'
          }`}
        >
          {resolution.error ?? resolution.summary}
        </p>
      )}
    </div>
  )
}

function placeholderFor(param: { type: string; enum?: Array<string | number> } | undefined) {
  if (!param) return ''
  if (param.enum) return param.enum.slice(0, 3).join(', ')
  if (param.type === 'boolean') return 'true, false'
  return '1, 2, 4  or  1..10'
}

function Tab({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-(--color-accent) bg-(--color-accent)/15 text-(--color-ink)'
          : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
      }`}
    >
      {children}
    </button>
  )
}
