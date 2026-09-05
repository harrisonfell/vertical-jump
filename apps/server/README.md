# @vert/server

Whoop and sync for Vert: Next.js 15 route handlers on Vercel, Neon Postgres through Drizzle. The phone never holds a Whoop token; it opens `/api/whoop/start` in a system auth session and the server keeps the pair, encrypted with AES-256-GCM.

Env, all in `.env.example`: `DATABASE_URL`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `APP_PASSPHRASE_HASH`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `WHOOP_FIXTURE`, `TOKEN_ENCRYPTION_KEY`. Nothing is committed with a real value.

Run: `npm install` at the repo root, then `npm run dev -w @vert/server` (health at `/api/health`).
Migrations: `npm run db:generate -w @vert/server` writes SQL into `drizzle/`; apply it with `npm run db:migrate -w @vert/server`, which runs drizzle's migrator against `DATABASE_URL` and records what it ran, so a second deploy is a no-op. `db:push` is for a scratch database only.
Tests: `npm test` at the repo root applies `drizzle/*.sql` to pglite in process, so the suite needs no database.
Fixtures: `WHOOP_FIXTURE=1` replays `fixtures/whoop/*.json` through the same fetch wrapper, which is how every Whoop path is developed, because Whoop has no sandbox.

Deploy: a Vercel project rooted at `apps/server`, framework Next.js, every env var set for Production and Preview. Hobby limits shape the design: 300 s functions and cron once a day, so token refresh is lazy inside a row lock and sync is driven by webhooks and app opens.
