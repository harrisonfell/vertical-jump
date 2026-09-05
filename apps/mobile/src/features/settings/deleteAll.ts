/**
 * Delete all data.
 *
 * This is the only irreversible control in the app, so it is a typed confirm
 * rather than a second tap: the athlete writes the word, every table is
 * emptied inside one transaction, the sync queue goes with them (a queued op
 * for a row that no longer exists would resurrect it on the next sync), and
 * the app returns to setup.
 */
import type { SqlExecutor } from '@/data';

/** The word the athlete types. Lowercase, one word, no punctuation. */
export const DELETE_CONFIRM_WORD = 'delete';

export const DELETE_TITLE = 'Delete all data?';

export const DELETE_BODY =
  'Every session, set, jump test, program and Whoop mirror on this phone is removed, and the queued changes go with them. This cannot be undone. Export first if you want a copy.';

export const DELETE_FIELD_LABEL = `Type ${DELETE_CONFIRM_WORD} to confirm`;

export const DELETE_MISMATCH_ERROR = `That does not match. Type ${DELETE_CONFIRM_WORD} exactly.`;

/** Case and surrounding space are forgiven; anything else is not. */
export function deleteConfirmMatches(typed: string): boolean {
  return typed.trim().toLowerCase() === DELETE_CONFIRM_WORD;
}

/**
 * Every table, children before parents so a foreign key never blocks a delete.
 * `sync_queue` is in the list on purpose: emptying the database while leaving
 * queued writes behind would push rows for records that are gone.
 */
export const TABLES_IN_DELETE_ORDER: readonly string[] = [
  'vbt_rep',
  'vbt_set',
  'lvp_profile',
  'jump_rep',
  'metric_pr',
  'jump_test_session',
  'set_log',
  'session_event',
  'session_exercise',
  'session_workout_link',
  'session',
  'week',
  'block',
  'program_version',
  'program',
  'import_batch',
  'readiness_signal',
  'autoregulation_status',
  'athlete_baseline',
  'webhook_event',
  'whoop_workout',
  'whoop_sleep',
  'whoop_recovery',
  'whoop_cycle',
  'whoop_connection',
  'pain_status',
  'athlete',
  'sync_queue',
  'device_secret',
  'kv',
];

/** Empty every table in one transaction. Returns how many were cleared. */
export async function deleteAllData(db: SqlExecutor): Promise<number> {
  let cleared = 0;
  await db.withTransactionAsync(async () => {
    for (const table of TABLES_IN_DELETE_ORDER) {
      await db.runAsync(`DELETE FROM ${table}`);
      cleared += 1;
    }
  });
  return cleared;
}

/** Sign out clears the paired device secret and nothing else. */
export async function clearDeviceSecret(db: SqlExecutor): Promise<void> {
  await db.runAsync('DELETE FROM device_secret');
}

export const SIGN_OUT_TITLE = 'Sign out of this device?';

export const SIGN_OUT_BODY =
  'The pairing with the web review is forgotten. Your training data stays on this phone. Pair again from the web to get back in.';
