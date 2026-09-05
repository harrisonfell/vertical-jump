import { defineConfig } from 'drizzle-kit';

/**
 * `npm run db:generate -w @vert/server` writes SQL into drizzle/ from
 * src/db/schema.ts. Generating needs no database; pushing needs DATABASE_URL.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/vert' },
});
