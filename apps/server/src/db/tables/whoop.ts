/**
 * The Whoop connection, the four mirrors, and the webhook ledger.
 *
 * Mirrors keep the raw JSON beside the fields we read, carry their own
 * score_state (a score is absent unless SCORED) and their own local date
 * derived from the record's own timezone offset, because Whoop counts
 * physiological cycles and not calendar days. Column names match the phone's
 * SQLite tables so a pulled row needs no translation.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { Json, ScoreState, WhoopErrorKind, WhoopStatus } from '../../lib/api-contract';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One sequence for all five mirror tables, so the feed has a single monotone
 * order. The feed used to page on `(updated_at, kind, id)`, and a sync chunk
 * stamps every page of a collection with the same instant while Whoop returns
 * newest first, so a cursor that landed inside one page could never reach the
 * lower ids in the next one. A number handed out at write time cannot go
 * backwards, whatever the records' own timestamps say.
 */
export const whoopFeedSeq = pgSequence('whoop_feed_seq');

/** The next feed position. Every insert and every update takes a new one. */
const feedSeq = () =>
  bigint('feed_seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('whoop_feed_seq')`);

/** What an upsert writes into `feed_seq` when it updates an existing row. */
export const nextFeedSeq = sql`nextval('whoop_feed_seq')`;

/**
 * One row, id 'owner'. Tokens are AES-256-GCM ciphertext; refresh happens
 * lazily inside SELECT ... FOR UPDATE on this row, because Whoop's refresh
 * tokens rotate and are single use, so two concurrent refreshes lose.
 * `row_version` rises on every write so a stale writer can be detected.
 */
export const whoopConnection = pgTable('whoop_connection', {
  id: text('id').primaryKey(),
  status: text('status').$type<WhoopStatus>().notNull().default('disconnected'),
  whoopUserId: text('whoop_user_id'),
  /** base64 of iv || tag || ciphertext, keyed by TOKEN_ENCRYPTION_KEY. */
  accessTokenCipher: text('access_token_cipher'),
  refreshTokenCipher: text('refresh_token_cipher'),
  /** When the access token dies. Refresh fires within five minutes of it. */
  expiresAt: at('expires_at'),
  scopes: text('scopes'),
  connectedAt: at('connected_at'),
  revokedAt: at('revoked_at'),
  lastSyncAt: at('last_sync_at'),
  /** Opaque resume point for the chunked 90 day backfill. */
  backfillCursor: text('backfill_cursor'),
  backfillDaysDone: integer('backfill_days_done').notNull().default(0),
  backfillDaysTotal: integer('backfill_days_total').notNull().default(0),
  lastError: text('last_error').$type<WhoopErrorKind>(),
  nextRetryAt: at('next_retry_at'),
  rowVersion: integer('row_version').notNull().default(0),
  updatedAt: at('updated_at').notNull(),
});

export const WHOOP_CONNECTION_ID = 'owner';

/**
 * A minted OAuth state, at least 8 characters, bound to the caller so the
 * callback knows whether to bounce to the app scheme or the web settings page.
 */
export const whoopOauthState = pgTable('whoop_oauth_state', {
  state: text('state').primaryKey(),
  principal: text('principal').$type<'device' | 'web'>().notNull(),
  deviceId: text('device_id'),
  redirect: text('redirect').notNull(),
  createdAt: at('created_at').notNull(),
  expiresAt: at('expires_at').notNull(),
  usedAt: at('used_at'),
});

/**
 * A single-use ticket the phone spends to open the start URL.
 *
 * `openAuthSessionAsync` hands the URL to the operating system's browser,
 * which cannot be given an Authorization header, so the device secret must not
 * ride the query string. The phone mints one of these with its Bearer, spends
 * it in `?t=`, and it dies sixty seconds later or on first use, whichever
 * comes first.
 */
export const whoopStartTicket = pgTable('whoop_start_ticket', {
  token: text('token').primaryKey(),
  deviceId: text('device_id').notNull(),
  createdAt: at('created_at').notNull(),
  expiresAt: at('expires_at').notNull(),
  usedAt: at('used_at'),
});

export const whoopCycle = pgTable(
  'whoop_cycle',
  {
    id: text('id').primaryKey(),
    scoreState: text('score_state').$type<ScoreState>().notNull(),
    startAt: text('start_at').notNull(),
    endAt: text('end_at'),
    timezoneOffset: text('timezone_offset'),
    localDate: text('local_date').notNull(),
    strain: real('strain'),
    averageHeartRate: integer('average_heart_rate'),
    kilojoule: real('kilojoule'),
    raw: jsonb('raw').$type<Json>().notNull(),
    updatedAt: at('updated_at').notNull(),
    feedSeq: feedSeq(),
  },
  (table) => [
    index('whoop_cycle_day').on(table.localDate),
    index('whoop_cycle_feed').on(table.feedSeq),
  ],
);

export const whoopRecovery = pgTable(
  'whoop_recovery',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id'),
    sleepId: text('sleep_id'),
    scoreState: text('score_state').$type<ScoreState>().notNull(),
    /**
     * Null, not false, when Whoop has not scored the recovery: a day nobody
     * knows about must not assert that the athlete is not calibrating.
     */
    userCalibrating: boolean('user_calibrating'),
    recoveryScore: integer('recovery_score'),
    restingHeartRate: doublePrecision('resting_heart_rate'),
    hrvRmssdMilli: doublePrecision('hrv_rmssd_milli'),
    spo2Percentage: doublePrecision('spo2_percentage'),
    skinTempCelsius: doublePrecision('skin_temp_celsius'),
    timezoneOffset: text('timezone_offset'),
    localDate: text('local_date').notNull(),
    raw: jsonb('raw').$type<Json>().notNull(),
    updatedAt: at('updated_at').notNull(),
    feedSeq: feedSeq(),
  },
  (table) => [
    index('whoop_recovery_day').on(table.localDate),
    index('whoop_recovery_sleep').on(table.sleepId),
    index('whoop_recovery_feed').on(table.feedSeq),
  ],
);

