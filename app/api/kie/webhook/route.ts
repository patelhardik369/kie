import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { generations, getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { getRunner } from '@/lib/jobs/runner.ts'
import { deliveryAction, verifyWebhook, type WebhookPayload } from '@/lib/kie/webhook.ts'

export const dynamic = 'force-dynamic'

/**
 * POST /api/kie/webhook — Kie's task callback.
 *
 * Off unless `KIE_PUBLIC_URL` is set, because Kie cannot reach localhost and
 * the runner never asks for a callback it will not receive. When it is set,
 * this route obeys the two invariants from docs/API-CONTRACT.md §7:
 *
 *   - **Never authoritative.** The payload's own view of the task is read for
 *     logging and nothing else. All this route does is wake the poll loop early,
 *     which then reads `recordInfo` exactly as it always would. One code path
 *     reaches the state machine whether the callback arrives, arrives twice, or
 *     never comes at all.
 *   - **Idempotent**, keyed on `kie_task_id`. A duplicate delivery for a
 *     generation that has already settled does nothing; one for a generation
 *     still in flight costs a poll it was about to make anyway.
 *
 * Everything answers 2xx once the signature checks out, including deliveries we
 * take no action on. Kie retries a non-2xx, and there is nothing to gain from
 * being re-sent a callback for a task that is already on disk.
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

    case 'wake':
      return NextResponse.json({
        taskId,
        id: generation!.id,
        action: getRunner().notify(generation!.id),
      })
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
