/**
 * The athlete's whole database, one copy per save, newest first.
 *
 * The phone and the web each keep their own SQLite file and the op feed only
 * carries patches, so a program built on one device could never be rebuilt on
 * the other from the feed alone. This table holds the file itself: a device
 * uploads its database after it changes and downloads the newest one when it
 * opens. `version` is the server's own counter, `base_version` is the version
 * the uploader was on when it saved, and the two disagreeing is how a save
 * over someone else's newer copy is caught rather than lost in silence.
 *
 * The last `SNAPSHOT_KEEP` versions stay, so a copy that was overwritten can be
 * restored from Settings.
 */

import { bigserial, customType, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Server-owned instant: ordering depends on real timestamps. */
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Raw bytes. postgres.js hands a Buffer back and pglite a Uint8Array, and a
 * Buffer is a Uint8Array, so one reader covers both drivers.
 */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Uint8Array {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
  fromDriver(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === 'string' && value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex');
    throw new TypeError('bytea column came back in an unknown shape');
  },
});

export const snapshot = pgTable('snapshot', {
  version: bigserial('version', { mode: 'number' }).primaryKey(),
  bytes: bytea('bytes').notNull(),
  byteLength: integer('byte_length').notNull(),
  sha256: text('sha256').notNull(),
  /** The app's own migration number the file was written under. */
  schemaVersion: integer('schema_version').notNull(),
  origin: text('origin').$type<'web' | 'device'>().notNull(),
  deviceId: text('device_id'),
  /** The version the uploader had adopted before it saved; null for a first copy. */
  baseVersion: integer('base_version'),
  createdAt: at('created_at').notNull(),
});
