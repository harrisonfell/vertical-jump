import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull, useToday } from '../db';
import type { SetLog } from '../types';
import {
  editSet,
  listSetLogs,
  logSet,
  undoSet,
  type LogSetInput,
  type SetLogPatch,
} from '../store/setLogs';
import { queryKeys } from './keys';

export function useSetLogs(sessionId: string | undefined): UseQueryResult<SetLog[]> {
  const db = useDbOrNull();
  const enabled = db !== null && sessionId !== undefined;
  return useQuery({
    queryKey: queryKeys.setLogs(sessionId ?? 'none'),
    enabled,
    queryFn: async () => (enabled ? listSetLogs(db, sessionId) : []),
  });
}

/**
 * One tap, one row. The row and its outbox op land in the same transaction, so
 * the gym works with the phone in airplane mode, the server catches up later,
 * and a kill between the two cannot leave a set that is on the phone and will
 * never be sent.
 */
export function useLogSet(): ReturnType<typeof useMutation<SetLog, Error, LogSetInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  const today = useToday();
  return useMutation<SetLog, Error, LogSetInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      return logSet(db, { loggedOnDay: today, ...input }, (saved) => [
        { kind: 'setLog.upsert', entityId: saved.id, payload: saved },
      ]);
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: queryKeys.setLogs(saved.sessionId) });
      void client.invalidateQueries({ queryKey: queryKeys.session(saved.sessionId) });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export interface UndoSetInput {
  readonly sessionId: string;
  readonly sessionExerciseId: string;
  readonly setNumber: number;
}

/** Tap again to undo: the row is deleted, not flagged. */
export function useUndoSet(): ReturnType<typeof useMutation<boolean, Error, UndoSetInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<boolean, Error, UndoSetInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      return undoSet(db, input.sessionExerciseId, input.setNumber, () => [
        { kind: 'setLog.delete', entityId: input.sessionExerciseId, payload: input },
      ]);
    },
    onSuccess: (_removed, input) => {
      void client.invalidateQueries({ queryKey: queryKeys.setLogs(input.sessionId) });
      void client.invalidateQueries({ queryKey: queryKeys.session(input.sessionId) });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export interface EditSetInput {
  readonly setLogId: string;
  readonly patch: SetLogPatch;
}

export function useEditSet(): ReturnType<typeof useMutation<SetLog, Error, EditSetInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<SetLog, Error, EditSetInput>({
    mutationFn: async ({ setLogId, patch }) => {
      if (db === null) throw new Error('The database is not open yet.');
      return editSet(db, setLogId, patch, new Date(), (saved) => [
        { kind: 'setLog.edit', entityId: saved.id, payload: patch },
      ]);
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: queryKeys.setLogs(saved.sessionId) });
      void client.invalidateQueries({ queryKey: queryKeys.session(saved.sessionId) });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

/** One logged set, joined to the lift and the day it belongs to. */
export interface LiftSetRow {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly loadType: string;
  readonly loadMode: string;
  readonly sessionId: string;
  readonly localDate: string;
  readonly setNumber: number;
  readonly repsDone: number | null;
  readonly loadKg: number | null;
  readonly rpe: number | null;
  readonly meanVelocityBest: number | null;
  readonly velocityLossPct: number | null;
}

interface LiftSetJoinRow {
  readonly exercise_id: string;
  readonly exercise_name: string;
  readonly load_type: string;
  readonly load_mode: string;
  readonly session_id: string;
  readonly scheduled_date: string;
  readonly set_number: number;
  readonly reps_done: number | null;
  readonly load_kg: number | null;
  readonly rpe: number | null;
  readonly mean_velocity_best: number | null;
  readonly velocity_loss_pct: number | null;
}

/**
 * Every loaded set across the program, oldest first.
 *
 * The Lifts section needs a lift's whole history at once (top sets, the R97
 * drop, the load-velocity points), and walking sessions one query at a time
 * would be one round trip per training day. Sets with no load are left out:
 * a mobility hold has no working max to explain.
 */
export function useLiftSets(): UseQueryResult<LiftSetRow[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: ['setLogs', 'lifts'],
    enabled: db !== null,
    queryFn: async (): Promise<LiftSetRow[]> => {
      if (db === null) return [];
      const rows = await db.getAllAsync<LiftSetJoinRow>(
        `SELECT se.exercise_id, se.exercise_name, se.load_type, se.load_mode,
                s.id AS session_id, s.scheduled_date,
                sl.set_number, sl.reps_done, sl.load_kg, sl.rpe,
                sl.mean_velocity_best, sl.velocity_loss_pct
           FROM set_log sl
           JOIN session_exercise se ON se.id = sl.session_exercise_id
           JOIN session s ON s.id = sl.session_id
          WHERE sl.load_kg IS NOT NULL
          ORDER BY s.scheduled_date, se.order_index, sl.set_number`,
      );
      return rows.map((row) => ({
        exerciseId: row.exercise_id,
        exerciseName: row.exercise_name,
        loadType: row.load_type,
        loadMode: row.load_mode,
        sessionId: row.session_id,
        localDate: row.scheduled_date,
        setNumber: row.set_number,
        repsDone: row.reps_done,
        loadKg: row.load_kg,
        rpe: row.rpe,
        meanVelocityBest: row.mean_velocity_best,
        velocityLossPct: row.velocity_loss_pct,
      }));
    },
  });
}
