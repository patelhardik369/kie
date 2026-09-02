---
name: kie-api
description: The Kie AI unified API contract — base URLs, auth, the single createTask endpoint, the recordInfo polling state machine, the resultJson-is-a-string gotcha, file uploads and their expiry, webhook HMAC verification, credits, rate limits, and error handling. Load this BEFORE writing or editing anything under lib/kie/, app/api/kie/, the job runner, or the output downloader — and whenever debugging a failed generation, a 401/429, a stuck task, or a missing result URL.
---

# Kie AI — Unified API Contract

Every generation model on Kie — all 59 in this project's scope — goes through **one** endpoint.
Only the `model` string and the shape of `input` change. There is no per-model route.

## Base URLs

| Purpose | Host |
|---|---|
| Generation + query + credits | `https://api.kie.ai/api/v1` |
| File upload (**different host**) | `https://kieai.redpandaai.co` |
| Documentation (markdown) | `https://docs.kie.ai/....md` |

## Auth

```
Authorization: Bearer $KIE_API_KEY
Content-Type: application/json
```

Server-side only. Never expose the key to a client component or echo it in a response.

---

## 1. Create a task

```
POST https://api.kie.ai/api/v1/jobs/createTask
```

```json
{
  "model": "wan/2-7-image-to-video",
  "callBackUrl": "https://your-domain.com/api/kie/webhook",
  "input": { "prompt": "...", "resolution": "1080p" }
}
```

- `model` — **required**, exact slug from the registry.
- `callBackUrl` — optional. Omit it on localhost (Kie cannot reach you); the poller handles completion.
- `input` — required, model-specific. Validate against the `ModelDefinition` before sending.

### Documented defaults are NOT applied server-side

Verified against the live API. `seedream/5-lite-text-to-image` documents `aspect_ratio` as required
with a default of `1:1`; omitting it fails. **Every required field must appear in the payload**, using
its documented default when the user did not choose one — that is what `lib/kie/request.ts`
(`buildRequestInput`) exists for. Never assume Kie fills a default in for you.

Response:

```json
{ "code": 200, "msg": "success", "data": { "taskId": "task_wan_1765180586443" } }
```

> **`200` means the task was *created*, not completed.** Nothing has been generated yet. Treat this
> response as nothing more than a receipt for a `taskId`.

## 2. Poll for the result

```
GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId={taskId}
```

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "...",
    "model": "wan/2-7-image-to-video",
    "state": "success",
    "param": "{...}",
    "resultJson": "{\"resultUrls\":[\"https://....mp4\"]}",
    "failCode": null,
    "failMsg": null,
    "costTime": 48213,
    "completeTime": 1765180634000,
    "createTime": 1765180586443,
    "updateTime": 1765180634000,
    "creditsConsumed": 120
  }
}
```

### State machine

```
waiting ──▶ queuing ──▶ generating ──┬──▶ success   (terminal — resultJson populated)
                                     └──▶ fail      (terminal — failCode / failMsg populated)
```

`waiting`, `queuing`, `generating` are all non-terminal. Only `success` and `fail` end the poll.

### resultJson is a JSON-encoded **string**, not an object

`JSON.parse` it. Its inner shape varies:

| Output kind | Shape |
|---|---|
| Images / video / audio | `{ "resultUrls": ["...", "..."] }` |
| Text or structured output | `{ "resultObject": { ... } }` |

Always guard: `resultJson` can be `null` on non-terminal states, and `resultUrls` can hold more than
one URL (multi-image models, layer decomposition).

### Polling policy

Exponential backoff, not a tight loop. Suggested: 3s, 5s, 8s, 12s, then steady 15s, capped by a
per-model timeout (images ~5 min, video ~20 min). Video models routinely take minutes.

## 3. Credits

```
GET https://api.kie.ai/api/v1/chat/credit
```

Also available per-task as `data.creditsConsumed` — record it on the `generations` row so cost is
attributable to individual generations, not just an account total.

---

## 4. File uploads

Host is **`https://kieai.redpandaai.co`**, not `api.kie.ai`. Same Bearer auth.

| Endpoint | Body | Limit |
|---|---|---|
| `POST /api/file-base64-upload` | `{ base64Data, uploadPath?, fileName? }` — `base64Data` includes the `data:image/png;base64,` prefix | 10 MB recommended max |
| `POST /api/file-stream-upload` | multipart: `file` (binary, required), `uploadPath?`, `fileName?` | large files, highest throughput |
| `POST /api/file-url-upload` | `{ fileUrl, uploadPath?, fileName? }` — must be publicly reachable | 100 MB max, 30s fetch timeout |

Response — **verified against the live endpoint**, all three variants identical:

```json
{
  "success": true, "code": 200, "msg": "File uploaded successfully",
  "data": {
    "success": true,
    "fileName": "1788331086662-khed0yx8az.png",
    "filePath": "kieai/528618/kie-studio/1788331086662-khed0yx8az.png",
    "downloadUrl": "https://tempfile.redpandaai.co/kieai/528618/kie-studio/1788331086662-khed0yx8az.png",
    "fileSize": 679722,
    "mimeType": "image/png",
    "uploadedAt": "2026-09-02T06:38:07.240Z"
  }
}
```

