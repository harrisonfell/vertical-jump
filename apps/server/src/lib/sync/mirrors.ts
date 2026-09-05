/**
 * The mirror feed: everything Whoop has told us that the phone has not read.
 *
 * Four tables and a tombstone table, merged into one page ordered by
 * `feed_seq`, a number handed out by one sequence shared across all five. That
 * number is the write order, so a cursor is exact: a row written between two
 * pages is never skipped and never sent twice.
 *
 * The feed used to page on `(updated_at, kind, id)`. A Whoop sync chunk stamps
 * every page of a collection with the same instant and Whoop returns records
 * newest first, so a cursor that landed inside page one could never reach page
 * two's lower ids: those rows were invisible to that client for ever. The
 * record's own timestamps cannot order a feed, because they are not the order
 * the rows were written in.
 *
 * A deletion travels as `deleted: true` with a null row, so the phone drops its
 * own copy rather than keeping a record Whoop no longer has.
 */

import { and, asc, gt, inArray, type SQL } from 'drizzle-orm';
import { type Json, type MirrorChange, type MirrorKind } from '../api-contract';
import type { Database } from '../../db/client';
import {
  whoopCycle,
  whoopMirrorDeletion,
  whoopRecovery,
  whoopSleep,
  whoopWorkout,
} from '../../db/tables/whoop';
import { decodeCursor, encodeCursor } from './cursor';

export interface MirrorsPage {
  readonly rows: MirrorChange[];
  readonly next: string | null;
}

export interface MirrorsRequest {
  readonly since: Date | null;
  readonly kinds: readonly MirrorKind[];
  readonly limit: number;
  readonly cursor: string | null;
}

/** One row's place in the merged order, kept beside the change it carries. */
interface Entry {
  readonly seq: number;
  readonly change: MirrorChange;
}

/** The feed position a cursor carries, or null when it is not one of ours. */
function readPosition(cursor: string | null): number | null {
  const parts = decodeCursor(cursor, 1);
  if (parts === null) return null;
  const seq = Number(parts[0]);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}

function iso(value: Date): string {
  return value.toISOString();
}

