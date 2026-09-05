/**
 * Migration 4: an idempotency key of the outbox row's own.
 *
 * A push op used to be keyed `${deviceId}:${queueRowId}`, and the queue row id
 * is a SQLite autoincrement that starts again at 1 whenever the local database
 * is dropped: a reinstall, a "clear data", a web build whose IndexedDB the
 * browser evicted. The server keys its `sync_op` table on that id, so the
 * first op after a reset carried an id the server had already applied and was
 * acknowledged without ever being written. A uuid minted when the row is
 * enqueued belongs to the op rather than to the row's position, so it survives
 * a reset and can never be handed out twice.
 *
 * Rows already waiting when this runs have no uuid yet; the outbox mints one
 * for them the first time it lists them, so nothing in the queue is stranded.
 * The unique index tolerates those nulls, which is what SQLite does with nulls
 * in a unique index, and refuses a genuine repeat.
 */
export const MIGRATION_0004 = `
ALTER TABLE sync_queue ADD COLUMN uuid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_uuid ON sync_queue (uuid);
`;
