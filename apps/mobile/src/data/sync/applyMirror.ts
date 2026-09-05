/**
 * One mirror change, folded into the phone's own copy.
 *
 * Split out of the run loop because it is a different job: the loop decides
 * what to ask for and where the feed left off, this decides what a row means.
 * Nothing here talks to the network.
 */

import type { SqlExecutor } from '../executor';
import {
  deleteWhoopWorkout,
  upsertWhoopCycle,
  upsertWhoopRecovery,
  upsertWhoopSleep,
  upsertWhoopWorkout,
} from '../store/whoopMirrors';
import type { MirrorChange } from './apiContract';

/** Mirror tables by kind, for the three that have no repository delete. */
const MIRROR_TABLE: Readonly<Record<MirrorChange['kind'], string>> = {
  cycle: 'whoop_cycle',
  recovery: 'whoop_recovery',
  sleep: 'whoop_sleep',
  workout: 'whoop_workout',
};

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function numeric(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scoreStateOf(row: Record<string, unknown>): 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE' {
  const value = row['scoreState'];
  return value === 'SCORED' || value === 'UNSCORABLE' ? value : 'PENDING_SCORE';
}

/**
 * Applies one mirror change. A deletion arrives as `deleted: true` with a null
 * row; a workout deletion also drops its session link, because a session
 * pointing at a workout that no longer exists would render an empty evidence
 * line forever.
 */
export async function applyMirror(db: SqlExecutor, change: MirrorChange): Promise<boolean> {
  if (change.deleted || change.row === null) {
    if (change.kind === 'workout') {
      await deleteWhoopWorkout(db, change.id);
      return true;
    }
    await db.runAsync(`DELETE FROM ${MIRROR_TABLE[change.kind]} WHERE id = ?`, [change.id]);
    return true;
  }

  const row = change.row as unknown as Record<string, unknown>;
  const localDate = text(row, 'localDate');
  if (localDate === null) return false;
  const base = {
    id: change.id,
    scoreState: scoreStateOf(row),
    timezoneOffset: text(row, 'timezoneOffset'),
    localDate,
    raw: row['raw'] ?? null,
  };

  if (change.kind === 'cycle') {
    const startAt = text(row, 'startAt');
    if (startAt === null) return false;
    await upsertWhoopCycle(db, {
      ...base,
      startAt,
      endAt: text(row, 'endAt'),
      strain: numeric(row, 'strain'),
      averageHeartRate: numeric(row, 'averageHeartRate'),
      kilojoule: numeric(row, 'kilojoule'),
    });
    return true;
  }

  if (change.kind === 'recovery') {
    await upsertWhoopRecovery(db, {
      ...base,
      cycleId: text(row, 'cycleId'),
      sleepId: text(row, 'sleepId'),
      userCalibrating: row['userCalibrating'] === true,
      recoveryScore: numeric(row, 'recoveryScore'),
      restingHeartRate: numeric(row, 'restingHeartRate'),
      hrvRmssdMilli: numeric(row, 'hrvRmssdMilli'),
      spo2Percentage: numeric(row, 'spo2Percentage'),
      skinTempCelsius: numeric(row, 'skinTempCelsius'),
    });
    return true;
  }

  if (change.kind === 'sleep') {
    const startAt = text(row, 'startAt');
    if (startAt === null) return false;
    await upsertWhoopSleep(db, {
      ...base,
      cycleId: text(row, 'cycleId'),
      nap: row['nap'] === true,
      startAt,
      endAt: text(row, 'endAt'),
      sleepPerformancePercentage: numeric(row, 'sleepPerformancePercentage'),
      sleepEfficiencyPercentage: numeric(row, 'sleepEfficiencyPercentage'),
      respiratoryRate: numeric(row, 'respiratoryRate'),
      totalInBedTimeMilli: numeric(row, 'totalInBedTimeMilli'),
    });
    return true;
  }

  const startAt = text(row, 'startAt');
  if (startAt === null) return false;
  await upsertWhoopWorkout(db, {
    ...base,
    sportName: text(row, 'sportName'),
    startAt,
    endAt: text(row, 'endAt'),
    strain: numeric(row, 'strain'),
    averageHeartRate: numeric(row, 'averageHeartRate'),
    maxHeartRate: numeric(row, 'maxHeartRate'),
    percentRecorded: numeric(row, 'percentRecorded'),
    zoneDurations: row['zoneDurations'] ?? null,
  });
  return true;
}
