# @vert/server

One Vercel project, one domain, both halves of Vert. `/api/*` is the route handlers: Whoop OAuth, webhooks, sync, and the pull and push feed, over Neon Postgres through Drizzle. Every other path is the Expo web app, exported into `public/app` at build time and served by the rewrites in `next.config.mjs`. That is not tidiness: the owner's session cookie is set on this origin and only comes back to this origin, and the paired phone's Bearer goes to the host it paired against, so a second domain would mean a third-party cookie and a second CORS surface for nothing.

The phone never holds a Whoop token; it opens `/api/whoop/start` in a system auth session and the server keeps the pair, encrypted with AES-256-GCM.

## Run and build

`npm install` at the repo root, then `npm run dev -w @vert/server` (health at `/api/health`). `next dev` serves the API only, so run the app with `npm run web` at the root while developing screens.

`npm run build -w @vert/server` does the deploy build in order: `scripts/build-web.mjs` exports the Expo web bundle into `public/app` with `EXPO_PUBLIC_SERVER_URL=/`, which the app's transport reads as this origin so every request goes out as a relative path, then `next build` runs and copies `public/` into the output. The export step fails loudly if any route the rewrites name is missing. `build:web` and `build:next` run the halves on their own.

`public/app` is generated and git-ignored. The phone's EAS build sets `EXPO_PUBLIC_SERVER_URL` to the absolute domain instead; unset, as in `npm run web`, still means no server at all.

Migrations: `npm run db:generate -w @vert/server` writes SQL into `drizzle/`; apply it with `npm run db:migrate -w @vert/server`, which runs drizzle's migrator against `DATABASE_URL` and records what it ran, so a second deploy is a no-op. `db:push` is for a scratch database only. The deploy build (`scripts/build.mjs`) runs the migrator itself whenever `DATABASE_URL` is set, so a push to `main` ships the schema with the code.

## The database snapshot

Every device keeps its own SQLite file, and the op feed only carries patches, so the file itself is what keeps the phone and the web on the same data. `PUT /api/snapshot` saves a device's whole database (raw bytes, facts in `x-snapshot-*` headers); `GET /api/snapshot` hands the newest back, `?version=` a specific one, `?meta=1` only the facts. A save names the version the device adopted last in `x-snapshot-base`; when a newer copy landed since, the answer is 409 with that copy, and the app decides (its own copy stands and the passed one stays restorable). The last 20 copies are kept; `GET /api/snapshot/versions` lists them. Either credential works: the signed-in web, or a paired phone.

Tests: `npm test` at the repo root applies `drizzle/*.sql` to pglite in process, so the suite needs no database.

Fixtures: `WHOOP_FIXTURE=1` replays `fixtures/whoop/*.json` through the same fetch wrapper, which is how every Whoop path is developed, because Whoop has no sandbox.

## Vercel project settings

- **Root Directory**: `apps/server`. Leave "Include source files outside of the Root Directory" on, because the build reads `apps/mobile` and `packages/engine`.
- **Framework Preset**: Next.js.
- **Node.js Version**: 22.x. `engines.node` in `package.json` pins it too.
- **Install and Build Commands**: come from `vercel.json`. Install runs `npm install` at the repo root so the workspaces link; build runs `node scripts/build.mjs` in `apps/server`.
- **Storage**: add the Neon integration from the project's Storage tab and attach the database. It sets `DATABASE_URL` for Production, Preview, and Development, so do not also set it by hand.
- **Cron Jobs**: `vercel.json` declares `GET /api/whoop/sync` daily at 09:00 UTC. Hobby allows one run a day; the sync is chunked and resumable, so a cold backfill finishes over a few days unless the app opens sooner.

### Environment variables

Set each one for Production and Preview. Secret means it is a credential: never in `EXPO_PUBLIC_*`, never in a client bundle, never in git.

| Variable | Secret | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string. Set by the Neon integration. |
| `WHOOP_CLIENT_ID` | no | From the Whoop developer dashboard. Optional: without the three Whoop values the Whoop paths answer 503 and everything else runs. |
| `WHOOP_CLIENT_SECRET` | yes | From the same app. Optional, as above. |
| `WHOOP_REDIRECT_URI` | no | `https://<domain>/api/whoop/callback`, character for character the same as the one registered with Whoop. Optional, as above. |
| `PUBLIC_BASE_URL` | no | `https://<domain>`. Builds the redirect and the bounce back to `/settings/whoop`. |
| `APP_PASSPHRASE_HASH` | yes | scrypt hash of the owner's passphrase. |
| `SESSION_SECRET` | yes | At least 32 bytes of entropy. Signs the session cookie and the OAuth state. |
| `TOKEN_ENCRYPTION_KEY` | yes | Exactly 32 bytes, base64. AES-256-GCM for the stored Whoop tokens. |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | yes | Optional, decrypt only, while rotating the key above. |
| `CRON_SECRET` | yes | Vercel sends it as `Authorization: Bearer` on the cron call. Without it `GET /api/whoop/sync` answers 503 rather than running open. |
| `WHOOP_FIXTURE` | no | `1` replays `fixtures/whoop/*.json` instead of calling Whoop. `0` in production. |

Shapes and generator snippets for each are in `.env.example`.

### Whoop app registration

Redirect URI: `https://<domain>/api/whoop/callback`. Scopes: `read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement offline`. A preview deployment has its own hostname, so either register the preview URI too or connect Whoop from production only.

Hobby limits shape the rest of the design: 300 s functions and one cron a day, so token refresh is lazy inside a row lock and sync is driven by webhooks and app opens.
