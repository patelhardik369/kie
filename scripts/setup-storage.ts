/**
 * Creates the storage bucket, once, with the right settings.
 *
 *   npm run storage:setup
 *
 * The bucket could be made by hand in the Supabase dashboard, and the two
 * settings that matter are easy to get wrong there:
 *
 *   - **private, not public.** A public bucket serves every object to anyone who
 *     can guess a key, which would make the capability tokens in
 *     lib/gallery/asset-token.ts decorative.
 *   - **a per-file limit.** Supabase Free enforces 50 MB globally anyway, but
 *     setting it on the bucket means an oversized upload is refused immediately
 *     rather than after the whole transfer.
 *
 * Idempotent: running it against an existing bucket reports what it found and
 * changes nothing.
 */

import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'kie-outputs'
const maxBytes = Number(process.env.MAX_STORAGE_FILE_BYTES) || 50 * 1024 * 1024

if (!url || !key) {
  console.error(
    '\n[kie-studio] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n\n' +
      '  Supabase → Project Settings → Data API (URL) and API keys (service_role).\n',
  )
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: existing } = await supabase.storage.getBucket(bucket)

if (existing) {
  console.log(`[kie-studio] bucket "${bucket}" already exists.`)
  console.log(`  public: ${existing.public}`)
  console.log(`  file size limit: ${existing.file_size_limit ?? 'project default'}`)

  if (existing.public) {
    console.error(
      '\n  WARNING: this bucket is PUBLIC. Every object in it is readable by anyone\n' +
        '  who can guess its key, which defeats the capability tokens the app mints.\n' +
        '  Make it private in the dashboard: Storage → Buckets → ⋯ → Make private.\n',
    )
    process.exitCode = 1
  }
} else {
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: maxBytes,
  })

  if (error) {
    console.error(`\n[kie-studio] could not create bucket "${bucket}": ${error.message}\n`)
    process.exit(1)
  }
  console.log(
    `[kie-studio] created private bucket "${bucket}" ` +
      `with a ${Math.round(maxBytes / (1024 * 1024))} MB per-file limit.`,
  )
}

// A round trip proves the credentials work for the operations the app actually
// performs, which is worth more than a bucket that merely exists.
const probeKey = '_setup/probe.txt'
const body = new TextEncoder().encode('kie-studio setup probe')

const { error: writeError } = await supabase.storage
  .from(bucket)
  .upload(probeKey, body, { contentType: 'text/plain', upsert: true })

if (writeError) {
  console.error(`\n[kie-studio] the bucket exists but is not writable: ${writeError.message}\n`)
  process.exit(1)
}

const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(probeKey, 60)
await supabase.storage.from(bucket).remove([probeKey])

console.log(
  signed?.signedUrl
    ? '[kie-studio] write, sign and delete all work. Storage is ready.'
    : '[kie-studio] wrote and deleted, but could not sign a URL — check the service_role key.',
)
