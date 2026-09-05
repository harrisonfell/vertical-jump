import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { jumpTestStore, useDbOrNull } from '@/data';
import type { JumpTestWithReps } from '@/data';
import type { BaselineReading } from './engineAthlete';

/**
 * Jump test number one, whichever stream it is on.
 *
 * The store has no baseline column: the baseline is the row setup wrote, so
 * reading it back is how the program learns its primary instrument and the
 * height every later test is measured against.
 */
export function useBaselineTest(): UseQueryResult<JumpTestWithReps | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: ['tests', 'baseline'],
    enabled: db !== null,
    queryFn: async () => {
      if (db === null) return null;
      const tests = await jumpTestStore.listJumpTests(db, {});
      return tests.find((test) => test.isBaseline) ?? null;
    },
  });
}

/** The baseline as the engine reads it, or null when setup has not run. */
export function baselineReading(test: JumpTestWithReps | null | undefined): BaselineReading | null {
  if (test == null || test.bestHeightMm === null) return null;
  return { heightMm: test.bestHeightMm, instrument: test.instrument };
}
