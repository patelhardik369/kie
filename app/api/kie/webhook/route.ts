import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { eq } from 'drizzle-orm'

import { generations, getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { driveOne } from '@/lib/jobs/drive.ts'
import { deliveryAction, verifyWebhook, type WebhookPayload } from '@/lib/kie/webhook.ts'

export const dynamic = 'force-dynamic'
/**
 * Seconds this route may run for. A literal, because Next only accepts a
 * statically analysable number here — `'max'` is valid in vercel.json but not
 * in a route segment config.
 *
 * 60 is the ceiling on Vercel's Hobby plan without Fluid compute, so it is the
 * value that works everywhere. On Pro, or with Fluid enabled, raising it to 300
 * lets a single invocation carry a long video further before handing back to the
 * cron — nothing breaks either way, because the job's position lives in the
 * database rather than on the stack.
 */
export const maxDuration = 60

/**
 * POST /api/kie/webhook — Kie's task callback.
 *
 * Off unless `KIE_PUBLIC_URL` is set. On a deployed studio it now genuinely
 * earns its place: Kie can reach us, and a callback turns "the next tick will
 * notice, within a minute" into "it is stored before the browser asks again".
 * It remains an optimisation and never a dependency — the tick alone is
 * sufficient, which is what keeps the same code correct on localhost.
 *
 * Two invariants from docs/API-CONTRACT.md §7 still hold exactly:
 *
 *   - **Never authoritative.** The payload's own view of the task is read for
 *     logging and nothing else. All this route does is run a step early, and
 *     that step reads `recordInfo` exactly as it always would. One code path
 *     reaches the state machine whether the callback arrives, arrives twice, or
 *     never comes at all.
 *   - **Idempotent**, keyed on `kie_task_id`. A duplicate delivery for a
 *     generation that has already settled does nothing; one for a generation
 *     still in flight costs a poll it was about to make anyway — and the lease
 *     means two simultaneous deliveries still produce one poll, not two.
 *
 * Everything answers 2xx once the signature checks out, including deliveries we
 * take no action on. Kie retries a non-2xx, and there is nothing to gain from
 * being re-sent a callback for a task whose bytes are already stored.
 *
 * The route is deliberately outside `withStudio`: Kie is the caller, it holds no
 * workspace and no key of ours, and the HMAC signature is the whole of its
 * authorisation. The key the resulting step spends is the one sealed on the row.
 */

export async function POST(request: Request) {
  const env = getEnv()
  if (!env.publicUrl || !env.webhookHmacKey) {
    // Not "forbidden" — the endpoint genuinely does not exist in this config.
    return NextResponse.json(
      { error: 'Webhooks are disabled. Set KIE_PUBLIC_URL to enable them.' },
      { status: 404 },
    )
  }

  let payload: WebhookPayload
  try {
    payload = (await request.json()) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Body is not JSON.' }, { status: 400 })
  }

  const verified = verifyWebhook(request.headers, payload, env.webhookHmacKey)
  if (!verified.ok) {
    console.warn(`[kie-studio] rejected webhook: ${verified.reason}`)
    return NextResponse.json({ error: verified.reason }, { status: 401 })
  }

  const { taskId } = verified
  const rows = await getDb()
    .select({ id: generations.id, state: generations.state })
    .from(generations)
    .where(eq(generations.kieTaskId, taskId))
    .limit(1)

  const generation = rows[0]

  switch (deliveryAction(generation?.state)) {
    case 'unknown':
      console.warn(`[kie-studio] webhook for unknown task ${taskId}`)
      return NextResponse.json({ taskId, action: 'ignored', reason: 'unknown task' })

    case 'ignore':
      return NextResponse.json({
        taskId,
        id: generation!.id,
        action: 'ignored',
        reason: generation!.state,
      })

    case 'wake': {
      // After the response, not before it. Kie is waiting on this request, and a
      // 20-second poll-and-download inside it would look like a failed delivery
      // and earn a retry.
      waitUntil(driveOne(generation!.id))
      return NextResponse.json({ taskId, id: generation!.id, action: 'stepped' })
    }
  }
}

/**
 * GET /api/kie/webhook — is the tunnel actually reaching this app?
 *
 * The one question worth answering while setting `KIE_PUBLIC_URL` up. It
 * reports whether callbacks are enabled and nothing else; the HMAC key is
 * never echoed.
 */
export function GET() {
  const env = getEnv()
  return NextResponse.json({
    enabled: Boolean(env.publicUrl && env.webhookHmacKey),
    callbackUrl: env.publicUrl ? `${env.publicUrl}/api/kie/webhook` : null,
  })
}
