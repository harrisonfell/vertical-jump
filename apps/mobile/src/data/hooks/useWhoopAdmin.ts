import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDbOrNull } from '../db';
import type { SqlExecutor } from '../executor';

/**
 * The two destructive Whoop actions, kept out of `useWhoop.ts` so the everyday
 * reads and the "remove all of this" writes are never one import away from
 * each other.
 *
 * Disconnecting keeps the mirrors: 90 days of recovery are the athlete's own
 * history and the charts still read them. Deleting the data is the separate,
 * named action that removes them.
 */

/** Mirror tables, children first so the workout links go before the workouts. */
const WHOOP_TABLES: readonly string[] = [
  'session_workout_link',
  'whoop_workout',
  'whoop_sleep',
  'whoop_recovery',
  'whoop_cycle',
  'webhook_event',
];

export async function deleteWhoopData(db: SqlExecutor): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const table of WHOOP_TABLES) await db.runAsync(`DELETE FROM ${table}`);
    await db.runAsync(
      "UPDATE whoop_connection SET backfill_days_done = 0, backfill_cursor = NULL, last_sync_at = NULL, updated_at = ?",
      [new Date().toISOString()],
    );
  });
}

export function useDeleteWhoopData(): ReturnType<typeof useMutation<void, Error, void>> {
  const db = useDbOrNull();
  const client = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (db === null) throw new Error('The database is not open yet.');
      await deleteWhoopData(db);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['whoop'] });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
