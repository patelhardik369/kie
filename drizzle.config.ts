import type { Config } from 'drizzle-kit'

/**
 * Used for `npm run db:generate` — turning lib/db/schema.ts into SQL.
 *
 * Migrations are APPLIED by `npm run db:migrate`, once, at deploy time. They are
 * deliberately NOT applied at runtime any more: on a serverless host there is no
 * single "server start", and many cold starts racing to apply the same migration
 * is a good way to corrupt a schema.
 */
export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config
