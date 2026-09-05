/**
 * Writing the four Whoop mirrors.
 *
 * Every write is an upsert, because Whoop sends creates as "updated" and
 * because a re-sync of the same window must not double anything. A row keeps
 * its raw JSON beside the fields we read, so a schema surprise is a re-parse
 * rather than a re-sync, and an unscored field stays null instead of becoming
 * a zero.
 *
 * A deletion also writes a tombstone, because /api/mirrors is a feed of
 * changes: without one, a deleted recovery would simply never reach the phone.
 *
 * Every write takes the next number from one shared sequence. That number, not
 * the record's own `updated_at`, is what /api/mirrors pages on, so a row
 * written between two pages is never skipped and never sent twice however the
 * timestamps fall.
 */

import { and, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  nextFeedSeq,
  sessionWorkoutLink,
  whoopCycle,
  whoopMirrorDeletion,
  whoopRecovery,
  whoopSleep,
  whoopWorkout,
} from '../../db/tables/whoop';
import type {
  MirrorKind,
  WhoopCycleRow,
  WhoopRecoveryRow,
  WhoopSleepRow,
  WhoopWorkoutRow,
} from '../api-contract';

/* ------------------------------------------------------- recovery dates */

/**
 * A recovery's own local date, borrowed from the cycle it belongs to.
 *
 * The v2 Recovery model has no `timezone_offset`, so deriving its local date
 * from `created_at` alone filed a recovery created before 04:00 local at -04:00
 * on the following day, while the cycle it belongs to filed itself on the right
 * one. The two mirrors then disagreed about the same physiological day and the
 * readiness match read the wrong recovery. The cycle is the authority; a sleep
 * is the fallback while the cycle has not arrived yet.
 */
