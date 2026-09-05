/** The data layer's public surface. Screens import from here, never from sql/. */
export {
  DbProvider,
  useDb,
  useDbOrNull,
  useDbReady,
  useDbState,
  useTimezone,
  useToday,
  type DbProviderProps,
  type DbState,
} from './db';
export { DEFAULT_DATABASE_NAME } from './dbName';
export {
  openExecutor,
  type OpenExecutorOptions,
  type SqlExecutor,
  type SqlParam,
  type SqlParams,
  type SqlRunResult,
} from './executor';
export { MIGRATIONS, SCHEMA_VERSION, currentSchemaVersion, migrate } from './migrate';
export * from './hooks';
export * from './store';
export * from './types';
export {
  applyFixture,
  buildPlaceholderFixture,
  fixtureMode,
  isFixtureData,
  seedIfEmpty,
  type FixtureData,
  type FixtureMode,
} from './fixtures';
