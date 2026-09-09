import 'server-only'

import { NextResponse } from 'next/server'

import { isKieError } from '../kie/errors.ts'
import { MissingKieKeyError, withRequestKey } from './kie-key.ts'
import { MissingWorkspaceError, requireWorkspace } from './workspace.ts'

/**
 * The boilerplate every API route would otherwise repeat.
 *
 * Three things have to happen at the top of nearly every handler: establish the
 * workspace, open a Kie key scope, and turn the failures of either into a
 * sensible response. Written out fifteen times, the fourth copy is where someone
 * forgets the workspace and the route quietly starts serving other people's rows.
 *
 * Two entry points, because not every route spends credits:
 *
 *   - `withWorkspace` — reads and writes of our own data. Needs to know whose
 *     data; needs no Kie key at all.
 *   - `withStudio` — anything that will call Kie. Resolves the key as well, and
 *     answers 401 with something actionable when there is none.
 *
 * Kie errors are mapped here too, in one place, so a 429 from any route is a 429
 * and not a 500 in some of them.
 */

export interface StudioContext {
  workspaceId: string
}

type Handler<T> = (context: StudioContext) => Promise<T>

/** Runs `handler` with the request's workspace. No Kie key is resolved. */
export async function withWorkspace(
  request: Request,
  handler: Handler<Response>,
): Promise<Response> {
  let workspaceId: string
  try {
    workspaceId = requireWorkspace(request)
  } catch (error) {
    return errorResponse(error)
  }

  try {
    return await handler({ workspaceId })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Runs `handler` with the request's workspace, inside its Kie key scope.
 *
 * Everything awaited inside sees the caller's key through
 * `lib/auth/kie-key.ts` — including code several modules deep that never took a
 * key as a parameter.
 */
export async function withStudio(
  request: Request,
  handler: Handler<Response>,
): Promise<Response> {
  let workspaceId: string
  try {
    workspaceId = requireWorkspace(request)
  } catch (error) {
    return errorResponse(error)
  }

  try {
    return await withRequestKey(request, () => handler({ workspaceId }))
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * One error shape for every route.
 *
 * The status codes matter to the client: `lib/client/api.ts` treats 401 and 402
 * as "fix your key" rather than "try again", which is what turns a dead-end
 * error toast into a link to Settings.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof MissingWorkspaceError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (error instanceof MissingKieKeyError) {
    return NextResponse.json(
      {
        error: error.message,
        detail: 'Add a key in Settings, or see /welcome for how to create one.',
      },
      { status: 401 },
    )
  }

  if (isKieError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        kind: error.kind,
        detail: error.detail,
        retryable: error.retryable,
      },
      { status: kieStatus(error.kind) },
    )
  }

  // Anything else is a bug in this app, not a fact about the caller's request.
  console.error('[kie-studio] unhandled route error:', error)
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Something went wrong.' },
    { status: 500 },
  )
}

/**
 * Kie's failure kinds as HTTP statuses the browser can act on.
 *
 * `unauthorized` and `insufficient_credits` are passed through as 401/402 rather
 * than being flattened into 502. They are the only two the user can actually do
 * something about, and the client keys its "check your key" path off exactly
 * those codes — collapsing them into a gateway error would hide the one class of
 * problem that has a fix.
 */
function kieStatus(kind: string): number {
  switch (kind) {
    case 'unauthorized':
      return 401
    case 'insufficient_credits':
      return 402
    case 'rate_limited':
      return 429
    case 'not_found':
      return 404
    case 'validation':
      return 422
    case 'bad_request':
      return 400
    default:
      return 502
  }
}
