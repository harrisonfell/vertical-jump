/**
 * The wire contract between the Vert app and the Vert server.
 *
 * One import, no dependency beyond zod, so the app can copy it verbatim into
 * apps/mobile/src/features/whoop/ and share the types without a package. The
 * app's defensive readers stay, because the server is a separate deploy and
 * can be older. Shapes follow the phone first: `WhoopStatusResponse` is the
 * app client's own interface and the mirror rows are the phone's upsert
 * inputs, so a pulled row goes straight into upsertWhoopRecovery.
 *
 * The parts live in `contract/` so no file passes its reading length. This
 * barrel is the name everything imports; nothing imports a part directly.
 */

export * from './contract/primitives';
export * from './contract/access';
export * from './contract/whoop';
export * from './contract/sync';
export * from './contract/endpoints';
