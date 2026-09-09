import 'server-only'

import crypto from 'node:crypto'

import { sealCurrentKeyFor } from '../auth/kie-key.ts'
import { generations, getDb, workspaces } from '../db/index.ts'
import type { ModelDefinition } from '../kie/registry/types.ts'

/**
 * Turning a validated input into rows a driver will pick up.
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
 *
 * Two things are written here that the local build had no need for: the owning
 * workspace, and the submitter's Kie key sealed against the new row's id. The
 * second is what lets a cron tick finish this job in twenty minutes' time with
 * no browser anywhere in sight.
 */

export interface SubmitOptions {
  /** The generation this was re-run or tweaked from. */
  parentId?: string | null
  /** Groups the runs of one sweep. */
  batchId?: string | null
  presetId?: string | null
  /**
   * Marks the run private before it exists, so it never surfaces in Recent even
   * for the moment between finishing and being marked by hand.
   */
  nsfw?: boolean
}

export interface SubmittedGeneration {
  id: string
  input: Record<string, unknown>
}

/** Inserts one generation. Returns as soon as the row exists. */
export async function submitGeneration(
  workspaceId: string,
  model: ModelDefinition,
  input: Record<string, unknown>,
  options: SubmitOptions = {},
): Promise<SubmittedGeneration> {
  const [submitted] = await submitBatch(workspaceId, model, [input], options)
  return submitted!
}

/**
 * Inserts N generations sharing one `batch_id`.
 *
 * Rows are written in a single insert so a sweep is all-or-nothing: a partial
 * batch would leave a `batch_id` whose runs cannot be compared against each
 * other, which is the entire point of sweeping.
 *
 * Nothing is driven from here. The caller decides — a route hands the ids to
 * `burst` inside `waitUntil`, which is the only place that knows whether the
 * invocation has time to spare.
 */
export async function submitBatch(
  workspaceId: string,
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

  await touchWorkspace(workspaceId)

  await getDb()
    .insert(generations)
    .values(
      submitted.map(({ id, input }, index) => ({
        id,
        workspaceId,
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
        nsfw: options.nsfw === true,
        // Sealed per row, because the seal is bound to the row's own id — one
        // ciphertext could not be shared across a batch even if we wanted it to.
        kieKeyEnc: sealCurrentKeyFor(id),
        // Due immediately; whichever driver gets there first takes the lease.
        nextPollAt: now,
        // Offset so the grid orders a batch the way it was swept, not arbitrarily
        // by whichever row the millisecond clock happened to tie.
        createdAt: now + index,
      })),
    )

  return submitted
}

/**
 * Records that this workspace exists and is in use.
 *
 * Upserted on every submission rather than at some notional signup, because
 * there is no signup — a workspace is only ever a string a browser started
 * sending. `lastSeenAt` is what a future sweep of abandoned workspaces would act
 * on.
 */
export async function touchWorkspace(workspaceId: string): Promise<void> {
  await getDb()
    .insert(workspaces)
    .values({ id: workspaceId, createdAt: Date.now(), lastSeenAt: Date.now() })
    .onConflictDoUpdate({
      target: workspaces.id,
      set: { lastSeenAt: Date.now() },
    })
}

/** A fresh batch id. Exposed so a route can report it before the rows exist. */
export function newBatchId(): string {
  return crypto.randomUUID()
}
