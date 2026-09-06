/**
 * The database snapshot: the athlete's whole SQLite file, kept on the server
 * so every device opens on the same data.
 *
 * The bytes travel as `application/octet-stream` and everything about them as
 * headers, because a JSON envelope would base64 a file that is already a few
 * hundred kilobytes for nothing. The app and the server spell the header
 * names from this one list.
 */

import { z } from 'zod';
import { isoTimestamp } from './primitives';

/** Request and response headers around the raw body. */
export const SNAPSHOT_HEADERS = {
  version: 'x-snapshot-version',
  schema: 'x-snapshot-schema',
  /** On a PUT: the version the uploader adopted last, or `none`. */
  base: 'x-snapshot-base',
  /** On a PUT: `1` saves over a newer copy on purpose. */
  force: 'x-snapshot-force',
  createdAt: 'x-snapshot-created-at',
  origin: 'x-snapshot-origin',
  device: 'x-snapshot-device',
  sha256: 'x-snapshot-sha256',
} as const;

/**
 * The most a save may carry. Vercel caps a function's request body at 4.5 MB,
 * and the athlete's database is a few hundred kilobytes, so this is a guard
 * against a mistake rather than a limit anyone should meet.
 */
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

/** How many older copies stay restorable. */
export const SNAPSHOT_KEEP = 20;

export const snapshotMeta = z.object({
  version: z.number().int().positive(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  schemaVersion: z.number().int().positive(),
  origin: z.enum(['web', 'device']),
  deviceId: z.string().nullable(),
  baseVersion: z.number().int().positive().nullable(),
  createdAt: isoTimestamp,
});
export type SnapshotMeta = z.infer<typeof snapshotMeta>;

/** `GET /api/snapshot?meta=1` and `PUT /api/snapshot`. */
export const snapshotMetaResponse = z.object({ snapshot: snapshotMeta.nullable() });
export type SnapshotMetaResponse = z.infer<typeof snapshotMetaResponse>;

/** `GET /api/snapshot/versions`, newest first. */
export const snapshotVersionsResponse = z.object({ versions: z.array(snapshotMeta) });
export type SnapshotVersionsResponse = z.infer<typeof snapshotVersionsResponse>;

/** A PUT whose base is not the newest copy: 409 with the copy that is. */
export const snapshotConflict = z.object({
  error: z.literal('snapshot_conflict'),
  message: z.string(),
  retryAfterS: z.number().nullable(),
  current: snapshotMeta.nullable(),
});
export type SnapshotConflict = z.infer<typeof snapshotConflict>;
