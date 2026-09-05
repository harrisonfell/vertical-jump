/**
 * Pairing, the single-owner login, and the sync outbox landing table.
 *
 * There are no accounts. One owner holds one passphrase for the web and any
 * number of paired devices; `login_attempt` is deliberately one row, because
 * the counter that matters is the server's and there is only one owner to
 * count for.
 */

import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Json, SyncOpKind } from '../../lib/api-contract';

/** Server-owned instant: ordering and cursors depend on real timestamps. */
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One row per paired device. Only the hash is stored, so a leaked table does
 * not hand anyone a Bearer token.
 */
export const deviceSecret = pgTable(
  'device_secret',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** scrypt of the secret, in the same format as APP_PASSPHRASE_HASH. */
    secretHash: text('secret_hash').notNull(),
    pairedAt: at('paired_at').notNull(),
    lastSeenAt: at('last_seen_at'),
    revokedAt: at('revoked_at'),
  },
  (table) => [index('device_secret_live').on(table.revokedAt, table.pairedAt)],
);

/**
 * A six digit code minted by the web review and claimed once by the phone.
 * Short lived, single use, and never reissued for the same code.
 */
export const pairCode = pgTable('pair_code', {
  code: text('code').primaryKey(),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull(),
  claimedAt: at('claimed_at'),
  claimedByDeviceId: text('claimed_by_device_id'),
});

/**
 * The failure counter and the lockout, in one row keyed 'owner'. Five failures
 * earn 60 s; the phone and the web read the same wait.
 */
export const loginAttempt = pgTable('login_attempt', {
  id: text('id').primaryKey(),
  failureCount: integer('failure_count').notNull().default(0),
  lockedUntil: at('locked_until'),
  lastFailureAt: at('last_failure_at'),
  /**
   * Signing out sets this, and every session minted before it stops being
   * accepted. Without it a cookie that leaked would stay valid for its whole
   * thirty days after the owner signed out, because the token is checked on
   * its signature alone.
   */
  sessionsValidFrom: at('sessions_valid_from'),
  updatedAt: at('updated_at').notNull(),
});

export const LOGIN_ATTEMPT_ID = 'owner';

/**
 * Every op the phone has pushed, and every change made on the web. `id` is the
 * idempotency key, so a replayed push collapses onto the row it already wrote;
 * `applied_at` is null only while a push is mid-flight.
 */
export const syncOp = pgTable(
  'sync_op',
  {
    id: text('id').primaryKey(),
    /**
     * Insertion order, which is what the change feed pages on. The op id is
     * `${deviceId}:${queueRowId}` and sorts as text, so "dev:10" would come
     * before "dev:9" and a batch would replay out of the order it was applied.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    kind: text('kind').$type<SyncOpKind>().notNull(),
    entityId: text('entity_id'),
    /** JSON null is a legal payload, so the column takes SQL null for it. */
    payload: jsonb('payload').$type<Json>(),
    /** The phone's own createdAt, kept verbatim as the ISO string it sent. */
    createdAt: text('created_at').notNull(),
    receivedAt: at('received_at').notNull(),
    appliedAt: at('applied_at'),
    origin: text('origin').$type<'web' | 'server' | 'device'>().notNull(),
    deviceId: text('device_id'),
    error: text('error'),
  },
  (table) => [
    index('sync_op_feed').on(table.seq),
    index('sync_op_entity').on(table.kind, table.entityId),
  ],
);

/**
 * Imports made on the web or committed on the phone. File hash is the
 * idempotency key: re-importing the same export is a no-op.
 */
export const importBatch = pgTable('import_batch', {
  id: text('id').primaryKey(),
  fileHash: text('file_hash').notNull().unique(),
  fileName: text('file_name'),
  type: text('type').notNull(),
  exporterVersion: text('exporter_version'),
  schemaVersion: text('schema_version'),
  rowCount: integer('row_count').notNull().default(0),
  mapping: jsonb('mapping').$type<Json>(),
  counts: jsonb('counts').$type<Json>(),
  status: text('status').notNull().default('preview'),
  createdAt: text('created_at').notNull(),
  committedAt: text('committed_at'),
  isWeb: boolean('is_web').notNull().default(false),
});
