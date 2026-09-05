import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull } from '../db';
import type { Instrument, JumpTestWithReps, MetricPr } from '../types';
import {
  createJumpTest,
  deleteJumpTest,
  getCurrentBest,
  listJumpTests,
  listPrs,
  type CreateJumpTestInput,
} from '../store/jumpTests';
import { SINGLE_LEG_MODE } from '../store/readiness';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

/** One instrument stream. Streams never share a trend line, a PR, or an axis. */
export function useTests(
  instrument: Instrument,
  mode = 'cmj',
  canonicalOnly = true,
): UseQueryResult<JumpTestWithReps[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.tests(instrument, mode), canonicalOnly],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listJumpTests(db, { instrument, mode, canonicalOnly })),
  });
}

export function usePrs(instrument: Instrument, mode = 'cmj'): UseQueryResult<MetricPr[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.tests(instrument, mode), 'prs'],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listPrs(db, instrument, mode)),
  });
}

export function useCurrentBest(instrument: Instrument, mode = 'cmj'): UseQueryResult<number | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.tests(instrument, mode), 'best'],
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getCurrentBest(db, instrument, mode)),
  });
}

export function useLogJumpTest(): ReturnType<
  typeof useMutation<JumpTestWithReps, Error, CreateJumpTestInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<JumpTestWithReps, Error, CreateJumpTestInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      const saved = await createJumpTest(db, input);
      // A single-leg pair is its own kind on the wire, because it is its own
      // mode here: it never joins a stream, a trend, or a PR
      // (`house.sc.asymmetry_tracking`).
      const kind = saved.mode === SINGLE_LEG_MODE ? 'jumpTest.single_leg' : 'jumpTest.create';
      await enqueue(db, { kind, entityId: saved.id, payload: input });
      return saved;
    },
    onSuccess: (saved) => {
      // A new test recomputes the stream's PRs, so every test key is stale.
      void client.invalidateQueries({ queryKey: queryKeys.testsAll() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
      if (saved.mode === SINGLE_LEG_MODE) {
        void client.invalidateQueries({ queryKey: queryKeys.readiness() });
      }
    },
  });
}

/** Deleting a test recomputes the stream, so a removed PR does not linger. */
export function useDeleteJumpTest(): ReturnType<typeof useMutation<void, Error, string>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (testId) => {
      if (db === null) throw new Error('The database is not open yet.');
      await deleteJumpTest(db, testId);
      await enqueue(db, { kind: 'jumpTest.delete', entityId: testId, payload: {} });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.testsAll() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

/**
 * Every test on every stream, oldest first, canonical or not.
 *
 * The ledger and the stream-break marks need the whole history: a Vertec test
 * before the device arrived and a non-canonical warm-up test both belong in
 * the ledger, and neither may reach the trend. Callers filter by stream.
 */
export function useAllTests(): UseQueryResult<JumpTestWithReps[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.testsAll(), 'all'],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listJumpTests(db, {})),
  });
}
