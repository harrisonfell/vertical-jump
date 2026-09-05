# Vert

A solo athlete's jump-training instrument: Expo universal app (iOS via TestFlight, web via Vercel).
`apps/mobile` is the app, `packages/engine` is `@vert/engine`, the pure TypeScript training logic, and `apps/server` is the Next.js review server for Vercel (pairing, web login, Whoop OAuth and webhooks, sync, export; see its README for env vars).

- `npm install` at the root installs every workspace.
- `npm run web` starts the web dev server; it also writes typed-route types into `apps/mobile/.expo/types`.
- `npm run export:web` builds the static web bundle into `apps/mobile/dist`.
- `npm run typecheck` type-checks the engine, the app, and the server; `npm test` runs vitest across all three.
- `EXPO_PUBLIC_FIXTURE=1 npm run web` seeds an owner-like week 7 for review; `EXPO_PUBLIC_FIXTURE=empty` starts at first run. Dev galleries: `/dev/kit`, `/dev/charts`.
- `npm run tokens` regenerates `apps/mobile/src/ui/tokens.generated.ts` and asserts contrast.
