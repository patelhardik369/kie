/**
 * Wiring for the tests that need a real database.
 *
 * The integration tests used to open a throwaway SQLite file in `os.tmpdir()`,
 * which meant `npm test` needed nothing but Node. Postgres cannot be conjured
 * that way, so those tests now need somewhere to point.
 *
 * The rule this module encodes: **a missing test database SKIPS, it does not
 * fail.** A suite that goes red on a laptop with no Postgres teaches people to
 * ignore red, which costs far more than the coverage is worth. A skip with a
 * reason attached is honest and still runs everywhere it can.
 *
 * To run them:
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kie_test npm test
 *
 * Point it at a scratch database — a Supabase branch, a local container,
 * anything. **Never at a database with real generations in it:** these tests
 * truncate every table between cases.
 */

/** The scratch database, or undefined when the suite should skip. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || undefined

export const SKIP_REASON =
  'TEST_DATABASE_URL is not set — see lib/db/test-support.ts for how to run these.'

/**
 * Fills in the environment these tests need, so a suite only has to supply the
 * database URL.
 *
 * The values are deliberately fake apart from the connection string: nothing
 * here reaches Kie or Supabase Storage, and a test that silently started doing
 * so would fail loudly on these rather than quietly spending someone's credits.
 */
export function configureTestEnv(): boolean {
  if (!TEST_DATABASE_URL) return false

  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
  process.env.SUPABASE_URL ??= 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
  process.env.SUPABASE_STORAGE_BUCKET ??= 'kie-test'
  process.env.CRON_SECRET ??= 'test-cron-secret'
  process.env.KIE_API_KEY ??= 'test-key-not-a-real-one'
  delete process.env.KIE_PUBLIC_URL
  delete process.env.KIE_WEBHOOK_HMAC_KEY

  return true
}

/** Every table these tests write to, in an order that respects the foreign key. */
export const TEST_TABLES = [
  'assets',
  'generations',
  'input_assets',
  'presets',
  'prompts',
  'favorite_models',
  'credit_log',
  'workspaces',
] as const