async function borrowedDates(
  db: Database,
  rows: readonly WhoopRecoveryRow[],
): Promise<Map<string, { timezoneOffset: string | null; localDate: string }>> {
  const found = new Map<string, { timezoneOffset: string | null; localDate: string }>();

  const cycleIds = [...new Set(rows.map((row) => row.cycleId).filter((id): id is string => id !== null))];
  if (cycleIds.length > 0) {
    const cycles = await db
      .select({ id: whoopCycle.id, timezoneOffset: whoopCycle.timezoneOffset, localDate: whoopCycle.localDate })
      .from(whoopCycle)
      .where(inArray(whoopCycle.id, cycleIds));
    for (const cycle of cycles) {
      found.set(cycle.id, { timezoneOffset: cycle.timezoneOffset, localDate: cycle.localDate });
    }
  }

  const sleepIds = [
    ...new Set(
      rows
        .filter((row) => row.cycleId === null || !found.has(row.cycleId))
        .map((row) => row.sleepId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (sleepIds.length > 0) {
    const sleeps = await db
      .select({ id: whoopSleep.id, timezoneOffset: whoopSleep.timezoneOffset, localDate: whoopSleep.localDate })
      .from(whoopSleep)
      .where(inArray(whoopSleep.id, sleepIds));
    for (const sleep of sleeps) {
      found.set(`sleep:${sleep.id}`, { timezoneOffset: sleep.timezoneOffset, localDate: sleep.localDate });
    }
  }

  return found;
}

function withBorrowedDate(
  row: WhoopRecoveryRow,
  found: Map<string, { timezoneOffset: string | null; localDate: string }>,
): WhoopRecoveryRow {
  const borrowed =
    (row.cycleId === null ? undefined : found.get(row.cycleId)) ??
    (row.sleepId === null ? undefined : found.get(`sleep:${row.sleepId}`));
  if (borrowed === undefined) return row;
  return { ...row, timezoneOffset: borrowed.timezoneOffset, localDate: borrowed.localDate };
}

/**
 * A cycle has just landed, so any recovery that was filed against a UTC guess
 * moves onto the day the cycle says it belongs to. This is what makes the order
 * of the backfill (cycles, then sleeps, then recoveries) not matter.
 */
async function realignRecoveries(db: Database, cycleIds: readonly string[]): Promise<void> {
  if (cycleIds.length === 0) return;
  const cycles = await db
    .select({ id: whoopCycle.id, timezoneOffset: whoopCycle.timezoneOffset, localDate: whoopCycle.localDate })
    .from(whoopCycle)
    .where(inArray(whoopCycle.id, [...cycleIds]));

  for (const cycle of cycles) {
    const stale =
      cycle.timezoneOffset === null
        ? ne(whoopRecovery.localDate, cycle.localDate)
        : or(
            isNull(whoopRecovery.timezoneOffset),
            ne(whoopRecovery.timezoneOffset, cycle.timezoneOffset),
            ne(whoopRecovery.localDate, cycle.localDate),
          );
    await db
      .update(whoopRecovery)
      .set({
        timezoneOffset: cycle.timezoneOffset,
        localDate: cycle.localDate,
        feedSeq: nextFeedSeq,
      })
      .where(and(eq(whoopRecovery.cycleId, cycle.id), stale));
  }
}

/* --------------------------------------------------------------- upserts */

export async function upsertCycles(db: Database, rows: readonly WhoopCycleRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(whoopCycle)
    .values(
      rows.map((row) => ({
        id: row.id,
        scoreState: row.scoreState,
        startAt: row.startAt,
        endAt: row.endAt,
        timezoneOffset: row.timezoneOffset,
        localDate: row.localDate,
        strain: row.strain,
        averageHeartRate: row.averageHeartRate === null ? null : Math.round(row.averageHeartRate),
        kilojoule: row.kilojoule,
        raw: row.raw,
        updatedAt: new Date(row.updatedAt),
      })),
    )
    .onConflictDoUpdate({
      target: whoopCycle.id,
      set: {
        scoreState: sql`excluded.score_state`,
        startAt: sql`excluded.start_at`,
        endAt: sql`excluded.end_at`,
        timezoneOffset: sql`excluded.timezone_offset`,
        localDate: sql`excluded.local_date`,
        strain: sql`excluded.strain`,
        averageHeartRate: sql`excluded.average_heart_rate`,
        kilojoule: sql`excluded.kilojoule`,
        raw: sql`excluded.raw`,
        updatedAt: sql`excluded.updated_at`,
        feedSeq: nextFeedSeq,
      },
    });
  await realignRecoveries(db, rows.map((row) => row.id));
  return rows.length;
}

export async function upsertRecoveries(
  db: Database,
  input: readonly WhoopRecoveryRow[],
): Promise<number> {
  if (input.length === 0) return 0;
  const borrowed = await borrowedDates(db, input);
  const rows = input.map((row) => withBorrowedDate(row, borrowed));
  await db
    .insert(whoopRecovery)
    .values(
      rows.map((row) => ({
        id: row.id,
        cycleId: row.cycleId,
        sleepId: row.sleepId,
        scoreState: row.scoreState,
        userCalibrating: row.userCalibrating,
        recoveryScore: row.recoveryScore === null ? null : Math.round(row.recoveryScore),
        restingHeartRate: row.restingHeartRate,
        hrvRmssdMilli: row.hrvRmssdMilli,
        spo2Percentage: row.spo2Percentage,
        skinTempCelsius: row.skinTempCelsius,
        timezoneOffset: row.timezoneOffset,
        localDate: row.localDate,
        raw: row.raw,
        updatedAt: new Date(row.updatedAt),
      })),
    )
    .onConflictDoUpdate({
      target: whoopRecovery.id,
      set: {
        cycleId: sql`excluded.cycle_id`,
        sleepId: sql`excluded.sleep_id`,
        scoreState: sql`excluded.score_state`,
        userCalibrating: sql`excluded.user_calibrating`,
        recoveryScore: sql`excluded.recovery_score`,
        restingHeartRate: sql`excluded.resting_heart_rate`,
        hrvRmssdMilli: sql`excluded.hrv_rmssd_milli`,
        spo2Percentage: sql`excluded.spo2_percentage`,
        skinTempCelsius: sql`excluded.skin_temp_celsius`,
        timezoneOffset: sql`excluded.timezone_offset`,
        localDate: sql`excluded.local_date`,
        raw: sql`excluded.raw`,
        updatedAt: sql`excluded.updated_at`,
        feedSeq: nextFeedSeq,
      },
    });
  return rows.length;
}

export async function upsertSleeps(db: Database, rows: readonly WhoopSleepRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(whoopSleep)
    .values(
      rows.map((row) => ({
        id: row.id,
        cycleId: row.cycleId,
        scoreState: row.scoreState,
        nap: row.nap,
        startAt: row.startAt,
        endAt: row.endAt,
        timezoneOffset: row.timezoneOffset,
        localDate: row.localDate,
        sleepPerformancePercentage: row.sleepPerformancePercentage,
        sleepEfficiencyPercentage: row.sleepEfficiencyPercentage,
        respiratoryRate: row.respiratoryRate,
        totalInBedTimeMilli:
          row.totalInBedTimeMilli === null ? null : Math.round(row.totalInBedTimeMilli),
        raw: row.raw,
        updatedAt: new Date(row.updatedAt),
      })),
    )
    .onConflictDoUpdate({
      target: whoopSleep.id,
      set: {
        cycleId: sql`excluded.cycle_id`,
        scoreState: sql`excluded.score_state`,
        nap: sql`excluded.nap`,
        startAt: sql`excluded.start_at`,
        endAt: sql`excluded.end_at`,
        timezoneOffset: sql`excluded.timezone_offset`,
        localDate: sql`excluded.local_date`,
        sleepPerformancePercentage: sql`excluded.sleep_performance_percentage`,
        sleepEfficiencyPercentage: sql`excluded.sleep_efficiency_percentage`,
        respiratoryRate: sql`excluded.respiratory_rate`,
        totalInBedTimeMilli: sql`excluded.total_in_bed_time_milli`,
        raw: sql`excluded.raw`,
        updatedAt: sql`excluded.updated_at`,
        feedSeq: nextFeedSeq,
      },
    });
  return rows.length;
}

export async function upsertWorkouts(
  db: Database,
  rows: readonly WhoopWorkoutRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(whoopWorkout)
    .values(
      rows.map((row) => ({
        id: row.id,
        scoreState: row.scoreState,
        sportName: row.sportName,
        startAt: row.startAt,
        endAt: row.endAt,
        timezoneOffset: row.timezoneOffset,
        localDate: row.localDate,
        strain: row.strain,
        averageHeartRate: row.averageHeartRate === null ? null : Math.round(row.averageHeartRate),
        maxHeartRate: row.maxHeartRate === null ? null : Math.round(row.maxHeartRate),
        percentRecorded: row.percentRecorded,
        zoneDurations: row.zoneDurations,
        raw: row.raw,
        updatedAt: new Date(row.updatedAt),
      })),
    )
    .onConflictDoUpdate({
      target: whoopWorkout.id,
      set: {
        scoreState: sql`excluded.score_state`,
        sportName: sql`excluded.sport_name`,
        startAt: sql`excluded.start_at`,
        endAt: sql`excluded.end_at`,
        timezoneOffset: sql`excluded.timezone_offset`,
        localDate: sql`excluded.local_date`,
        strain: sql`excluded.strain`,
        averageHeartRate: sql`excluded.average_heart_rate`,
        maxHeartRate: sql`excluded.max_heart_rate`,
        percentRecorded: sql`excluded.percent_recorded`,
        zoneDurations: sql`excluded.zone_durations`,
        raw: sql`excluded.raw`,
        updatedAt: sql`excluded.updated_at`,
        feedSeq: nextFeedSeq,
      },
    });
  return rows.length;
}

/* -------------------------------------------------------------- removals */

/** The tombstone a deletion leaves, so /api/mirrors can carry it to the phone. */
export async function writeTombstone(
  db: Database,
  kind: MirrorKind,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .insert(whoopMirrorDeletion)
    .values({ kind, id, deletedAt: now })
    .onConflictDoUpdate({
      target: [whoopMirrorDeletion.kind, whoopMirrorDeletion.id],
      set: { deletedAt: now, feedSeq: nextFeedSeq },
    });
}

/**
 * Removes one mirror row and records the tombstone. A deleted workout also
 * loses its session link: a session must never keep strain that Whoop has
 * taken back.
 */
export async function deleteMirror(
  db: Database,
  kind: MirrorKind,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  let deleted = 0;
  if (kind === 'cycle') {
    deleted = (await db.delete(whoopCycle).where(eq(whoopCycle.id, id)).returning({ id: whoopCycle.id })).length;
  } else if (kind === 'recovery') {
    // A recovery webhook names the sleep, and the mirror is keyed on the
    // cycle, so a deletion has to be able to find the row either way.
    const gone = await db
      .delete(whoopRecovery)
      .where(or(eq(whoopRecovery.id, id), eq(whoopRecovery.sleepId, id)))
      .returning({ id: whoopRecovery.id });
    deleted = gone.length;
    for (const row of gone) {
      if (row.id !== id) await writeTombstone(db, kind, row.id, now);
    }
  } else if (kind === 'sleep') {
    deleted = (await db.delete(whoopSleep).where(eq(whoopSleep.id, id)).returning({ id: whoopSleep.id })).length;
  } else {
    deleted = (await db.delete(whoopWorkout).where(eq(whoopWorkout.id, id)).returning({ id: whoopWorkout.id })).length;
    await db.delete(sessionWorkoutLink).where(eq(sessionWorkoutLink.whoopWorkoutId, id));
  }
  await writeTombstone(db, kind, id, now);
  return deleted > 0;
}

/** Everything Whoop ever sent, gone, with a tombstone for every row. */
export async function deleteAllMirrors(
  db: Database,
  now: Date = new Date(),
): Promise<{ cycles: number; recoveries: number; sleeps: number; workouts: number }> {
  const cycles = await db.delete(whoopCycle).returning({ id: whoopCycle.id });
  const recoveries = await db.delete(whoopRecovery).returning({ id: whoopRecovery.id });
  const sleeps = await db.delete(whoopSleep).returning({ id: whoopSleep.id });
  const workouts = await db.delete(whoopWorkout).returning({ id: whoopWorkout.id });
  await db.delete(sessionWorkoutLink);

  const tombstones = [
    ...cycles.map((row) => ({ kind: 'cycle' as const, id: row.id, deletedAt: now })),
    ...recoveries.map((row) => ({ kind: 'recovery' as const, id: row.id, deletedAt: now })),
    ...sleeps.map((row) => ({ kind: 'sleep' as const, id: row.id, deletedAt: now })),
    ...workouts.map((row) => ({ kind: 'workout' as const, id: row.id, deletedAt: now })),
  ];
  for (let index = 0; index < tombstones.length; index += 200) {
    const batch = tombstones.slice(index, index + 200);
    if (batch.length === 0) continue;
    await db
      .insert(whoopMirrorDeletion)
      .values(batch)
      .onConflictDoUpdate({
        target: [whoopMirrorDeletion.kind, whoopMirrorDeletion.id],
        set: { deletedAt: now, feedSeq: nextFeedSeq },
      });
  }

  return {
    cycles: cycles.length,
    recoveries: recoveries.length,
    sleeps: sleeps.length,
    workouts: workouts.length,
  };
}

/* ------------------------------------------------------------- progress */

/**
 * How many days of the window actually arrived, counted as distinct local
 * dates on the cycles. Pending days stay gaps; the counter never rounds a hole
 * up into a day that was never imported.
 */
export async function countImportedDays(db: Database, sinceLocalDate: string): Promise<number> {
  const rows = await db
    .select({ days: sql<string>`count(distinct ${whoopCycle.localDate})` })
    .from(whoopCycle)
    .where(gte(whoopCycle.localDate, sinceLocalDate));
  const days = Number(rows[0]?.days ?? 0);
  return Number.isFinite(days) ? days : 0;
}

/** The sleep a recovery webhook names, so its cycle can be resolved locally. */
export async function findSleepCycleId(db: Database, sleepId: string): Promise<string | null> {
  const rows = await db
    .select({ cycleId: whoopSleep.cycleId })
    .from(whoopSleep)
    .where(and(eq(whoopSleep.id, sleepId)));
  return rows[0]?.cycleId ?? null;
}
