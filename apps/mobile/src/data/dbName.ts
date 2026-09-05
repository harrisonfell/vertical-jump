/**
 * The database's name, in a module with no platform twin.
 *
 * `executor.ts` is shadowed by executor.native.ts and executor.web.ts at bundle
 * time, so any value that lives only in executor.ts would be undefined on a
 * device. Constants both sides share belong here.
 */
export const DEFAULT_DATABASE_NAME = 'vert.db';
