# Deployment

Kie Studio on Vercel, with Supabase for Postgres and Storage, and every user
bringing their own Kie API key.

## What you need before you start

| Thing | Where | Notes |
|---|---|---|
| Supabase project | [supabase.com/dashboard](https://supabase.com/dashboard) | Free tier is enough. **You are at the 2-project cap** — pause one, or upgrade the org. |
| Vercel project | [vercel.com](https://vercel.com) | Hobby works; see [Scheduling](#4-scheduling-the-tick) for the one caveat. |
| A Kie API key | [kie.ai/api-key](https://kie.ai/api-key) | **Not an env var.** You add it in the app's Settings page after deploying. |

---

## 1. Environment variables

Five are required. Copy `.env.example` to `.env` for local work, and paste the
same values into **Vercel → Project → Settings → Environment Variables** for the
deployment.

| Variable | Required | Where to get it |
|---|---|---|
| `DATABASE_URL` | **yes** | Supabase → Settings → Database → Connection string → **Transaction pooler**, port `6543` |
| `SUPABASE_URL` | **yes** | Supabase → Settings → Data API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Supabase → Settings → API keys → `service_role` |
| `APP_ENCRYPTION_KEY` | **yes** | Generate it — see below |
| `CRON_SECRET` | **yes** | Generate it — see below |
| `SUPABASE_STORAGE_BUCKET` | no | Defaults to `kie-outputs` |
| `MAX_STORAGE_FILE_BYTES` | no | Defaults to 50 MB — the Supabase Free hard limit |
| `STORAGE_QUOTA_BYTES` | no | Defaults to 1 GB — the Supabase Free allowance |
| `KIE_PUBLIC_URL` | no | Webhooks. **Single-user deployments only** — see below |
| `KIE_WEBHOOK_HMAC_KEY` | only with the above | [kie.ai/settings](https://kie.ai/settings) → `webhookHmacKey` |

Generate the two secrets:

```bash
# APP_ENCRYPTION_KEY — must decode to exactly 32 bytes
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# CRON_SECRET — any long random string
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Why the transaction pooler

Every serverless invocation is its own process with its own connection pool.
Pointed at the direct database connection, a few dozen concurrent invocations
exhaust Supabase Free's connection limit and requests start failing with
`too many clients`. The pooler on port `6543` multiplexes them.

The app detects `:6543` and disables prepared statements automatically, which
that pool mode requires — leave it on and every second query in a request fails
with `prepared statement s1 already exists`.

### Why you probably want webhooks off

`KIE_PUBLIC_URL` is genuinely optional, and on a shared deployment it is worse
than optional.

Kie issues the webhook HMAC key **per account**, from
[kie.ai/settings](https://kie.ai/settings), and signs each callback with the key
of whoever submitted the task. This server can hold exactly one key. So the
moment a second person uses their own Kie key, their callbacks are signed with a
key this server does not have: verification fails, the route answers `401`, and
Kie retries on a schedule of its own.

What you give up by leaving it off is a few seconds of latency — a callback only
brings the next poll forward, and the scheduled tick completes every generation
without one. Turn it on only when you are the sole user and the key is yours.

---

## 2. Create the schema

```bash
npm run db:migrate
```

Applies `lib/db/migrations/` to whatever `DATABASE_URL` points at. It is
idempotent and safe to re-run.

`vercel.json` already runs it as part of the build command, so a deploy migrates
before it serves. The manual invocation is for the first setup and for local
work.

> **Deliberately not at runtime.** The old build migrated on server start. There
> is no single server start here — there are many cold starts, concurrently, and
> every one of them would race the others to apply the same migration.

---

## 3. Create the storage bucket

```bash
npm run storage:setup
```

Creates a **private** bucket with a 50 MB per-file limit, then writes, signs and
deletes a probe object to prove the credentials actually work.

If you make the bucket by hand instead, the setting that matters is **private**.
A public bucket serves every object to anyone who can guess a key, which makes
the capability tokens the app mints decorative.

### The two ceilings, and what they mean in practice

Supabase Free gives **1 GB total** and caps **any single object at 50 MB**.
Neither is raisable on that plan.

- A 1080p video is 10–50 MB. Expect **roughly 30–80 videos**, or thousands of
  images, before the 1 GB fills.
- Settings shows a live meter, warns at 80%, and **refuses new generations at
  100% — before submitting, so nothing is ever paid for and then discarded.**
- An output larger than 50 MB is not a failure. It is recorded as `too_large`
  with its Kie URL kept, and the gallery says so plainly with a download link and
  the fourteen-day expiry spelled out. Deleting a generation from the gallery
  reclaims its bytes immediately.

---

## 4. Scheduling the tick

Four things drive a job forward, layered so each covers what the one above
cannot:

| Driver | Runs when | Covers |
|---|---|---|
| Inline burst | On the submitting request, via `waitUntil` | Fast image models, usually start to finish |
| Tab poll | While a tab watches a generation | Whatever you are looking at |
| **On-visit sweep** | Every time the app is opened | **Anything of yours that stalled while you were away** |
| Scheduled tick | Whenever you schedule it | Everything, with nobody present |

### You are not required to set up a scheduler

**Vercel's Hobby plan only runs a cron job once per day.** A `* * * * *`
schedule is rejected at deploy time with:

> Hobby accounts are limited to daily cron jobs.

Once a day is useless for a twenty-minute video, so `vercel.json` declares no
cron at all and the app does not depend on one. `POST /api/jobs/sweep` fires on
every page load and advances your own due generations, which means the worst case
with no scheduler is that a job finishes **the next time you open the studio**
rather than the moment Kie is done.

That is a latency difference, not a data-loss one — which is the distinction
that matters, because a generation is billed by Kie whether or not we collect it.

A scheduler still earns its place if you want results stored while the app is
closed. Option A is free and takes two minutes.

### Option A — Supabase `pg_cron` (recommended, and free)

Free, runs every minute, and the database is already there. In the Supabase SQL
editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'kie-studio-tick',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://YOUR-APP.vercel.app/api/jobs/tick',
      headers := '{"Authorization": "Bearer YOUR_CRON_SECRET"}'::jsonb
    );
  $$
);
```

Check it is firing:

```sql
select * from cron.job_run_details order by start_time desc limit 10;
```

### Option B — Vercel Cron (Pro plan only)

`vercel.json` ships with **no** `crons` entry, because declaring a sub-daily one
fails the build on Hobby. On Pro, add it back:

```json
{
  "crons": [{ "path": "/api/jobs/tick", "schedule": "* * * * *" }]
}
```

Vercel injects an `x-vercel-cron` header, which the route accepts, so no secret
is needed on this path.

### Option C — any external cron

cron-job.org, a GitHub Action, an uptime monitor. One authenticated request:

```
POST https://YOUR-APP.vercel.app/api/jobs/tick
Authorization: Bearer <CRON_SECRET>
```

### Verifying it works

```bash
curl -X POST https://YOUR-APP.vercel.app/api/jobs/tick \
  -H "Authorization: Bearer $CRON_SECRET"
```

```json
{ "claimed": 2, "settled": 1, "progressed": 1, "failed": 0, "remaining": 0, "ms": 4210 }
```

`remaining` staying high means the tick is running slower than the queue is
arriving — raise the frequency, or pass `?batch=20`.

A wrong or missing secret returns **404**, not 401: an unauthenticated caller
learns nothing about whether the endpoint exists.

---

## 5. Deploy

```bash
vercel --prod
```

Or connect the repo in the Vercel dashboard. The build runs `npm run db:migrate
&& npm run build`.

After the first deploy, open the app and go to **Settings**:

1. Paste a Kie API key and press **Test & save** — it checks the key against
   Kie before storing it.
2. Copy your **workspace id** and keep it somewhere. It is the only way back to
   your work if you clear site data.

---

## 6. Bringing an existing local studio across

If you have generations in `data/kie.db` from the local build:

```bash
# Get your workspace id from Settings in the deployed app first.
npm run db:import -- --workspace wk_… --dry-run   # see what would move
npm run db:import -- --workspace wk_…             # actually move it
```

It looks for the old database at `./data/kie.db` and the old outputs at
`C:/Users/Hardik/generations/kie-studio`. If yours were elsewhere, point it there
for the one run — these are read by the script alone and have no place in `.env`:

```bash
LEGACY_DATABASE_FILE=/path/to/kie.db \
LEGACY_OUTPUT_DIR=/path/to/outputs \
  npm run db:import -- --workspace wk_…
```

It uploads every output to the bucket and writes the rows to Postgres. It is
**resumable** — every write is an upsert, so an interrupted run can just be run
again — and it **never deletes your local files**, so a failed import costs time
and nothing else.

Files past the 50 MB ceiling are reported and left behind, with their rows marked
`too_large`. Your local copies remain the only copies of those.

---

## Bring your own key

The defining decision of this deployment: **the server has no API key of its
own.** Each browser stores one in `localStorage` and sends it with each request.

There is deliberately **no API key in `.env`**. A key arrives as an `X-Kie-Key`
header on each request and is never read from the environment on the normal
path.

> **Advanced, and usually wrong.** `lib/env.ts` still honours a `KIE_API_KEY`
> variable as a last-resort fallback for a genuinely single-user private
> deployment. It is absent from `.env.example` on purpose: setting it on
> anything more than one person can reach means whoever finds the URL spends
> your credits. If you do not know you need it, you do not need it.

### The one place a key is stored server-side

A video takes up to twenty minutes and the tab that started it is often gone by
the time it finishes. So on submit, the key is encrypted with
`APP_ENCRYPTION_KEY` (AES-256-GCM, bound to that generation's id) and parked on
the row — enough for a tick to poll and store the result — and **deleted the
moment the job reaches a terminal state**.

What that buys and what it costs:

- A database dump alone yields nothing; the sealing key is in the environment.
- Someone holding **both** the database and the environment can unseal the keys
  of jobs *currently in flight*. That is the honest limit, and it is why the
  ciphertext is deleted the moment it stops being needed rather than kept.

Rotating `APP_ENCRYPTION_KEY` invalidates in-flight stored keys. Those jobs park
as `stalled` with a clear message, and **Check again** from the browser re-arms
them with a fresh key. Asset links re-mint on the next render.

---

## Access and isolation

There are no accounts. Each browser generates a 128-bit workspace id, stored in
both `localStorage` and a cookie, and every row carries it.

- A stranger who finds the URL sees an **empty studio** and must supply their own
  Kie key to do anything.
- The id is a **bearer secret** — whoever holds the string is the workspace, the
  same trust level as the API key beside it. Do not paste it into a group chat.
- It is **not authentication**. It partitions data; it does not defend against
  someone with database access. If that matters, the answer is Supabase Auth with
  RLS, not a longer random string.
- Settings exports and imports it, which is how you move a studio to another
  browser or recover one after clearing site data.

Isolation is enforced in application code, not by Postgres: the `service_role`
connection bypasses RLS entirely. `lib/gallery/queries.test.ts` has a
`workspace isolation` suite specifically to keep that honest.

---

## Local development

```bash
cp .env.example .env     # fill in the five required values
npm run db:migrate
npm run storage:setup
npm run dev
```

Pointing at the same Supabase project as production works but shares its data.
For a clean split, make a second project or a Supabase branch.

`KIE_PUBLIC_URL` stays empty locally — Kie cannot reach `localhost`, so webhooks
are off and the tick is the only completion path. Drive it by hand while
developing:

```bash
curl -X POST localhost:3000/api/jobs/tick -H "Authorization: Bearer $CRON_SECRET"
```

### Tests

```bash
npm test                                             # unit tests, no database needed
TEST_DATABASE_URL=postgresql://… npm test            # plus the integration suites
```

`TEST_DATABASE_URL` is read only by the test suites, so it belongs on the command
line rather than in `.env`.

Without `TEST_DATABASE_URL` the database-backed suites **skip** with a printed
reason rather than failing. Point it at a scratch database — **never one with
real generations in it**, as the tests truncate every table.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `prepared statement "s1" already exists` | Prepared statements on the transaction pooler | Use the port-`6543` URL; the app then disables them itself |
| `too many clients already` | Pointed at the direct connection | Switch to the pooler URL |
| Deploy fails: "Hobby accounts are limited to daily cron jobs" | A sub-daily `crons` entry in `vercel.json` | Remove it — the app does not need one. [Section 4](#4-scheduling-the-tick) |
| Generations only finish when you open the app | No scheduler; the on-visit sweep is doing the work | Working as designed. Add Option A if you want them stored while closed |
| Generations stick in `waiting` even after reloading | Sweep failing — check the function logs | [Section 4](#4-scheduling-the-tick) |
| `401` on every generation | No key in this browser | Settings → paste a key → Test & save |
| `507` on submit | Storage full | Delete generations from the gallery, or raise `STORAGE_QUOTA_BYTES` |
| Images 404 in the gallery | Bucket is public, or the wrong bucket | `npm run storage:setup` reports both |
| Gallery empty after clearing site data | Lost the workspace id | Settings → paste the id back in |
| `APP_ENCRYPTION_KEY must decode to exactly 32 bytes` | Truncated or non-base64 value | Regenerate with the command in section 1 |
