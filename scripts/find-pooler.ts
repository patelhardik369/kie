/**
 * Works out the right DATABASE_URL when the direct connection will not resolve.
 *
 *   npm run db:find-pooler
 *
 * Supabase's direct host, `db.<ref>.supabase.co`, is **IPv6-only** on current
 * projects. On an IPv4-only network — which most home and office connections
 * still are — it fails with `ENOTFOUND`, which reads like a typo in the
 * hostname rather than a missing route. The transaction pooler is reachable
 * over IPv4, and is what this deployment wants anyway.
 *
 * The pooler host carries a region this script cannot look up (it is not in the
 * project ref), so it probes the plausible ones with the password already in
 * `.env` and reports which answers.
 *
 * It never prints the password, and never writes to `.env` — it tells you the
 * two fields to change.
 */

import process from 'node:process'

import postgres from 'postgres'

const raw = process.env.DATABASE_URL?.trim()

if (!raw) {
  console.error('\n[kie-studio] DATABASE_URL is not set in .env.\n')
  process.exit(1)
}

let parsed: URL
try {
  parsed = new URL(raw)
} catch {
  console.error(`\n[kie-studio] DATABASE_URL is not a URL.\n`)
  process.exit(1)
}

const password = decodeURIComponent(parsed.password)
if (!password) {
  console.error(
    '\n[kie-studio] DATABASE_URL has no password in it.\n' +
      '  Supabase → Settings → Database → Reset database password, then put it in the URL.\n',
  )
  process.exit(1)
}

/** `db.<ref>.supabase.co` or `postgres.<ref>` both carry the project ref. */
const ref =
  /^db\.([a-z0-9]+)\.supabase\.co$/.exec(parsed.hostname)?.[1] ??
  /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(parsed.username))?.[1]

if (!ref) {
  console.error(
    `\n[kie-studio] Could not find a project ref in the host "${parsed.hostname}".\n` +
      '  Expected db.<ref>.supabase.co, or a username of postgres.<ref>.\n',
  )
  process.exit(1)
}

/**
 * Supabase's regions, commonest first. Both `aws-0` and `aws-1` prefixes are in
 * service — which one a project gets depends on when it was created, so both are
 * tried rather than assumed.
 */
const REGIONS = [
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'ca-central-1',
  'sa-east-1',
]

console.log(`[kie-studio] project ref: ${ref}`)
console.log('[kie-studio] probing transaction poolers over IPv4…\n')

let found: string | undefined
/**
 * A host that recognised the project but rejected the password.
 *
 * Worth separating from a plain failure, because it is the single most useful
 * result this script can produce: it identifies the region *and* tells you the
 * password is the only thing left wrong. Supavisor answers "Tenant or user not
 * found" for a project it does not host, and a real authentication error only
 * for one it does.
 */
let wrongPasswordAt: string | undefined

for (const prefix of ['aws-1', 'aws-0']) {
  for (const region of REGIONS) {
    const host = `${prefix}-${region}.pooler.supabase.com`
    const sql = postgres({
      host,
      port: 6543,
      database: 'postgres',
      username: `postgres.${ref}`,
      password,
      ssl: 'require',
      prepare: false,
      max: 1,
      // Short: a wrong region answers quickly, and there are a lot to get through.
      connect_timeout: 6,
      onnotice: () => {},
    })

    try {
      await sql`select 1`
      found = host
      console.log(`  ${host}  ✓ connected`)
      await sql.end({ timeout: 2 })
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Supavisor answers "Tenant or user not found" for a project it does not
      // host — expected for every region but one. An authentication failure is
      // the opposite: it means the project IS here and only the password is
      // wrong, which is the answer worth stopping for.
      if (/password authentication failed|invalid password/i.test(message)) {
        wrongPasswordAt = host
        console.log(`  ${host}  ✓ project is here — but the password is wrong`)
        await sql.end({ timeout: 2 }).catch(() => undefined)
        break
      }

      const terse = /tenant or user not found/i.test(message)
        ? 'not this region'
        : message.split('\n')[0]
      console.log(`  ${host}  · ${terse}`)
      await sql.end({ timeout: 2 }).catch(() => undefined)
    }
  }
  if (found || wrongPasswordAt) break
}

if (wrongPasswordAt) {
  console.error(
    `\n[kie-studio] Found your project — it is in ${regionOf(wrongPasswordAt)}.\n` +
      '  The host is right; the PASSWORD is wrong.\n\n' +
      '  This is the database password you set when creating the project, not\n' +
      '  your Supabase login. If you never noted it down, reset it:\n\n' +
      `    https://supabase.com/dashboard/project/${ref}/settings/database\n` +
      '    → Database password → Reset database password\n\n' +
      '  Then set DATABASE_URL to:\n\n' +
      `    postgresql://postgres.${ref}:<NEW-PASSWORD>@${wrongPasswordAt}:6543/postgres\n\n` +
      '  If the password contains @ : / ? # or %, percent-encode it, or it will\n' +
      '  break the URL. Then: npm run db:migrate\n',
  )
  process.exit(1)
}

if (!found) {
  console.error(
    '\n[kie-studio] No pooler recognised this project.\n\n' +
      '  Two likely causes:\n' +
      '    1. The project is in a region not listed in this script.\n' +
      '    2. The project ref in DATABASE_URL is wrong.\n\n' +
      '  Copy the string straight from the dashboard instead:\n' +
      `    https://supabase.com/dashboard/project/${ref}/settings/database\n` +
      '    → Connection string → Transaction pooler\n',
  )
  process.exit(1)
}

/** `aws-0-ap-northeast-1.pooler.supabase.com` -> `ap-northeast-1`. */
function regionOf(host: string): string {
  return /^aws-\d+-(.+?)\.pooler/.exec(host)?.[1] ?? host
}

console.log(
  '\n[kie-studio] Found it. Change these two fields in .env:\n\n' +
    `  username:  postgres  ->  postgres.${ref}\n` +
    `  host:port: ${parsed.hostname}:${parsed.port || '5432'}  ->  ${found}:6543\n\n` +
    '  So DATABASE_URL becomes:\n\n' +
    `    postgresql://postgres.${ref}:<YOUR-PASSWORD>@${found}:6543/postgres\n\n` +
    '  Keep the password exactly as it is now. Then: npm run db:migrate\n',
)
