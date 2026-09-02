import type { Config } from 'drizzle-kit'

/**
 * Used for `npm run db:generate` only — generating SQL from lib/db/schema.ts.
 * Migrations are APPLIED at runtime by lib/db/index.ts via the libsql migrator
 * (see instrumentation.ts), so drizzle-kit never needs to open the database.
 */
export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/kie.db',
  },
} satisfies Config
