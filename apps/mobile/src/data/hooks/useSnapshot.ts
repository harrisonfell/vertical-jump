import {
  focusManager,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useDbOrNull, useDbState } from '../db';
import type { SqlExecutor } from '../executor';
import type { SnapshotMeta } from '../sync/apiContract';
import {
  dismissReplaced,
  keepThisDevice,
  markSnapshotDirty,
  restoreSnapshot,
  serverSnapshotRemote,
  snapshotLocal,
  syncSnapshot,
  useServerCopy,
  type PushOutcome,
  type SnapshotLocal,
  type SnapshotRemote,
  type SnapshotSyncReason,
  type SnapshotSyncResult,
} from '../sync/snapshot';
import { serverConfigured } from '../sync/transport';
import { queryKeys } from './keys';

/**
 * The database copy on the server, kept in step with this device.
 *
 * `useSnapshotSync` is mounted once in the app chrome and runs a pass on
 * open, when the app comes back to the foreground, a moment after any local
 * write, and once more when the app goes to the background with unsaved
 * changes. Settings reads the standing through `useSnapshotStatus` and acts on
 * it through `useSnapshotActions`; every path ends in the same `settle`, which
 * is what makes a copy pulled from the server show up on every screen.
 */

/** A burst of set taps becomes one save. */
export const SNAPSHOT_DEBOUNCE_MS = 3_000;

/** Mutations from these families are the sync's own, never a reason to save. */
const OWN_MUTATION_FAMILIES: ReadonlySet<unknown> = new Set(['snapshot', 'sync']);

let remote: SnapshotRemote | null = null;

function remoteFor(): SnapshotRemote {
  remote = remote ?? serverSnapshotRemote();
  return remote;
}

/** Tests only: a remote that never touches the network. */
export function setSnapshotRemoteForTests(next: SnapshotRemote | null): void {
  remote = next;
}

/* -------------------------------------------------------------- runner */

/**
 * Passes never overlap: a trigger during a pass runs one more pass after it,
 * with the latest reason, rather than two saves racing each other.
 */
let inFlight: Promise<SnapshotSyncResult> | null = null;
let queued: SnapshotSyncReason | null = null;

function runPass(
  db: SqlExecutor,
  reason: SnapshotSyncReason,
  settle: (result: SnapshotSyncResult) => Promise<void>,
): Promise<SnapshotSyncResult> {
  if (inFlight !== null) {
    queued = reason;
    return inFlight;
  }
  const pass = (async (): Promise<SnapshotSyncResult> => {
    let result = await syncSnapshot(db, remoteFor(), { reason });
    await settle(result);
    while (queued !== null) {
      const next = queued;
      queued = null;
      result = await syncSnapshot(db, remoteFor(), { reason: next });
      await settle(result);
    }
    return result;
  })();
  inFlight = pass.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** What every pass ends in: the cache told, and the screens re-read. */
async function settleWith(
  client: QueryClient,
  reload: () => Promise<void>,
  result: SnapshotSyncResult,
): Promise<void> {
  if (result.kind === 'pulled') {
    await reload();
    await client.invalidateQueries();
    return;
  }
  await client.invalidateQueries({ queryKey: queryKeys.snapshot() });
}

/* --------------------------------------------------------------- hooks */

export function useSnapshotSync(): void {
  const db = useDbOrNull();
  const { reload } = useDbState();
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback(
    (result: SnapshotSyncResult) => settleWith(client, reload, result),
    [client, reload],
  );

  useEffect(() => {
    if (db === null) return;
    if (!serverConfigured()) return;

    let disposed = false;
    const run = (reason: SnapshotSyncReason): void => {
      if (disposed) return;
      void runPass(db, reason, settle);
    };
    const schedule = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => run('write'), SNAPSHOT_DEBOUNCE_MS);
    };

    run('boot');

    const unfocus = focusManager.subscribe((focused) => {
      if (focused) {
        run('focus');
        return;
      }
      // Going to the background: a save now beats one at the next open, which
      // may be on the other device.
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        run('write');
      }
    });
    const unmutate = client.getMutationCache().subscribe((event) => {
      const mutation = event.mutation;
      if (mutation === undefined || mutation.state.status !== 'success') return;
      const family = mutation.options.mutationKey?.[0];
      if (OWN_MUTATION_FAMILIES.has(family)) return;
      void markSnapshotDirty(db).then(schedule, schedule);
    });

    return () => {
      disposed = true;
      if (timer.current !== null) clearTimeout(timer.current);
      unfocus();
      unmutate();
    };
  }, [db, client, settle]);
}

/** This device's standing against the server copy, for Settings. */
export function useSnapshotStatus(): UseQueryResult<SnapshotLocal> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: [...queryKeys.snapshot(), 'local'],
    enabled: db !== null,
    queryFn: async () => {
      if (db === null) throw new Error('The database is not open yet.');
      return snapshotLocal(db);
    },
  });
}

/** The copies still on the server, newest first. */
export function useSnapshotVersions(enabled: boolean): UseQueryResult<SnapshotMeta[]> {
  return useQuery({
    queryKey: [...queryKeys.snapshot(), 'versions'],
    enabled: enabled && serverConfigured(),
    queryFn: () => remoteFor().versions(),
  });
}

export interface SnapshotActions {
  readonly syncNow: UseMutationResult<SnapshotSyncResult, Error, void>;
  readonly keepThisDevice: UseMutationResult<PushOutcome, Error, void>;
  readonly useServerCopy: UseMutationResult<SnapshotMeta | null, Error, void>;
  readonly restore: UseMutationResult<SnapshotMeta | null, Error, number>;
  readonly dismissReplaced: UseMutationResult<void, Error, void>;
}

/** The decisions Settings can take. Each ends in the same settle as a pass. */
export function useSnapshotActions(): SnapshotActions {
  const db = useDbOrNull();
  const { reload } = useDbState();
  const client = useQueryClient();

  const need = (): SqlExecutor => {
    if (db === null) throw new Error('The database is not open yet.');
    return db;
  };
  const adopted = async (): Promise<void> => {
    await reload();
    await client.invalidateQueries();
  };
  const saved = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: queryKeys.snapshot() });
  };

  const syncNow = useMutation<SnapshotSyncResult, Error, void>({
    mutationKey: [...queryKeys.snapshot(), 'now'],
    mutationFn: () => runPass(need(), 'manual', (result) => settleWith(client, reload, result)),
  });

  const keep = useMutation<PushOutcome, Error, void>({
    mutationKey: [...queryKeys.snapshot(), 'keep'],
    mutationFn: () => keepThisDevice(need(), remoteFor()),
    onSuccess: saved,
  });

  const adopt = useMutation<SnapshotMeta | null, Error, void>({
    mutationKey: [...queryKeys.snapshot(), 'adopt'],
    mutationFn: () => useServerCopy(need(), remoteFor()),
    onSuccess: adopted,
  });

  const restore = useMutation<SnapshotMeta | null, Error, number>({
    mutationKey: [...queryKeys.snapshot(), 'restore'],
    mutationFn: (version) => restoreSnapshot(need(), remoteFor(), version),
    onSuccess: adopted,
  });

  const dismiss = useMutation<void, Error, void>({
    mutationKey: [...queryKeys.snapshot(), 'dismiss'],
    mutationFn: () => dismissReplaced(need()),
    onSuccess: saved,
  });

  return { syncNow, keepThisDevice: keep, useServerCopy: adopt, restore, dismissReplaced: dismiss };
}
