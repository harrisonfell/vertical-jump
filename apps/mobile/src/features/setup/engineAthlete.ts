/**
 * Moved to `src/lib/engineAthlete.ts`.
 *
 * The store-row to engine bridge is not setup's property: settings rebuilds a
 * program with it and the fixture path reads the same narrowing. Leaving it
 * under a feature made every other feature import that feature to reach it.
 * This file stays as the compatibility path for setup's own modules.
 */
export * from '@/lib/engineAthlete';