export async function mirrorsSince(db: Database, request: MirrorsRequest): Promise<MirrorsPage> {
  const position = readPosition(request.cursor);
  const wanted = new Set(request.kinds);
  const take = request.limit + 1;
  const entries: Entry[] = [];

  /* Each table spells its own window, because drizzle types a column to its table. */

  if (wanted.has('cycle')) {
    const bounds: (SQL | undefined)[] = [
      position === null ? undefined : gt(whoopCycle.feedSeq, position),
      request.since === null ? undefined : gt(whoopCycle.updatedAt, request.since),
    ];
    const rows = await db
      .select()
      .from(whoopCycle)
      .where(and(...bounds))
      .orderBy(asc(whoopCycle.feedSeq))
      .limit(take);
    for (const row of rows) {
      entries.push({
        seq: row.feedSeq,
        change: {
          kind: 'cycle',
          id: row.id,
          updatedAt: iso(row.updatedAt),
          deleted: false,
          row: {
            id: row.id,
            scoreState: row.scoreState,
            timezoneOffset: row.timezoneOffset,
            localDate: row.localDate,
            raw: row.raw,
            updatedAt: iso(row.updatedAt),
            startAt: row.startAt,
            endAt: row.endAt,
            strain: row.strain,
            averageHeartRate: row.averageHeartRate,
            kilojoule: row.kilojoule,
          },
        },
      });
    }
  }

  if (wanted.has('recovery')) {
    const bounds: (SQL | undefined)[] = [
      position === null ? undefined : gt(whoopRecovery.feedSeq, position),
      request.since === null ? undefined : gt(whoopRecovery.updatedAt, request.since),
    ];
    const rows = await db
      .select()
      .from(whoopRecovery)
      .where(and(...bounds))
      .orderBy(asc(whoopRecovery.feedSeq))
      .limit(take);
    for (const row of rows) {
      entries.push({
        seq: row.feedSeq,
        change: {
          kind: 'recovery',
          id: row.id,
          updatedAt: iso(row.updatedAt),
          deleted: false,
          row: {
            id: row.id,
            scoreState: row.scoreState,
            timezoneOffset: row.timezoneOffset,
            localDate: row.localDate,
            raw: row.raw,
            updatedAt: iso(row.updatedAt),
            cycleId: row.cycleId,
            sleepId: row.sleepId,
            userCalibrating: row.userCalibrating,
            recoveryScore: row.recoveryScore,
            restingHeartRate: row.restingHeartRate,
            hrvRmssdMilli: row.hrvRmssdMilli,
            spo2Percentage: row.spo2Percentage,
            skinTempCelsius: row.skinTempCelsius,
          },
        },
      });
    }
  }

  if (wanted.has('sleep')) {
    const bounds: (SQL | undefined)[] = [
      position === null ? undefined : gt(whoopSleep.feedSeq, position),
      request.since === null ? undefined : gt(whoopSleep.updatedAt, request.since),
    ];
    const rows = await db
      .select()
      .from(whoopSleep)
      .where(and(...bounds))
      .orderBy(asc(whoopSleep.feedSeq))
      .limit(take);
    for (const row of rows) {
      entries.push({
        seq: row.feedSeq,
        change: {
          kind: 'sleep',
          id: row.id,
          updatedAt: iso(row.updatedAt),
          deleted: false,
          row: {
            id: row.id,
            scoreState: row.scoreState,
            timezoneOffset: row.timezoneOffset,
            localDate: row.localDate,
            raw: row.raw,
            updatedAt: iso(row.updatedAt),
            cycleId: row.cycleId,
            nap: row.nap,
            startAt: row.startAt,
            endAt: row.endAt,
            sleepPerformancePercentage: row.sleepPerformancePercentage,
            sleepEfficiencyPercentage: row.sleepEfficiencyPercentage,
            respiratoryRate: row.respiratoryRate,
            totalInBedTimeMilli: row.totalInBedTimeMilli,
          },
        },
      });
    }
  }

  if (wanted.has('workout')) {
    const bounds: (SQL | undefined)[] = [
      position === null ? undefined : gt(whoopWorkout.feedSeq, position),
      request.since === null ? undefined : gt(whoopWorkout.updatedAt, request.since),
    ];
    const rows = await db
      .select()
      .from(whoopWorkout)
      .where(and(...bounds))
      .orderBy(asc(whoopWorkout.feedSeq))
      .limit(take);
    for (const row of rows) {
      entries.push({
        seq: row.feedSeq,
        change: {
          kind: 'workout',
          id: row.id,
          updatedAt: iso(row.updatedAt),
          deleted: false,
          row: {
            id: row.id,
            scoreState: row.scoreState,
            timezoneOffset: row.timezoneOffset,
            localDate: row.localDate,
            raw: row.raw,
            updatedAt: iso(row.updatedAt),
            sportName: row.sportName,
            startAt: row.startAt,
            endAt: row.endAt,
            strain: row.strain,
            averageHeartRate: row.averageHeartRate,
            maxHeartRate: row.maxHeartRate,
            percentRecorded: row.percentRecorded,
            zoneDurations: row.zoneDurations as Json,
          },
        },
      });
    }
  }

  const kinds = [...wanted];
  if (kinds.length > 0) {
    const bounds: (SQL | undefined)[] = [
      inArray(whoopMirrorDeletion.kind, kinds),
      position === null ? undefined : gt(whoopMirrorDeletion.feedSeq, position),
      request.since === null ? undefined : gt(whoopMirrorDeletion.deletedAt, request.since),
    ];
    const rows = await db
      .select()
      .from(whoopMirrorDeletion)
      .where(and(...bounds))
      .orderBy(asc(whoopMirrorDeletion.feedSeq))
      .limit(take);
    for (const row of rows) {
      entries.push({
        seq: row.feedSeq,
        change: {
          kind: row.kind,
          id: row.id,
          updatedAt: iso(row.deletedAt),
          deleted: true,
          row: null,
        },
      });
    }
  }

  entries.sort((left, right) => left.seq - right.seq);

  const page = entries.slice(0, request.limit);
  const last = page[page.length - 1];

  // The last row's position, on every page that has rows, the last one
  // included. It used to be minted only while a page was full, so a feed that
  // fitted inside one page named no position at all and the phone had nothing
  // to persist: it asked for the same rows again on every run and re-applied
  // them for ever. The cursor is the row's `feed_seq` and no row on the wire
  // carries it, so the phone cannot mint one for itself. Null now means only
  // that the page was empty.
  const next = last === undefined ? null : encodeCursor([String(last.seq)]);

  return { rows: page.map((entry) => entry.change), next };
}
