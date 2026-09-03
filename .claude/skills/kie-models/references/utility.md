# Utility endpoints

Everything that isn't a generation model. Same `Authorization: Bearer $KIE_API_KEY` on all of them.

| Purpose | Method + path | Host |
|---|---|---|
| Create a task | `POST /api/v1/jobs/createTask` | `api.kie.ai` |
| Poll a task | `GET /api/v1/jobs/recordInfo?taskId=` | `api.kie.ai` |
| Create a **Veo** task | `POST /api/v1/veo/generate` | `api.kie.ai` |
| Poll a **Veo** task | `GET /api/v1/veo/record-info?taskId=` | `api.kie.ai` |
| Remaining credits | `GET /api/v1/chat/credit` | `api.kie.ai` |
| Fresh download link | `POST /api/v1/common/download-url` | `api.kie.ai` |
| Upload (base64) | `POST /api/file-base64-upload` | `kieai.redpandaai.co` |
| Upload (stream) | `POST /api/file-stream-upload` | `kieai.redpandaai.co` |
| Upload (from URL) | `POST /api/file-url-upload` | `kieai.redpandaai.co` |

Full lifecycle semantics — task states, `resultJson` parsing, retry policy, and the two transports —
live in the `kie-api` skill. This file is the parameter reference.

**The Veo pair above is a second transport, not a utility.** Its request body is flat (no `input`
wrapper) and it reports a numeric `successFlag` instead of a `state` string. Models declare it with
`transport: 'veo'`; `lib/kie/veo.ts` adapts both directions. Three more Veo endpoints —
`GET /api/v1/veo/get-1080p-video`, `GET /api/v1/veo/get-4k-video`, `POST /api/v1/veo/extend` — act on
a finished task and are not wired up.

---

## Uploads

Host is **`https://kieai.redpandaai.co`**. Every model field named `*_url` / `*_urls` expects a
`fileUrl` from one of these, or another publicly reachable URL — never raw file content.

### `POST /api/file-base64-upload`

| field | type | req | notes |
|---|---|---|---|
| `base64Data` | string | ✓ | Includes the data-URI prefix: `data:image/png;base64,iVBORw0...` |
| `uploadPath` | string | | Logical folder, e.g. `images` |
| `fileName` | string | | Defaults to a generated name |

Recommended ceiling **10 MB**. Base64 inflates payloads ~33%, so use this only for small pasted or
canvas-generated data.

### `POST /api/file-stream-upload`

Multipart form: `file` (binary, required), `uploadPath` (optional), `fileName` (optional).
No documented size ceiling and the highest throughput — **the default choice for local files.**

### `POST /api/file-url-upload`

| field | type | req | notes |
|---|---|---|---|
| `fileUrl` | string | ✓ | Must be publicly accessible — Kie fetches it server-side |
| `uploadPath` | string | | |
| `fileName` | string | | |

Recommended ceiling **100 MB**, with a **30-second** download timeout on Kie's side.

### Shared response

```json
{
  "success": true, "code": 200, "msg": "File upload successful",
  "data": {
    "fileId": "file_abc123456",
    "fileName": "uploaded-name.jpg",
    "originalName": "original-name.jpg",
    "fileSize": 245760,
    "mimeType": "image/jpeg",
    "uploadPath": "images",
    "fileUrl": "https://kieai.redpandaai.co/files/images/my-image.jpg",
    "downloadUrl": "https://kieai.redpandaai.co/download/file_abc123456",
    "uploadTime": "2025-01-15T10:30:00Z",
    "expiresAt": "2025-01-18T10:30:00Z"
  }
}
```

Pass `data.fileUrl` to the model. **Uploaded files expire after ~24 hours** — cache the mapping in the
`uploads` table with `expires_at` and re-upload once stale rather than sending a dead URL. A `400`
here usually means an unsupported format; the docs do not publish a global allowlist, so the accepted
types are whatever the target model's reference table states.

---

## `GET /api/v1/chat/credit`

No parameters. The balance is the `data` field itself — a bare integer, not an object.

```json
{ "code": 200, "msg": "success", "data": 100 }
```

| code | meaning |
|---|---|
| 200 | Success |
| 401 | Invalid credentials |
| 402 | Insufficient credits for the operation |
| 500 | Server error |

Per-generation cost is more useful than this global figure: `recordInfo` returns `creditsConsumed` on
each task. Persist it per generation.

---

## `POST /api/v1/common/download-url`

Mints a fresh, directly downloadable link for a file Kie already produced.

```json
{ "url": "https://tempfile.aiquickdraw.com/path/to/image.jpg" }
```

Response — `data` is the download URL as a bare string:

```json
{ "code": 200, "msg": "success", "data": "https://tempfile.1f6c..." }
```

- **Links expire after 20 minutes.** Download immediately; never persist one.
- Only accepts URLs that kie.ai generated — external URLs return `422`.
- Codes: `200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `505`.

Useful when a stored result URL is still within its 14-day window but won't fetch directly. It does
**not** extend retention — it is not a substitute for downloading outputs to disk.

---

## Webhook verification

Relevant only when `KIE_PUBLIC_URL` is set. Headers `X-Webhook-Timestamp` (Unix seconds) and
`X-Webhook-Signature` (base64 HMAC-SHA256). The signed string is `taskId + "." + timestamp`, with
`taskId` read from the body's `data.task_id`. Implementation and the idempotency requirement are in
the `kie-api` skill.

---

## Account limits

| Limit | Value |
|---|---|
| New generation requests | 20 per 10 seconds |
| Concurrent running tasks | typically 100+ |
| Generated media retention | 14 days |
| Uploaded input retention | ~24 hours |
| Task log / metadata retention | 2 months |
| Download-URL validity | 20 minutes |

Over the request-rate limit, calls return `429` and **are not queued** — the job runner must throttle
submissions itself and retry with backoff.
