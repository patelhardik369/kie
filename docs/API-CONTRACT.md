# API contract and integration policy

The raw Kie contract — endpoints, headers, payload shapes, webhook signing — is documented once in
[`.claude/skills/kie-api/SKILL.md`](../.claude/skills/kie-api/SKILL.md). This file covers what the
*app* does with it: the lifecycle it drives, the policies it applies, and the failure modes it must
survive.

## 1. Lifecycle

```
 user submits
      │
      ▼
 validate against ModelDefinition ────────► reject locally (no API call)
      │
      ▼
 upload any local assets ──► cache local_path → kie_file_url (24h TTL)
      │
      ▼
 INSERT generations (state=waiting, input_json verbatim)
      │
      ▼
 rate gate (< 20 submissions / 10s)
      │
      ▼
 POST /jobs/createTask ──► store kie_task_id
      │
      ▼
 poll GET /jobs/recordInfo with backoff   ◄── webhook may short-circuit this
      │
      ├─ state=fail ──► persist failCode + failMsg ──► DONE (failed)
      │
      └─ state=success
             │
             ▼
      parse resultJson (it is a STRING)
             │
             ▼
      download every URL to KIE_OUTPUT_DIR
             │
             ├─ download fails ──► state=needs_retry (NOT complete)
             │
             ▼
      INSERT assets rows ──► state=complete
```

**A generation is `complete` only after its bytes are on disk.** Kie reporting `success` is not
completion — it's permission to start downloading.

## 2. Validation happens before the network

Every submission is checked against the model's `ParamDef` list and `Constraint` list first: required
fields present, enums matched exactly, numeric ranges and string lengths respected, array item counts
within bounds, and no mutually-exclusive group violated.

This is not redundant with server-side validation. A `422` from Kie names a field but not why, costs
a round trip, and reaches the user as noise. Local validation can say "Seedance 2.0 accepts a first
frame *or* reference images, not both" — which is the actual answer.

## 3. Polling policy

| Attempt | Delay |
|---|---|
| 1 | 3s |
| 2 | 5s |
| 3 | 8s |
| 4 | 12s |
| 5+ | 15s steady |

Timeouts by output kind: **images 5 minutes**, **video 20 minutes**. On timeout, the generation is
marked `stalled` rather than failed — the task may still be running on Kie's side, and a manual
"check again" must be able to recover it from its `kie_task_id`.

Polling is owned by a single server-side runner, not by browser tabs. Two tabs open must not double
the poll rate, and a closed browser must not stop a job. On server start, every non-terminal
generation resumes polling.

## 4. Rate limiting

Kie allows **20 new task submissions per 10 seconds** and rejects excess with `429` **without
queueing it**. The runner therefore keeps its own submission window and holds jobs locally rather
than letting them bounce. Concurrency (100+ running tasks) is not the binding constraint; submission
rate is.

## 5. Error handling

**Errors come back as HTTP 200.** Verified against the live API: a bad key returns status 200 with a
body of `{"code":401,"msg":"Unauthorized – Authentication failed…"}`. The envelope's `code` is the
real status, so `response.ok` proves nothing. `lib/kie/client.ts` checks the envelope first and
throws a typed `KieError` carrying `code`, `kind`, `retryable`, and Kie's `msg` verbatim as `detail`.

The codes below are envelope codes.

| Code | Retry? | What the user sees |
|---|---|---|
| `400` | No | "That request was malformed" + the offending field. Treat as a registry bug — the reference table probably has a field wrong |
| `401` | No | Fatal, surfaced at startup: "KIE_API_KEY is missing or invalid" |
| `404` | No | Task not found. Mark orphaned, stop polling |
| `422` | No | "The model rejected <field>." Almost always a wrong enum value or JSON type — check string-vs-integer `duration` first |
| `429` | Yes, backoff | Invisible. The runner absorbs it |
| `500` | Yes, bounded | "Kie had a server error, retrying (n/3)" |

Terminal `state: "fail"` is **not** an HTTP error. It carries `failCode` and `failMsg`, and it is how
content-moderation rejections arrive. Persist both verbatim and show them unmodified — paraphrasing a
moderation message makes it impossible to work out what tripped it.

### Local fail codes

The runner reuses the same two columns for failures that happen on our side. Every one is prefixed
`local/`, so nothing in the table can ever be mistaken for something Kie said.

| `fail_code` | State | Meaning |
|---|---|---|
| `local/submit_failed` | `failed` | `createTask` was refused and retrying will not help. Kie's `msg` is carried in `fail_msg`, since it names the offending field |
| `local/poll_timeout` | `stalled` | Past the budget in §3 and still running. Recoverable — the task id is kept |
| `local/poll_failed` | `stalled` | Repeated poll errors. Also recoverable |
| `local/task_not_found` | `orphaned` | `recordInfo` returned `404`. Polling stops |
| `local/download_failed` | `needs_retry` | Kie succeeded but the bytes are not local yet. Recoverable, and the URL is good for 14 days |

`local/download_failed` on a `failed` (not `needs_retry`) row means the one unrecoverable variant:
terminal `success` carrying no result URLs at all. Retrying would poll the same empty result forever.

## 6. Expiry — the rules that govern storage

| Artifact | Lifetime | Consequence |
|---|---|---|
| Uploaded inputs | ~24h | Cache `kie_file_url` with `expires_at`; re-upload when stale |
| Generated media | 14 days | Download immediately; never render the gallery from Kie URLs |
| `download-url` links | 20 minutes | Mint on demand, never store |
| Task metadata | 2 months | Local DB is the long-term record, not Kie's logs |

The download step is the app's single most important operation. It gets its own retry with backoff,
and a failure there blocks `complete` rather than being logged and forgotten.

## 7. Webhooks

Inactive unless `KIE_PUBLIC_URL` is set, because Kie cannot reach `localhost`. When active, the
handler verifies the HMAC signature, then converges the same state machine the poller drives.

Two invariants:

- **Idempotent** — keyed on `kie_task_id`. A duplicate delivery must be a no-op, not a second download.
- **Never authoritative** — the poller keeps running. A webhook that arrives first saves a poll; one
  that never arrives changes nothing.

## 8. Response-shape gotchas

Cost the most time when forgotten:

- `recordInfo` answers an **unknown `taskId` with `code: 422`, `msg: "recordInfo is null"`** — never a
  404. Mapped to `not_found` in `tasks.ts` so the generation lands in `orphaned` rather than `stalled`.
- `resultJson` is a **JSON-encoded string**. Parse it.
- It can be `null` on non-terminal states.
- `resultUrls` is an array even for single-output models.
- `seedream/5-pro-layer-decomposition` returns `resultObject.layers_data[]` *alongside* `resultUrls` —
  reading only `resultUrls` silently discards layer names, ordering, and bounding boxes.
- `GET /chat/credit` returns the balance as a bare integer in `data`, not an object.
- `POST /common/download-url` likewise returns a bare string in `data`.
