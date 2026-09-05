import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull } from '../db';
import type { Athlete, PainStatus, WorkingMax } from '../types';
import {
  getAthlete,
  listPainStatus,
  reportPain,
  setWorkingMax,
  upsertAthlete,
  type AthletePatch,
  type PainStatusInput,
} from '../store/athlete';
import { enqueue } from '../store/sync';
import { queryKeys } from './keys';

export function useAthlete(): UseQueryResult<Athlete | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.athlete(),
    enabled: db !== null,
    queryFn: async () => (db === null ? null : getAthlete(db)),
  });
}

export function usePainStatus(includeCleared = false): UseQueryResult<PainStatus[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.pain(), includeCleared],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listPainStatus(db, includeCleared)),
  });
}

/** Local write first, then one queued op, then the exact keys that changed. */
export function useUpdateAthlete(): ReturnType<typeof useMutation<Athlete, Error, AthletePatch>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<Athlete, Error, AthletePatch>({
    mutationFn: async (patch) => {
      if (db === null) throw new Error('The database is not open yet.');
      const saved = await upsertAthlete(db, patch);
      await enqueue(db, { kind: 'athlete.upsert', entityId: saved.id, payload: patch });
      return saved;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useReportPain(): ReturnType<typeof useMutation<PainStatus, Error, PainStatusInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<PainStatus, Error, PainStatusInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');
      const saved = await reportPain(db, input);
      await enqueue(db, { kind: 'pain.report', entityId: saved.id, payload: input });
      return saved;
    },
    onSuccess: () => {
      // Pain changes re-materialise from the next unlogged session, so the
      // program and every session view are stale the moment one lands.
      void client.invalidateQueries({ queryKey: queryKeys.pain() });
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export function useSetWorkingMax(): ReturnType<typeof useMutation<Athlete, Error, WorkingMax>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<Athlete, Error, WorkingMax>({
    mutationFn: async (max) => {
      if (db === null) throw new Error('The database is not open yet.');
      const saved = await setWorkingMax(db, max);
      await enqueue(db, { kind: 'workingMax.set', entityId: max.exerciseId, payload: max });
      return saved;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
