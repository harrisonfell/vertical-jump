import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull, useToday } from '../db';
import type {
  ReadinessOutcome,
  ReadinessTestKind,
  ReadinessTestSession,
  SessionAnswer,
  SingleLegTest,
} from '../types';
import {
  DEFAULT_ASYMMETRY_BAND_PCT,
  createReadinessTest,
  deleteReadinessTest,
  getReadinessOutcome,
  getSessionAnswer,
  listReadinessTests,
  listSingleLegTests,
  setReadinessOutcome,
  setSessionAnswer,
  type CreateReadinessTestInput,
  type SetReadinessOutcomeInput,
  type SetSessionAnswerInput,
} from '../store/readiness';
import { getRecoveryForDay } from '../store/whoop';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

/**
 * The readiness gate, the asymmetry stream, and the finger question.
 *
 * `useReadinessToday` hands a screen both channels and nothing else: the day's
 * recovery as the strap reported it, the day's output test, and the tests
 * before it. It never scores them. Scoring is the engine's `scoreReadiness`,
 * so the two channels are read in one place and averaged in none
 * (`house.sc.readiness_gate`).
 */

export function useReadinessTests(
  kind: ReadinessTestKind = 'seated_mb_throw',
): UseQueryResult<ReadinessTestSession[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.readinessTests(kind),
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listReadinessTests(db, { kind })),
  });
}

/** What the gate needs for one day. Whoop's score is null on an unscored day. */
export interface ReadinessTodayData {
  readonly date: string;
  readonly kind: ReadinessTestKind;
  /** Channel A, as the strap reported it that morning, or null. */
  readonly whoop: { readonly date: string; readonly score: number | null } | null;
  /** Channel B, logged today, or null when the athlete has not tested. */
  readonly test: ReadinessTestSession | null;
  /** Every earlier session of the same kind, oldest first. */
  readonly history: readonly ReadinessTestSession[];
}

export function useReadinessToday(
  kind: ReadinessTestKind = 'seated_mb_throw',
): UseQueryResult<ReadinessTodayData | null> {
  const db = useDbOrNull();
  const today = useToday();
  return useQuery({
    queryKey: [...queryKeys.readinessToday(today), kind],
    enabled: db !== null,
    queryFn: async (): Promise<ReadinessTodayData | null> => {
      if (db === null) return null;
      const tests = await listReadinessTests(db, { kind, onOrBefore: today });
      const test = tests.find((row) => row.localDate === today) ?? null;
      const history = tests.filter((row) => row.localDate < today);
      const recovery = await getRecoveryForDay(db, today);
      return {
        date: today,
        kind,
        whoop: recovery === null ? null : { date: recovery.localDate, score: recovery.recoveryScore },
        test,
        history,
      };
    },
  });
}

export function useReadinessOutcome(sessionId: string): UseQueryResult<ReadinessOutcome | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.readinessOutcome(sessionId),
    enabled: db !== null && sessionId !== '',
    queryFn: async () => (db === null ? null : getReadinessOutcome(db, sessionId)),
  });
}

/** Single-leg tests, oldest first. Never canonical, never a PR. */
export function useSingleLegTests(
  bandPct: number = DEFAULT_ASYMMETRY_BAND_PCT,
): UseQueryResult<SingleLegTest[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.singleLegTests(), bandPct],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listSingleLegTests(db, bandPct)),
  });
}

/** Today's 0 to 10 finger answer, and the way to change it. */
export function useFingerPain(): UseQueryResult<SessionAnswer | null> {
  const db = useDbOrNull();
  const today = useToday();
  return useQuery({
    queryKey: queryKeys.sessionAnswer('finger_pain', today),
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getSessionAnswer(db, today, 'finger_pain')),
  });
}

export function useLogReadinessTest(): ReturnType<
  typeof useMutation<ReadinessTestSession, Error, CreateReadinessTestInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<ReadinessTestSession, Error, CreateReadinessTestInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      const saved = await createReadinessTest(db, input);
      await enqueue(db, { kind: 'readiness_test.create', entityId: saved.id, payload: saved });
      return saved;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.readiness() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useDeleteReadinessTest(): ReturnType<typeof useMutation<void, Error, string>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (testId) => {
      if (db === null) throw new Error('The database is not open yet.');
      await deleteReadinessTest(db, testId);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.readiness() });
    },
  });
}

export function useSetReadinessOutcome(): ReturnType<
  typeof useMutation<ReadinessOutcome, Error, SetReadinessOutcomeInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<ReadinessOutcome, Error, SetReadinessOutcomeInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      const saved = await setReadinessOutcome(db, input);
      await enqueue(db, {
        kind: 'readiness_outcome.set',
        entityId: saved.sessionId,
        payload: saved,
      });
      return saved;
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: queryKeys.readiness() });
      void client.invalidateQueries({ queryKey: queryKeys.session(saved.sessionId) });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

/**
 * The finger answer. It changes what the day may carry, so the session views
 * go stale with it (`house.sc.finger_pain_ceiling`).
 */
export function useSetFingerPain(): ReturnType<
  typeof useMutation<SessionAnswer, Error, SetSessionAnswerInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<SessionAnswer, Error, SetSessionAnswerInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      return setSessionAnswer(db, input);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.readiness() });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
