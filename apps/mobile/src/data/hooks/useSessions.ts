import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull, useToday } from '../db';
import type { LocalDate, SessionExercise, SessionWithStatus } from '../types';
import {
  getSession,
  listSessionExercises,
  listSessionsByDate,
  listSessionsBetween,
  listSessionsByWeek,
  markSessionComplete,
  patchSession,
  undoSessionComplete,
  type SessionPatch,
} from '../store/sessions';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

export function useSession(sessionId: string | undefined): UseQueryResult<SessionWithStatus | null> {
  const db = useDbOrNull();
  const today = useToday();
  const enabled = db !== null && sessionId !== undefined;
  return useQuery({
    queryKey: [...queryKeys.session(sessionId ?? 'none'), today],
    enabled,
    queryFn: async () => (enabled ? getSession(db, sessionId, today) : null),
  });
}

export function useSessionExercises(sessionId: string | undefined): UseQueryResult<SessionExercise[]> {
  const db = useDbOrNull();
  const enabled = db !== null && sessionId !== undefined;
  return useQuery({
    queryKey: [...queryKeys.session(sessionId ?? 'none'), 'exercises'],
    enabled,
    queryFn: async () => (enabled ? listSessionExercises(db, sessionId) : []),
  });
}

export function useSessionsByWeek(weekId: string | undefined): UseQueryResult<SessionWithStatus[]> {
  const db = useDbOrNull();
  const today = useToday();
  const enabled = db !== null && weekId !== undefined;
  return useQuery({
    queryKey: [...queryKeys.sessionsByWeek(weekId ?? 'none'), today],
    enabled,
    queryFn: async () => (enabled ? listSessionsByWeek(db, weekId, today) : []),
  });
}

/** Today's sessions. The date defaults to the athlete's own local day. */
export function useSessionsForDay(date?: LocalDate): UseQueryResult<SessionWithStatus[]> {
  const db = useDbOrNull();
  const today = useToday();
  const day = date ?? today;
  return useQuery({
    queryKey: [...queryKeys.sessionsByDate(day), today],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listSessionsByDate(db, day, today)),
  });
}

export function useSessionsBetween(
  from: LocalDate | undefined,
  to: LocalDate | undefined,
): UseQueryResult<SessionWithStatus[]> {
  const db = useDbOrNull();
  const today = useToday();
  const enabled = db !== null && from !== undefined && to !== undefined;
  return useQuery({
    queryKey: ['session', 'range', from ?? '', to ?? '', today],
    enabled,
    queryFn: async () => (enabled ? listSessionsBetween(db, from, to, today) : []),
  });
}

export interface PatchSessionInput {
  readonly sessionId: string;
  readonly patch: SessionPatch;
}

export function usePatchSession(): ReturnType<typeof useMutation<void, Error, PatchSessionInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, PatchSessionInput>({
    mutationFn: async ({ sessionId, patch }) => {
      if (db === null) throw new Error('The database is not open yet.');
      await patchSession(db, sessionId, patch);
      await enqueue(db, { kind: 'session.patch', entityId: sessionId, payload: patch });
    },
    onSuccess: (_result, { sessionId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

/** Finish is a log event, never a stamp, so it can be undone without a rewrite. */
export function useFinishSession(): ReturnType<typeof useMutation<void, Error, string>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (sessionId) => {
      if (db === null) throw new Error('The database is not open yet.');
      await markSessionComplete(db, sessionId);
      await enqueue(db, { kind: 'session.finish', entityId: sessionId, payload: {} });
    },
    onSuccess: (_result, sessionId) => {
      void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useUnfinishSession(): ReturnType<typeof useMutation<void, Error, string>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (sessionId) => {
      if (db === null) throw new Error('The database is not open yet.');
      await undoSessionComplete(db, sessionId);
      await enqueue(db, { kind: 'session.unfinish', entityId: sessionId, payload: {} });
    },
    onSuccess: (_result, sessionId) => {
      void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export interface MoveSessionInput {
  readonly sessionId: string;
  readonly toDate: LocalDate;
}

/**
 * Moves one session to another day inside its own training week.
 *
 * The engine decides whether the move is legal (`canMoveSession`); this only
 * writes the new date and queues it. `src/data/store` is not this agent's to
 * change, so the update lives here rather than in `store/sessions.ts`.
 * Reported as an INTERFACE_ADD.
 */
export function useMoveSession(): ReturnType<typeof useMutation<void, Error, MoveSessionInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, MoveSessionInput>({
    mutationFn: async ({ sessionId, toDate }) => {
      if (db === null) throw new Error('The database is not open yet.');
      await db.runAsync('UPDATE session SET scheduled_date = ?, updated_at = ? WHERE id = ?', [
        toDate,
        new Date().toISOString(),
        sessionId,
      ]);
      await enqueue(db, { kind: 'session.move', entityId: sessionId, payload: { toDate } });
    },
    onSuccess: (_result, { sessionId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