export const whoopSleep = pgTable(
  'whoop_sleep',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id'),
    scoreState: text('score_state').$type<ScoreState>().notNull(),
    nap: boolean('nap').notNull().default(false),
    startAt: text('start_at').notNull(),
    endAt: text('end_at'),
    timezoneOffset: text('timezone_offset'),
    localDate: text('local_date').notNull(),
    sleepPerformancePercentage: doublePrecision('sleep_performance_percentage'),
    sleepEfficiencyPercentage: doublePrecision('sleep_efficiency_percentage'),
    respiratoryRate: doublePrecision('respiratory_rate'),
    totalInBedTimeMilli: integer('total_in_bed_time_milli'),
    raw: jsonb('raw').$type<Json>().notNull(),
    updatedAt: at('updated_at').notNull(),
    feedSeq: feedSeq(),
  },
  (table) => [
    index('whoop_sleep_day').on(table.localDate),
    index('whoop_sleep_feed').on(table.feedSeq),
  ],
);

export const whoopWorkout = pgTable(
  'whoop_workout',
  {
    id: text('id').primaryKey(),
    scoreState: text('score_state').$type<ScoreState>().notNull(),
    sportName: text('sport_name'),
    startAt: text('start_at').notNull(),
    endAt: text('end_at'),
    timezoneOffset: text('timezone_offset'),
    localDate: text('local_date').notNull(),
    strain: real('strain'),
    averageHeartRate: integer('average_heart_rate'),
    maxHeartRate: integer('max_heart_rate'),
    percentRecorded: doublePrecision('percent_recorded'),
    zoneDurations: jsonb('zone_durations').$type<Json>(),
    raw: jsonb('raw').$type<Json>().notNull(),
    updatedAt: at('updated_at').notNull(),
    feedSeq: feedSeq(),
  },
  (table) => [
    index('whoop_workout_window').on(table.startAt),
    index('whoop_workout_feed').on(table.feedSeq),
  ],
);

/**
 * A deleted mirror leaves a tombstone so /api/mirrors can tell the phone to
 * delete its own row; without it a deletion would simply never arrive.
 */
export const whoopMirrorDeletion = pgTable(
  'whoop_mirror_deletion',
  {
    kind: text('kind').$type<'cycle' | 'recovery' | 'sleep' | 'workout'>().notNull(),
    id: text('id').notNull(),
    deletedAt: at('deleted_at').notNull(),
    feedSeq: feedSeq(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.id] }),
    index('whoop_mirror_deletion_feed').on(table.feedSeq),
  ],
);

/** One row per matched session. The phone's table, same columns. */
export const sessionWorkoutLink = pgTable(
  'session_workout_link',
  {
    sessionId: text('session_id').primaryKey(),
    whoopWorkoutId: text('whoop_workout_id').notNull(),
    matchSource: text('match_source').$type<'auto' | 'manual'>().notNull(),
    overlapS: integer('overlap_s').notNull().default(0),
    linkedAt: text('linked_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (table) => [index('session_workout_link_workout').on(table.whoopWorkoutId)],
);

/**
 * Whoop retries a webhook five times over an hour, so the trace id is the
 * dedupe key: the second delivery of the same trace is a no-op.
 */
export const webhookEvent = pgTable(
  'webhook_event',
  {
    traceId: text('trace_id').primaryKey(),
    type: text('type').notNull(),
    entityId: text('entity_id'),
    whoopUserId: text('whoop_user_id'),
    receivedAt: at('received_at').notNull(),
    processedAt: at('processed_at'),
    error: text('error'),
  },
  (table) => [index('webhook_event_received').on(table.receivedAt)],
);
