import { useEffect } from 'react';
import {
  focusManager,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { serverConfigured } from '@/app/syncLineText';
import { runSync, type SyncRunResult } from '../sync/pushPull';
import { useDbOrNull, useToday } from '../db';
import { addDays } from '../../lib/localDay';
import type {
  AutoregulationStatus,
  LocalDate,
  WhoopConnection,
  WhoopRecovery,
  WhoopWorkout,
} from '../types';
import {
  getAutoregulationStatus,
  setAutoregulationStatus,
  type AutoregulationPatch,
} from '../store/autoregulation';
import {
  getRecoveryForDay,
  getSessionLink,
  getWhoopConnection,
  getWorkout,
  linkWorkout,
  listRecovery,
  listWorkoutsBetween,
  setWhoopConnection,
  unlinkWorkout,
  type SessionWorkoutLink,
  type WhoopConnectionPatch,
} from '../store/whoop';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

export function useWhoopConnection(): UseQueryResult<WhoopConnection | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.whoopConnection(),
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getWhoopConnection(db)),
  });
}

/** Recovery over a date range. Missing days come back missing, never as zeros. */
export function useWhoopRecovery(from: LocalDate, to: LocalDate): UseQueryResult<WhoopRecovery[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.whoopRecovery(from, to),
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listRecovery(db, from, to)),
  });
}

export function useWhoopRecoveryDays(days: number): UseQueryResult<WhoopRecovery[]> {
  const today = useToday();
  return useWhoopRecovery(addDays(today, -(days - 1)), today);
}

export function useTodayRecovery(): UseQueryResult<WhoopRecovery | null> {
  const db = useDbOrNull();
  const today = useToday();
  return useQuery({
    queryKey: [...queryKeys.whoopRecovery(today, today), 'day'],
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getRecoveryForDay(db, today)),
  });
}

export function useSetWhoopConnection(): ReturnType<
  typeof useMutation<WhoopConnection, Error, WhoopConnectionPatch>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<WhoopConnection, Error, WhoopConnectionPatch>({
    mutationFn: async (patch) => {
      if (db === null) throw new Error('The database is not open yet.');
      return setWhoopConnection(db, patch);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['whoop'] });
    },
  });
}

export interface LinkWorkoutInput {
  readonly sessionId: string;
  readonly whoopWorkoutId: string;
  readonly matchSource: 'auto' | 'manual';
  readonly overlapS: number;
}

export function useLinkWorkout(): ReturnType<typeof useMutation<void, Error, LinkWorkoutInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, LinkWorkoutInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      await linkWorkout(db, input.sessionId, input.whoopWorkoutId, input.matchSource, input.overlapS);
      await enqueue(db, { kind: 'whoop.link', entityId: input.sessionId, payload: input });
    },
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: queryKeys.session(input.sessionId) });
      void client.invalidateQueries({ queryKey: ['whoop'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useUnlinkWorkout(): ReturnType<typeof useMutation<void, Error, string>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (sessionId) => {
      if (db === null) throw new Error('The database is not open yet.');
      await unlinkWorkout(db, sessionId);
      await enqueue(db, { kind: 'whoop.unlink', entityId: sessionId, payload: {} });
    },
    onSuccess: (_result, sessionId) => {
      void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      void client.invalidateQueries({ queryKey: ['whoop'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useAutoregulationStatus(): UseQueryResult<AutoregulationStatus | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.autoregulation(),
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getAutoregulationStatus(db)),
  });
}

export function useSetAutoregulation(): ReturnType<
  typeof useMutation<AutoregulationStatus, Error, AutoregulationPatch>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<AutoregulationStatus, Error, AutoregulationPatch>({
    mutationFn: async (patch) => {
      if (db === null) throw new Error('The database is not open yet.');
      return setAutoregulationStatus(db, patch);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.autoregulation() });
    },
  });
}

/** One night's sleep performance, as the recovery panel's alternate measure. */
export interface WhoopSleepDay {
  readonly localDate: LocalDate;
  readonly scoreState: string;
  /** Whole percent, or null when the night is unscored or still pending. */
  readonly sleepPerformancePercentage: number | null;
}

interface SleepRow {
  readonly local_date: string;
  readonly score_state: string;
  readonly sleep_performance_percentage: number | null;
  readonly nap: number;
}

/**
 * Sleep performance over a date range, naps excluded.
 *
 * The panel's third measure needs one number a night and nothing else, so this
 * reads the two columns it draws rather than mirroring the whole sleep record.
 */
