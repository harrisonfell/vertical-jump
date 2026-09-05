/**
 * The two-way outbox between the phone and the server, and the export the
 * Settings screen builds from the same rows.
 */

import { z } from 'zod';
import { isoTimestamp, jsonValue, localDate } from './primitives';


/**
 * The phone's outbox kinds, verbatim from its enqueue call sites. The same
 * union travels both ways, so a web edit reaches the phone as one of these.
 *
 * The last three are additive, for the climbing house rules: the readiness
 * gate's neuromuscular test (`house.sc.readiness_gate`), the gate's answer for
 * one session, and the single-leg pair, which travels as its own kind because
 * it is its own jump-test mode and never joins a stream, a trend, or a PR
 * (`house.sc.asymmetry_tracking`). A profile change still travels as
 * `athlete.upsert`; there is no separate `athlete.update`.
 */
export const syncOpKind = z.enum([
  'athlete.upsert',
  'athlete.clearance',
  'pain.report',
  'pain.clear',
  'workingMax.set',
  'program.create',
  'week.upsert',
  'week.generated',
  'session.patch',
  'session.finish',
  'session.unfinish',
  'session.move',
  'setLog.upsert',
  'setLog.edit',
  'setLog.delete',
  'jumpTest.create',
  'jumpTest.delete',
  'import.commit',
  'whoop.link',
  'whoop.unlink',
  'readiness_test.create',
  'readiness_outcome.set',
  'jumpTest.single_leg',
]);
export type SyncOpKind = z.infer<typeof syncOpKind>;

/**
 * `id` is the idempotency key and must be stable across retries. The phone's
 * queue row id is a local autoincrement, so it sends `${deviceId}:${rowId}`
 * and a replayed push is a no-op rather than a double apply.
 */
export const syncOp = z.object({
  id: z.string().min(1).max(128),
  kind: syncOpKind,
  entityId: z.string().max(128).nullable().default(null),
  payload: jsonValue,
  createdAt: isoTimestamp,
});
export type SyncOp = z.infer<typeof syncOp>;

export const syncPushRequest = z.object({ ops: z.array(syncOp).min(1).max(200) });
export type SyncPushRequest = z.infer<typeof syncPushRequest>;

export const syncRejectReason = z.enum([
  'unknown_kind',
  'invalid_payload',
  'missing_entity',
  'conflict',
  'error',
]);
export type SyncRejectReason = z.infer<typeof syncRejectReason>;

export const syncPushResponse = z.object({
  /** Op ids the server has durably applied, including ones it had already seen. */
  accepted: z.array(z.string()),
  rejected: z.array(z.object({ id: z.string(), reason: syncRejectReason, message: z.string() })),
  serverTime: isoTimestamp,
});
export type SyncPushResponse = z.infer<typeof syncPushResponse>;

export const syncPullQuery = z.object({
  since: isoTimestamp.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().optional(),
});
export type SyncPullQuery = z.infer<typeof syncPullQuery>;

export const syncChange = z.object({
  id: z.string(),
  kind: syncOpKind,
  entityId: z.string().nullable(),
  payload: jsonValue,
  at: isoTimestamp,
  /** Where it came from, so the phone can skip its own echo. */
  origin: z.enum(['web', 'server', 'device']),
  deviceId: z.string().nullable().default(null),
});
export type SyncChange = z.infer<typeof syncChange>;

export const syncPullResponse = z.object({
  changes: z.array(syncChange),
  next: z.string().nullable(),
  serverTime: isoTimestamp,
});
export type SyncPullResponse = z.infer<typeof syncPullResponse>;

/* ---------------------------------------------------------------- export */

/**
 * The same CSVs and one JSON the phone's Settings export builds. `readiness`
 * is additive: the gate's own stream is not a jump test and does not belong in
 * `tests` (`house.sc.readiness_gate`).
 */
export const exportFileName = z.enum([
  'tests',
  'set-logs',
  'sessions',
  'weeks',
  'whoop',
  'readiness',
]);
export type ExportFileName = z.infer<typeof exportFileName>;

export const exportQuery = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  /** Required with format=csv; without it the response is the manifest. */
  file: exportFileName.optional(),
});
export type ExportQuery = z.infer<typeof exportQuery>;

export const exportManifest = z.object({
  exportedOn: localDate,
  files: z.array(
    z.object({
      name: exportFileName,
      label: z.string(),
      rowCount: z.number().int().nonnegative(),
      href: z.string(),
    }),
  ),
});
export type ExportManifest = z.infer<typeof exportManifest>;
