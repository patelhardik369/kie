import 'server-only'

import crypto from 'node:crypto'

import { generations, getDb } from '../db/index.ts'
import type { ModelDefinition } from '../kie/registry/types.ts'
import { getRunner } from './runner.ts'

/**
 * Turning a validated input into rows the runner will pick up.
 *
 * Shared by `POST /api/kie/create` and `POST /api/kie/batch` so a single
 * submission and a 5-run sweep record identical rows — same columns, same
 * verbatim `input_json`, same hand-off. A sweep that stored its rows even
 * slightly differently would be a sweep whose runs are not individually
 * reproducible.
 *
 * Validation is the caller's job. By the time anything gets here the input has
 * already been checked against the ModelDefinition, because the useful error
 * message is the one that names the constraint, not the one that names a column.
 */

export interface SubmitOptions {
  /** The generation this was re-run or tweaked from. */
  parentId?: string | null
  /** Groups the runs of one sweep. */
  batchId?: string | null
  presetId?: string | null
}

export interface SubmittedGeneration {
  id: string
  input: Record<string, unknown>
}

/**
 * Inserts one generation and hands it to the runner.
 *
 * Returns as soon as the row exists — the runner may be holding the submission
 * behind the rate gate, and the row is what makes the job durable.
 */
export async function submitGeneration(
  model: ModelDefinition,
  input: Record<string, unknown>,
  options: SubmitOptions = {},
): Promise<SubmittedGeneration> {
  const [submitted] = await submitBatch(model, [input], options)
  return submitted!
}

/**
 * Inserts N generations sharing one `batch_id`, then enqueues them.
 *
 * Rows are written in a single insert so a sweep is all-or-nothing: a partial
 * batch would leave a `batch_id` whose runs cannot be compared against each
 * other, which is the entire point of sweeping.
 *
 * Enqueueing happens after the write, and is not awaited. The submission gate
 * paces the runs under Kie's 20-per-10s limit on its own.
 */
export async function submitBatch(
  model: ModelDefinition,
  inputs: Record<string, unknown>[],
  options: SubmitOptions = {},
): Promise<SubmittedGeneration[]> {
  if (inputs.length === 0) return []

  const now = Date.now()
  const submitted: SubmittedGeneration[] = inputs.map((input) => ({
    id: crypto.randomUUID(),
    input,
  }))

  await getDb()
    .insert(generations)
    .values(
      submitted.map(({ id, input }, index) => ({
        id,
        modelSlug: model.slug,
        family: model.family,
        // Denormalized so the gallery can filter without a registry lookup.
        capability: model.capability,
        // VERBATIM. This is what makes each run of a sweep reproducible on its own.
        inputJson: JSON.stringify(input),
        state: 'waiting' as const,
        parentId: options.parentId ?? null,
        batchId: options.batchId ?? null,
        presetId: options.presetId ?? null,
        // Offset so the grid orders a batch the way it was swept, not arbitrarily
        // by whichever row the millisecond clock happened to tie.
        createdAt: now + index,
      })),
    )

  const runner = getRunner()
  for (const { id } of submitted) runner.enqueue(id)

  return submitted
}

/** A fresh batch id. Exposed so a route can report it before the rows exist. */
export function newBatchId(): string {
  return crypto.randomUUID()
}