export function useWhoopSleep(from: LocalDate, to: LocalDate): UseQueryResult<WhoopSleepDay[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: ['whoop', 'sleep', `${from}..${to}`],
    enabled: db !== null,
    queryFn: async (): Promise<WhoopSleepDay[]> => {
      if (db === null) return [];
      const rows = await db.getAllAsync<SleepRow>(
        `SELECT local_date, score_state, sleep_performance_percentage, nap
           FROM whoop_sleep
          WHERE local_date >= ? AND local_date <= ? AND nap = 0
          ORDER BY local_date`,
        [from, to],
      );
      return rows.map((row) => ({
        localDate: row.local_date,
        scoreState: row.score_state,
        sleepPerformancePercentage: row.sleep_performance_percentage,
      }));
    },
  });
}

/** One matched workout, for the session detail's evidence line. */
export function useWhoopWorkout(workoutId: string | null | undefined): UseQueryResult<WhoopWorkout | null> {
  const db = useDbOrNull();
  const enabled = db !== null && workoutId !== null && workoutId !== undefined;
  return useQuery({
    queryKey: ['whoop', 'workout', workoutId ?? 'none'],
    enabled,
    queryFn: async () => (enabled ? getWorkout(db, workoutId) : null),
  });
}

/**
 * Candidate workouts inside a window, for "Change match". Whoop records a
 * workout on its own clock, so the window is instants, not local days.
 */
export function useWhoopWorkoutsBetween(
  fromIso: string | undefined,
  toIso: string | undefined,
): UseQueryResult<WhoopWorkout[]> {
  const db = useDbOrNull();
  const enabled = db !== null && fromIso !== undefined && toIso !== undefined;
  return useQuery({
    queryKey: ['whoop', 'workouts', fromIso ?? '', toIso ?? ''],
    enabled,
    queryFn: async () => (enabled ? listWorkoutsBetween(db, fromIso, toIso) : []),
  });
}

/** How a session got its workout: an automatic overlap, or the athlete's pick. */
export function useSessionWorkoutLink(
  sessionId: string | undefined,
): UseQueryResult<SessionWorkoutLink | null> {
  const db = useDbOrNull();
  const enabled = db !== null && sessionId !== undefined;
  return useQuery({
    queryKey: ['whoop', 'link', sessionId ?? 'none'],
    enabled,
    queryFn: async () => (enabled ? getSessionLink(db, sessionId) : null),
  });
}

/* -------------------------------------------------------- server sync */

/**
 * The push and pull loop, mounted once in the app chrome.
 *
 * It runs on app open, whenever the app comes back to the foreground (react
 * query's focus manager already listens to AppState on native and to the
 * document's visibility on web), and a moment after any local write, which is
 * every mutation this app makes. The delay coalesces a burst of set taps into
 * one push instead of one request a tap.
 *
 * With no server configured, `runSync` returns "no_server" without touching
 * the network, so this hook costs one function call a mutation in v1.
 */
export function useServerSync(): void {
  const db = useDbOrNull();
  const client = useQueryClient();

  useEffect(() => {
    if (db === null) return;
    if (!serverConfigured()) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = (): void => {
      void runSync(db).then((result) => {
        if (disposed) return;
        if (!result.ok) return;
        if (result.accepted > 0 || result.rejected > 0) {
          void client.invalidateQueries({ queryKey: queryKeys.sync() });
        }
        if (result.applied > 0) void client.invalidateQueries({ queryKey: ['whoop'] });
        if (result.lastSyncedAt !== null) {
          void client.invalidateQueries({ queryKey: queryKeys.sync() });
        }
      });
    };

    const schedule = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, SYNC_DEBOUNCE_MS);
    };

    run();

    const unfocus = focusManager.subscribe((focused) => {
      if (focused) schedule();
    });
    const unmutate = client.getMutationCache().subscribe((event) => {
      if (event.mutation?.state.status === 'success') schedule();
    });

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unfocus();
      unmutate();
    };
  }, [db, client]);
}

/** Long enough to swallow a burst of set taps, short enough to feel immediate. */
export const SYNC_DEBOUNCE_MS = 1_500;

/**
 * A Sync now tap: the athlete is asking, so it ignores the backoff and reports
 * what happened rather than swallowing it.
 */
export function useSyncNow(): ReturnType<typeof useMutation<SyncRunResult, Error, void>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<SyncRunResult, Error, void>({
    mutationFn: async () => {
      if (db === null) throw new Error('The database is not open yet.');
      return runSync(db, { force: true });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
      void client.invalidateQueries({ queryKey: ['whoop'] });
    },
  });
}
