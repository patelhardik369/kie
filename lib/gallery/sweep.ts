import type { ModelDefinition, ParamDef } from '../kie/registry/types.ts'

/**
 * Turning one form submission into N generations.
 *
 * Pure module — no env, no DB, no network — so the expansion is unit-testable
 * and the form can preview exactly what it is about to submit.
 *
 * Two shapes, from docs/PRD.md F5:
 *
 *   - **Generate ×N** — N runs of the same parameters. On a model with a `seed`,
 *     each run gets its own seed; without that they would be N identical
 *     requests, N times the credits, and one distinct output.
 *   - **Sweep** — one parameter varied across an explicit list of values, every
 *     other parameter held fixed. This is how "which cfg_scale is right?" gets
 *     answered in one submission instead of five.
 *
 * Every expansion returns FULL input objects, never patches. What gets stored in
 * `input_json` has to be the exact object sent to Kie, or the run stops being
 * reproducible.
 */

/** Kie's own ceiling is 20 submissions per 10s; this keeps one click well under it. */
export const MAX_SWEEP_RUNS = 20

/** Seeds are drawn below this, matching the form's dice button. */
const SEED_MAX = 2_147_483_647

export type SweepPlan =
  | { kind: 'count'; count: number }
  | { kind: 'values'; key: string; values: unknown[] }

export interface ExpandOptions {
  /** Injectable for deterministic tests. Returns [0, 1). */
  random?: () => number
}

export class SweepError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SweepError'
  }
}

/** The parameter a sweep can vary — anything with a bounded, listable domain. */
export function sweepableParams(model: ModelDefinition): ParamDef[] {
  return model.params.filter(
    (p) =>
      p.type === 'enum' ||
      p.type === 'number' ||
      p.type === 'seed' ||
      p.type === 'boolean',
  )
}

/** True when "Generate ×N" can vary anything, rather than repeating a request. */
export function hasSeed(model: ModelDefinition): boolean {
  return model.params.some((p) => p.type === 'seed')
}

function seedKey(model: ModelDefinition): string | undefined {
  return model.params.find((p) => p.type === 'seed')?.key
}

/** N distinct seeds. Distinct, because a repeated seed is a repeated output. */
export function randomSeeds(count: number, random: () => number = Math.random): number[] {
  const seeds = new Set<number>()
  // Bounded rather than while(true): a degenerate rng must not hang the request.
  for (let guard = 0; seeds.size < count && guard < count * 50; guard++) {
    seeds.add(Math.floor(random() * SEED_MAX))
  }
  // A pathological rng yields fewer than asked; pad deterministically rather
  // than fail, since the user asked for N runs, not N guaranteed-unique seeds.
  let filler = 1
  while (seeds.size < count) seeds.add(SEED_MAX - filler++)
  return [...seeds]
}

/**
 * Expands a base input into the list of inputs to submit.
 *
 * The base is never mutated, and every returned object is a fresh shallow copy —
 * two runs sharing an object reference would share an `input_json` too.
 */
export function expandSweep(
  model: ModelDefinition,
  base: Record<string, unknown>,
  plan: SweepPlan,
  options: ExpandOptions = {},
): Record<string, unknown>[] {
  const random = options.random ?? Math.random

  if (plan.kind === 'count') {
    const count = Math.floor(plan.count)
    if (!Number.isFinite(count) || count < 1) {
      throw new SweepError('A batch needs at least one run.')
    }
    if (count > MAX_SWEEP_RUNS) {
      throw new SweepError(`A batch is capped at ${MAX_SWEEP_RUNS} runs.`)
    }

    const key = seedKey(model)
    if (!key) {
      // No seed to vary: N identical requests. Honest, and the form says so.
      return Array.from({ length: count }, () => ({ ...base }))
    }
    return randomSeeds(count, random).map((seed) => ({ ...base, [key]: seed }))
  }

  const param = model.params.find((p) => p.key === plan.key)
  if (!param) {
    throw new SweepError(`${model.slug} has no parameter "${plan.key}".`)
  }
  if (plan.values.length === 0) {
    throw new SweepError(`Give at least one value to sweep ${plan.key} across.`)
  }
  if (plan.values.length > MAX_SWEEP_RUNS) {
    throw new SweepError(`A sweep is capped at ${MAX_SWEEP_RUNS} runs.`)
  }

  return plan.values.map((value) => ({ ...base, [plan.key]: value }))
}

