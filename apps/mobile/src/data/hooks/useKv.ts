import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull } from '../db';
import { kvDelete, kvGet, kvSet } from '../store/kv';

/**
 * One durable string, read and written by key.
 *
 * Progress needs exactly this for the acknowledgements that must survive a
 * cold start (the goal-reached card, the program-complete card) and nothing
 * heavier: they are single stamps, so a table would be ceremony.
 */
export function useKvValue(key: string): UseQueryResult<string | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: ['kv', key],
    enabled: db !== null,
    queryFn: async () => (db === null ? null : kvGet(db, key)),
  });
}

export interface SetKvInput {
  readonly key: string;
  /** Null clears the row, so "not acknowledged" and "never seen" agree. */
  readonly value: string | null;
}

export function useSetKvValue(): ReturnType<typeof useMutation<void, Error, SetKvInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, SetKvInput>({
    mutationFn: async ({ key, value }) => {
      if (db === null) throw new Error('The database is not open yet.');
      if (value === null) await kvDelete(db, key);
      else await kvSet(db, key, value);
    },
    onSuccess: (_result, { key }) => {
      void client.invalidateQueries({ queryKey: ['kv', key] });
    },
  });
}
