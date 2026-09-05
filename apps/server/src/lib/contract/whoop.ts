/**
 * Everything Whoop: the OAuth start, the connection's status and its bounded
 * sync, the webhook body, and the four mirror rows the phone stores verbatim.
 */

import { z } from 'zod';
import { isoTimestamp, jsonValue, localDate, scoreState, whoopErrorKind } from './primitives';


/**
 * A 302 by default, because the phone opens this in the system auth session.
 * `?response=json` (or `Accept: application/json`) answers the URL and the
 * state instead, which is what the app client reads.
 */
export const whoopStartQuery = z.object({
  /** Where the callback bounces to. Defaults to vert://whoop/connected. */
  redirect: z.string().max(512).optional(),
  response: z.enum(['redirect', 'json']).default('redirect'),
  /** The single-use start ticket. See `whoopStartTokenResponse` below. */
  t: z.string().min(16).max(256).optional(),
});
export type WhoopStartQuery = z.infer<typeof whoopStartQuery>;

/**
 * POST /api/whoop/start-token, bearer only.
 *
 * `openAuthSessionAsync` hands the start URL to the operating system's
 * browser, which cannot be given an Authorization header, so the phone spends
 * a single-use ticket in the query string instead and the device secret stays
 * in expo-secure-store. Sixty seconds, one use, bound to the device that asked.
 */
export const whoopStartTokenResponse = z.object({
  token: z.string().min(16),
  expiresAt: isoTimestamp,
});
export type WhoopStartTokenResponse = z.infer<typeof whoopStartTokenResponse>;

/** The query parameter that carries it, and how long it lives. */
export const WHOOP_START_TOKEN_PARAM = 't';
export const WHOOP_START_TOKEN_SECONDS = 60;

export const whoopStartResponse = z.object({
  url: z.string().min(1),
  /** Minted server-side, at least 8 characters, bound to the caller. */
  state: z.string().min(8),
});
export type WhoopStartResponse = z.infer<typeof whoopStartResponse>;

/** Whoop hands the code back here; the app never sees it. */
export const whoopCallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(8),
  error: z.string().optional(),
});
export type WhoopCallbackQuery = z.infer<typeof whoopCallbackQuery>;

/** Where the callback lands: the app scheme, or the web settings screen. */
export const APP_CONNECTED_REDIRECT = 'vert://whoop/connected';
export const WEB_CONNECTED_REDIRECT = '/settings/whoop?connected=1';

/* ----------------------------------------------------------- whoop status */

export const whoopStatus = z.enum([
  'disconnected',
  'connecting',
  'importing',
  'connected',
  'revoked',
  'error',
]);
export type WhoopStatus = z.infer<typeof whoopStatus>;

export const whoopStatusResponse = z.object({
  status: whoopStatus,
  whoopUserId: z.string().nullable(),
  connectedAt: isoTimestamp.nullable(),
  lastSyncAt: isoTimestamp.nullable(),
  /** 90 day backfill, chunked and resumable. Gaps stay gaps, never zeros. */
  backfillDaysDone: z.number().int().nonnegative(),
  backfillDaysTotal: z.number().int().nonnegative(),
  lastError: whoopErrorKind.nullable(),
  /** When the next automatic attempt runs; also the rate-limit "next sync at". */
  nextRetryAt: isoTimestamp.nullable(),
});
export type WhoopStatusResponse = z.infer<typeof whoopStatusResponse>;

/** One bounded chunk: 25 a page, at most WHOOP_SYNC_MAX_PAGES a call. */
export const whoopSyncResponse = whoopStatusResponse.extend({
  daysImported: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  done: z.boolean(),
});
export type WhoopSyncResponse = z.infer<typeof whoopSyncResponse>;

export const WHOOP_PAGE_LIMIT = 25;
export const WHOOP_SYNC_MAX_PAGES = 8;
export const WHOOP_BACKFILL_DAYS = 90;

/** DELETE /api/whoop/data: the mirrors go, the connection row stays. */
export const whoopDeleteDataResponse = z.object({
  deleted: z.object({
    cycles: z.number().int().nonnegative(),
    recoveries: z.number().int().nonnegative(),
    sleeps: z.number().int().nonnegative(),
    workouts: z.number().int().nonnegative(),
  }),
  status: whoopStatusResponse,
});
export type WhoopDeleteDataResponse = z.infer<typeof whoopDeleteDataResponse>;

/* ---------------------------------------------------------- whoop webhook */

/**
 * Creates arrive as "updated", so every write is an upsert. Signature is
 * base64(HMAC-SHA256(timestamp + raw body, client secret)); answer 2xx inside
 * a second and dedupe on the trace id, because Whoop retries five times.
 */
export const WHOOP_SIGNATURE_HEADER = 'x-whoop-signature';
export const WHOOP_SIGNATURE_TIMESTAMP_HEADER = 'x-whoop-signature-timestamp';

export const whoopWebhookType = z.enum([
  'recovery.updated',
  'recovery.deleted',
  'workout.updated',
  'workout.deleted',
  'sleep.updated',
  'sleep.deleted',
]);
export type WhoopWebhookType = z.infer<typeof whoopWebhookType>;