export interface ParsedValues {
  values: unknown[]
  error?: string
}

/**
 * Parses the sweep value box for one parameter.
 *
 * Accepts a comma-separated list for every type, plus `a..b` (optionally
 * `a..b:step`) for numbers, because "seed 1..5" is how a sweep is actually
 * thought about.
 *
 * Values are typed to match the ParamDef, so an enum documented as the string
 * `"5"` never gets submitted as the number 5 — that distinction is exactly what
 * a 422 from Kie is usually about.
 */
export function parseSweepValues(param: ParamDef, raw: string): ParsedValues {
  const text = raw.trim()
  if (!text) return { values: [] }

  const numeric = param.type === 'number' || param.type === 'seed'

  const range = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)(?::(-?\d+(?:\.\d+)?))?$/.exec(text)
  if (range) {
    if (!numeric) {
      return { values: [], error: `${param.key} is not numeric, so a range does not apply.` }
    }
    const [, rawStart, rawEnd, rawStep] = range
    const start = Number(rawStart)
    const end = Number(rawEnd)
    const step = rawStep !== undefined ? Number(rawStep) : (param.step ?? 1)

    if (!Number.isFinite(step) || step <= 0) {
      return { values: [], error: 'A range step must be greater than zero.' }
    }
    if (end < start) {
      return { values: [], error: 'A range must end at or above where it starts.' }
    }

    const values: number[] = []
    // Epsilon guards float accumulation: 0.1..0.5:0.1 must include 0.5.
    for (let v = start; v <= end + 1e-9 && values.length <= MAX_SWEEP_RUNS; v += step) {
      values.push(Number(v.toFixed(6)))
    }
    if (values.length > MAX_SWEEP_RUNS) {
      return { values: [], error: `That range is more than ${MAX_SWEEP_RUNS} runs.` }
    }
    return { values }
  }

  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (numeric) {
    const values: number[] = []
    for (const part of parts) {
      const n = Number(part)
      if (!Number.isFinite(n)) return { values: [], error: `"${part}" is not a number.` }
      values.push(n)
    }
    return { values }
  }

  if (param.type === 'boolean') {
    const values: boolean[] = []
    for (const part of parts) {
      const lower = part.toLowerCase()
      if (lower !== 'true' && lower !== 'false') {
        return { values: [], error: `"${part}" must be true or false.` }
      }
      values.push(lower === 'true')
    }
    return { values }
  }

  if (param.type === 'enum' && param.enum) {
    const values: Array<string | number> = []
    for (const part of parts) {
      // Matched by string form so the documented type survives: an enum of
      // numbers stays numeric, an enum of numeric strings stays a string.
      const match = param.enum.find((option) => String(option) === part)
      if (match === undefined) {
        return {
          values: [],
          error: `"${part}" is not one of: ${param.enum.join(', ')}.`,
        }
      }
      values.push(match)
    }
    return { values }
  }

  return { values: parts }
}

/** One-line summary of what a plan will submit, for the confirm affordance. */
export function describeSweep(model: ModelDefinition, plan: SweepPlan): string {
  if (plan.kind === 'count') {
    const key = seedKey(model)
    return key
      ? `${plan.count} runs, each with its own ${key}.`
      : `${plan.count} identical runs — ${model.slug} has no seed to vary.`
  }
  return `${plan.values.length} runs, varying ${plan.key}: ${plan.values
    .map((v) => JSON.stringify(v))
    .join(', ')}.`
}
