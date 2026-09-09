import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getEnv } from '../env.ts'

/**
 * The Supabase client, holding the SERVICE ROLE key.
 *
 * That key bypasses Row Level Security entirely, which is why it lives here and
 * only here, behind `server-only`. Every ownership check in this app is made in
 * application code against `workspace_id` (lib/auth/workspace.ts) — the database
 * will not make one for us. A route that forgets to scope its query is a data
 * leak, not a permission error, so the scoping helpers exist to make forgetting
 * hard.
 *
 * There is deliberately no anon-key client and no browser client. The bucket is
 * private, and the browser reaches objects only through short-lived signed URLs
 * this server mints.
 */

const CLIENT_KEY: unique symbol = Symbol.for('kie-studio.supabase') as never
type SupabaseGlobal = typeof globalThis & { [CLIENT_KEY]?: SupabaseClient }

export function getSupabase(): SupabaseClient {
  const scope = globalThis as SupabaseGlobal
  if (scope[CLIENT_KEY]) return scope[CLIENT_KEY]

  const env = getEnv()
  scope[CLIENT_KEY] = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      // No user sessions exist here, and a serverless process persisting or
      // refreshing one would be writing to a filesystem that vanishes.
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return scope[CLIENT_KEY]
}

/** The bucket every object in this app lives in. */
export function bucket() {
  return getSupabase().storage.from(getEnv().storageBucket)
}