export const whoopWebhookBody = z.object({
  user_id: z.number().int(),
  id: z.union([z.string(), z.number().int()]),
  type: whoopWebhookType,
  trace_id: z.string().min(1),
});
export type WhoopWebhookBody = z.infer<typeof whoopWebhookBody>;

/* -------------------------------------------------------------- mirrors */

/** Shared by all four mirrors: the Whoop id, its own offset, its local date. */
const mirrorBase = {
  id: z.string().min(1),
  scoreState,
  timezoneOffset: z.string().nullable().default(null),
  localDate,
  raw: jsonValue,
  updatedAt: isoTimestamp,
};

export const whoopCycleRow = z.object({
  ...mirrorBase,
  startAt: isoTimestamp,
  endAt: isoTimestamp.nullable().default(null),
  strain: z.number().nullable().default(null),
  averageHeartRate: z.number().nullable().default(null),
  kilojoule: z.number().nullable().default(null),
});
export type WhoopCycleRow = z.infer<typeof whoopCycleRow>;

export const whoopRecoveryRow = z.object({
  ...mirrorBase,
  cycleId: z.string().nullable().default(null),
  sleepId: z.string().nullable().default(null),
  /** Null when the recovery is not scored: nobody knows yet, and that is not false. */
  userCalibrating: z.boolean().nullable().default(null),
  recoveryScore: z.number().nullable().default(null),
  restingHeartRate: z.number().nullable().default(null),
  hrvRmssdMilli: z.number().nullable().default(null),
  spo2Percentage: z.number().nullable().default(null),
  skinTempCelsius: z.number().nullable().default(null),
});
export type WhoopRecoveryRow = z.infer<typeof whoopRecoveryRow>;

export const whoopSleepRow = z.object({
  ...mirrorBase,
  cycleId: z.string().nullable().default(null),
  nap: z.boolean().default(false),
  startAt: isoTimestamp,
  endAt: isoTimestamp.nullable().default(null),
  sleepPerformancePercentage: z.number().nullable().default(null),
  sleepEfficiencyPercentage: z.number().nullable().default(null),
  respiratoryRate: z.number().nullable().default(null),
  totalInBedTimeMilli: z.number().nullable().default(null),
});
export type WhoopSleepRow = z.infer<typeof whoopSleepRow>;

export const whoopWorkoutRow = z.object({
  ...mirrorBase,
  sportName: z.string().nullable().default(null),
  startAt: isoTimestamp,
  endAt: isoTimestamp.nullable().default(null),
  strain: z.number().nullable().default(null),
  averageHeartRate: z.number().nullable().default(null),
  maxHeartRate: z.number().nullable().default(null),
  percentRecorded: z.number().nullable().default(null),
  zoneDurations: jsonValue.nullable().default(null),
});
export type WhoopWorkoutRow = z.infer<typeof whoopWorkoutRow>;

export const mirrorKind = z.enum(['cycle', 'recovery', 'sleep', 'workout']);
export type MirrorKind = z.infer<typeof mirrorKind>;

/** A deleted mirror travels as `deleted: true` with a null row. */
export const mirrorChange = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cycle'),
    id: z.string(),
    updatedAt: isoTimestamp,
    deleted: z.boolean(),
    row: whoopCycleRow.nullable(),
  }),
  z.object({
    kind: z.literal('recovery'),
    id: z.string(),
    updatedAt: isoTimestamp,
    deleted: z.boolean(),
    row: whoopRecoveryRow.nullable(),
  }),
  z.object({
    kind: z.literal('sleep'),
    id: z.string(),
    updatedAt: isoTimestamp,
    deleted: z.boolean(),
    row: whoopSleepRow.nullable(),
  }),
  z.object({
    kind: z.literal('workout'),
    id: z.string(),
    updatedAt: isoTimestamp,
    deleted: z.boolean(),
    row: whoopWorkoutRow.nullable(),
  }),
]);
export type MirrorChange = z.infer<typeof mirrorChange>;

export const mirrorsQuery = z.object({
  since: isoTimestamp.optional(),
  /** "cycle,recovery,sleep,workout". Omitted means all four. */
  kinds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().optional(),
});
export type MirrorsQuery = z.infer<typeof mirrorsQuery>;

export const mirrorsResponse = z.object({
  rows: z.array(mirrorChange),
  /**
   * Opaque; pass back as `cursor`. It is the last row's position on every page
   * that has rows, the last page included, so the phone can persist where it
   * got to rather than replaying a short feed on every run. Null now means
   * only that the page was empty: there was no row to name a position for.
   */
  next: z.string().nullable(),
  serverTime: isoTimestamp,
});
export type MirrorsResponse = z.infer<typeof mirrorsResponse>;

/** Parses the `kinds` query into the four literals, all four when absent. */
export function parseMirrorKinds(raw: string | undefined): MirrorKind[] {
  if (raw === undefined || raw.trim() === '') return ['cycle', 'recovery', 'sleep', 'workout'];
  const wanted = raw.split(',').map((part) => part.trim());
  return mirrorKind.options.filter((kind) => wanted.includes(kind));
}
