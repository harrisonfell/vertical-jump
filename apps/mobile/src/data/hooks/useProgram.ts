import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull, useToday } from '../db';
import type { AdherenceInputs, Block, Json, Program, ProgramVersion, Week } from '../types';
import {
  createProgram,
  getCurrentProgram,
  getWeek,
  getWeekForDate,
  listBlocks,
  listWeeks,
  markWeekGenerated,
  upsertWeek,
  type CreateProgramInput,
  type CreatedProgram,
  type UpsertWeekInput,
} from '../store/program';
import { weekAdherenceInputs } from '../store/sessions';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

interface ProgramVersionRow {
  readonly id: string;
  readonly program_id: string;
  readonly version: number;
  readonly week_layout: string;
  readonly reason: string | null;
  readonly created_at: string;
}

function parseLayout(value: string): Json {
  try {
    return JSON.parse(value) as Json;
  } catch {
    return null;
  }
}


export function useCurrentProgram(): UseQueryResult<Program | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.currentProgram(),
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getCurrentProgram(db)),
  });
}

export function useWeek(programId: string | undefined, w: number | undefined): UseQueryResult<Week | null> {
  const db = useDbOrNull();
  const enabled = db !== null && programId !== undefined && w !== undefined;
  return useQuery({
    queryKey: queryKeys.week(programId ?? 'none', w ?? -1),
    enabled,
    queryFn: async () => (enabled ? getWeek(db, programId, w) : null),
  });
}

/** The week whose window contains today, which is how Today finds itself. */
export function useCurrentWeek(programId: string | undefined): UseQueryResult<Week | null> {
  const db = useDbOrNull();
  const today = useToday();
  const enabled = db !== null && programId !== undefined;
  return useQuery({
    queryKey: [...queryKeys.weeks(programId ?? 'none'), 'forDate', today],
    enabled,
    queryFn: async () => (enabled ? getWeekForDate(db, programId, today) : null),
  });
}

export function useWeeks(programId: string | undefined): UseQueryResult<Week[]> {
  const db = useDbOrNull();
  const enabled = db !== null && programId !== undefined;
  return useQuery({
    queryKey: queryKeys.weeks(programId ?? 'none'),
    enabled,
    queryFn: async () => (enabled ? listWeeks(db, programId) : []),
  });
}

export function useBlocks(programId: string | undefined): UseQueryResult<Block[]> {
  const db = useDbOrNull();
  const enabled = db !== null && programId !== undefined;
  return useQuery({
    queryKey: [...queryKeys.weeks(programId ?? 'none'), 'blocks'],
    enabled,
    queryFn: async () => (enabled ? listBlocks(db, programId) : []),
  });
}

/** The inputs the engine's computeAdherence needs for one week. */
export function useAdherenceInputs(weekId: string | undefined): UseQueryResult<AdherenceInputs | null> {
  const db = useDbOrNull();
  const today = useToday();
  const enabled = db !== null && weekId !== undefined;
  return useQuery({
    queryKey: ['week', 'adherence', weekId ?? 'none', today],
    enabled,
    queryFn: async () => (enabled ? weekAdherenceInputs(db, weekId, today) : null),
  });
}

export function useCreateProgram(): ReturnType<
  typeof useMutation<CreatedProgram, Error, CreateProgramInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<CreatedProgram, Error, CreateProgramInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      const created = await createProgram(db, input);
      await enqueue(db, {
        kind: 'program.create',
        entityId: created.program.id,
        payload: { startDate: input.startDate, endDate: input.endDate, seed: input.seed },
      });
      return created;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['program'] });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useUpsertWeek(): ReturnType<typeof useMutation<Week, Error, UpsertWeekInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<Week, Error, UpsertWeekInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      const week = await upsertWeek(db, input);
      await enqueue(db, { kind: 'week.upsert', entityId: week.id, payload: { w: week.w } });
      return week;
    },
    onSuccess: (week) => {
      void client.invalidateQueries({ queryKey: queryKeys.weeks(week.programId) });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export interface MarkWeekGeneratedInput {
  readonly weekId: string;
  readonly generatedBy: string;
  readonly snapshot?: unknown;
}

export function useMarkWeekGenerated(): ReturnType<
  typeof useMutation<void, Error, MarkWeekGeneratedInput>
> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, MarkWeekGeneratedInput>({
    mutationFn: async ({ weekId, generatedBy, snapshot }) => {
      if (db === null) throw new Error('The database is not open yet.');
      await markWeekGenerated(db, weekId, generatedBy, snapshot);
      await enqueue(db, { kind: 'week.generated', entityId: weekId, payload: { generatedBy } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

/**
 * Every version of the program, newest first.
 *
 * The Plan shows a version note only when more than one exists, and lists the
 * earlier ones read-only. The repository has `getLatestProgramVersion` but no
 * list, and `src/data/store` is not this agent's to change, so the read lives
 * here. Reported as an INTERFACE_ADD: it belongs in `store/program.ts`.
 */
export function useProgramVersions(programId: string | undefined): UseQueryResult<ProgramVersion[]> {
  const db = useDbOrNull();
  const enabled = db !== null && programId !== undefined;
  return useQuery({
    queryKey: [...queryKeys.currentProgram(), 'versions', programId ?? 'none'],
    enabled,
    queryFn: async () => {
      if (!enabled) return [];
      const rows = await db.getAllAsync<ProgramVersionRow>(
        'SELECT id, program_id, version, week_layout, reason, created_at FROM program_version WHERE program_id = ? ORDER BY version DESC',
        [programId],
      );
      return rows.map(
        (row): ProgramVersion => ({
          id: row.id,
          programId: row.program_id,
          version: row.version,
          weekLayout: parseLayout(row.week_layout),
          reason: row.reason,
          createdAt: row.created_at,
        }),
      );
    },
  });
}
