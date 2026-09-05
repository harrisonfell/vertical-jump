import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull } from '../db';
import type { SyncQueueRow, SyncStatus } from '../types';
import { getSyncStatus, listPending, markAttempted, markSynced } from '../store/sync';
import { queryKeys } from './keys';

const EMPTY: SyncStatus = { pending: 0, oldestPendingAt: null, lastSyncedAt: null };

/**
 * What the sync line renders from.
 *
 * pending + no recent sync  "Offline · 4 changes saved on this phone"
 * pending 0                 "Synced 6:41 PM"
 * pending and old           "4 changes not synced for 2 days"
 */
export function useSyncStatus(): UseQueryResult<SyncStatus> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.sync(),
    enabled: db !== null,
    queryFn: async () => (db === null ? EMPTY : getSyncStatus(db)),
    // The queue moves under us whenever a mutation lands, and this is a cheap
    // count against a local index.
    refetchInterval: 30_000,
  });
}

export function usePendingOps(limit = 100): UseQueryResult<SyncQueueRow[]> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.sync(), 'pending', limit],
    enabled: db !== null,
    queryFn: async () => (db === null ? [] : listPending(db, limit)),
  });
}

/** Whole days the oldest pending change has been waiting, for the "2 days" line. */
export function pendingAgeDays(status: SyncStatus, now: Date = new Date()): number {
  if (status.oldestPendingAt === null) return 0;
  const oldest = new Date(status.oldestPendingAt).getTime();
  if (Number.isNaN(oldest)) return 0;
  return Math.max(0, Math.floor((now.getTime() - oldest) / 86_400_000));
}

export function useMarkSynced(): ReturnType<typeof useMutation<void, Error, readonly number[]>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, readonly number[]>({
    mutationFn: async (ids) => {
      if (db === null) throw new Error('The database is not open yet.');
      await markSynced(db, ids);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}

export interface MarkAttemptedInput {
  readonly ids: readonly number[];
  readonly error?: string;
}

export function useMarkAttempted(): ReturnType<typeof useMutation<void, Error, MarkAttemptedInput>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, MarkAttemptedInput>({
    mutationFn: async ({ ids, error }) => {
      if (db === null) throw new Error('The database is not open yet.');
      await markAttempted(db, ids, error);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