### There is no `fileUrl` — pass `data.downloadUrl`

The field a model wants is **`downloadUrl`**. `fileUrl` does not exist in the response, and neither
do `fileId`, `originalName`, `uploadPath`, `uploadTime` or `expiresAt`. Reading `data.fileUrl` yields
`undefined`, `JSON.stringify` then drops the key entirely, and an upload appears to succeed while
attaching nothing — a silent failure with a `200` on it. This cost real time once; the fixture in
`lib/library/library.test.ts` had invented the same field, so the tests agreed with the bug.

The only timestamp is `uploadedAt`. Kie states no expiry, so measure the ~24h lifetime from there.

Prefer **stream upload** for local files: it avoids the ~33% base64 size inflation and has no 10 MB
ceiling. Use base64 only for small pasted or canvas-generated data.

---

## 5. Expiry — the durability rule

| Artifact | Lifetime |
|---|---|
| Uploaded input files | **~24 hours** |
| Generated media (result URLs) | **14 days** |
| Task log records / metadata | 2 months |

**Every successful generation must have its bytes downloaded to `KIE_OUTPUT_DIR` and an `assets` row
written before the job is marked complete.** A generation whose only record is a Kie URL is a
generation you will lose. Never render a gallery from remote Kie URLs.

The `uploads` table caches `local_path -> kie_file_url` with `expires_at` so the same reference image
isn't re-uploaded within its 24h window — but re-upload once expired rather than sending a dead URL.

---

## 6. Webhooks

Only engaged when `KIE_PUBLIC_URL` is set (deployed or tunnelled). Kie POSTs to your `callBackUrl`.

Headers:

| Header | Meaning |
|---|---|
| `X-Webhook-Timestamp` | Unix timestamp (seconds) the callback was sent |
| `X-Webhook-Signature` | Base64 HMAC-SHA256 signature |

The signed string is `taskId + "." + timestamp`, where `taskId` comes from the body's `data.task_id`:

```js
import crypto from 'node:crypto'

function verify(taskId, timestamp, received, hmacKey) {
  const expected = crypto
    .createHmac('sha256', hmacKey)
    .update(`${taskId}.${timestamp}`)
    .digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
```

`timingSafeEqual` throws on length mismatch — compare lengths first, as above.

Payload shape:

```json
{ "taskId": "...", "code": 200, "msg": "Success",
  "data": { "task_id": "...", "callbackType": "..." } }
```

The webhook is an **optimization, never the source of truth**. It can be missed, duplicated, or
delayed — so the handler must be idempotent (key on `kie_task_id`) and the poller must remain the
fallback that guarantees eventual completion.

---

## 7. Limits and errors

**Rate limits (per account):** up to **20 new generation requests per 10 seconds**; typically **100+
concurrent running tasks**. Over the limit, requests are rejected with `429` and are *not* queued — so
the job runner needs its own submission throttle plus retry-with-backoff on 429.

### Errors arrive as HTTP 200 — check the envelope, not the status

Verified against the live API: an unauthenticated request returns **HTTP 200** with

```json
{"code":401,"msg":"Unauthorized – Authentication failed. Please check that your Authorization and Content-Type headers are correctly set."}
```

So `response.ok` is **not** a success check. The codes below are envelope `code` values; the HTTP
status is usually 200 regardless. `lib/kie/client.ts` unwraps this and throws a typed `KieError`.

| Code | Meaning | Handling |
|---|---|---|
| `400` | Missing / malformed parameter | Surface the validation error; don't retry |
| `401` | Missing or wrong API key | Fail loudly at startup, not per-request |
| `404` | Unknown `taskId` | Mark the generation orphaned; stop polling — but see below: `recordInfo` does not actually send it |
| `422` | Validation error on `input` | Show which field the model rejected; don't retry |
| `429` | Rate limited | Backoff and retry — the request never entered a queue |
| `500` | Kie server error | Retry with backoff, bounded attempts |

A `fail` state carries `failCode` / `failMsg` — persist both verbatim on the `generations` row.
Content-moderation rejections arrive this way, not as an HTTP error.

### `recordInfo` reports an unknown task as `422`, not `404`

Observed live: polling a taskId that does not exist returns

```json
{"code":422,"msg":"recordInfo is null","data":null}
```

Taken at face value that is "the model rejected a parameter", which sends you hunting for a bad enum
on a task that was never created — and, worse, parks the generation as `stalled`, a state whose whole
point is that retrying may still work. Special-case it **on this endpoint only** (a `422` from
`createTask` really is a bad parameter) and map it to `not_found` / orphaned:
`lib/kie/tasks.ts` matches `msg` against `/recordinfo is null/i`.

### `500` is not reliably retryable — read `msg`

Observed live: a payload missing a required field came back as `{"code":500,"msg":"This field is
required"}`. Kie dresses some validation errors as server errors, so a blind retry loops forever on a
request that can never succeed. Always surface `msg` (kept as `KieError.detail`), and bound 500
retries rather than treating them as purely transient.

Separately, `bytedance/seedream` (Seedream 3.0) reached a terminal `fail` with
`failCode: 500, failMsg: "internal error, please try again later."` on a valid minimal payload — that
tier may be degraded. Prefer a 4.5/5.x tier for smoke tests.
