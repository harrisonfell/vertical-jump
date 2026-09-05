import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useDbOrNull, useToday } from '../db';
import { addDays } from '../../lib/localDay';
import type { LocalDate, ScoreState } from '../types';
import { getRecoveryForDay } from '../store/whoop';

/**
 * The numbers the Today strip shows, in one read.
 *
 * Recovery is this morning's, sleep is last night's, and strain is today's
 * with yesterday's kept beside it, because today's is still accumulating and a
 * 4.1 at ten in the morning means nothing on its own.
 *
 * Nothing is turned into a zero. Each metric comes back with the state the
 * mirror is actually in: scored, pending (the cycle is there and Whoop has not
 * scored it), or missing (there is no cycle for the day at all). The strip
 * says which, rather than hiding the row.
 */

/** What the mirror holds for one metric on one day. */
export type ReadingState = 'scored' | 'pending' | 'missing';

export interface WhoopStripDay {
  readonly recoveryScore: number | null;
  readonly recoveryState: ReadingState;
  /** Hours asleep last night. The fact an athlete acts on most directly. */
  readonly sleepHours: number | null;
  readonly sleepPerformance: number | null;
  readonly sleepState: ReadingState;
  /** Today's day strain so far. */
  readonly strainToday: number | null;
  readonly strainYesterday: number | null;
  readonly strainState: ReadingState;
  readonly lastSyncAt: string | null;
}

interface SleepRow {
  readonly score_state: ScoreState;
  readonly sleep_performance_percentage: number | null;
  readonly total_in_bed_time_milli: number | null;
  readonly raw: string | null;
}

/** Whoop reports sleep in milliseconds; the strip reads it in hours. */
export function sleepHoursOf(milliseconds: number | null): number | null {
  if (milliseconds === null || milliseconds <= 0) return null;
  return Math.round(milliseconds / 360_000) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Time awake in bed, when the mirror kept it.
 *
 * Whoop's own stage summary carries `total_awake_time_milli`; the columns the
 * mirror promotes do not, so it is read back off the stored record and treated
 * as zero when the record has none. Time in bed minus time awake is time
 * asleep, which is what "hours slept" means.
 */
export function awakeMilliOf(raw: string | null): number {
  if (raw === null) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return 0;
    const score = parsed['score'];
    if (!isRecord(score)) return 0;
    const summary = score['stage_summary'];
    const source = isRecord(summary) ? summary : score;
    const awake = source['total_awake_time_milli'];
    return typeof awake === 'number' && Number.isFinite(awake) && awake > 0 ? awake : 0;
  } catch {
    return 0;
  }
}

/** Hours asleep: in bed, less the time awake the record admits to. */
export function sleptHoursOf(inBedMilli: number | null, raw: string | null): number | null {
  if (inBedMilli === null || inBedMilli <= 0) return null;
  return sleepHoursOf(Math.max(0, inBedMilli - awakeMilliOf(raw)));
}

interface CycleRow {
  readonly score_state: ScoreState;
  readonly strain: number | null;
}

/** No row at all is a gap; a row Whoop has not scored is a pending score. */
function stateOf(row: { readonly score_state: ScoreState } | null): ReadingState {
  if (row === null) return 'missing';
  return row.score_state === 'SCORED' ? 'scored' : 'pending';
}

const EMPTY: WhoopStripDay = {
  recoveryScore: null,
  recoveryState: 'missing',
  sleepHours: null,
  sleepPerformance: null,
  sleepState: 'missing',
  strainToday: null,
  strainYesterday: null,
  strainState: 'missing',
  lastSyncAt: null,
};

export function useWhoopStrip(day?: LocalDate): UseQueryResult<WhoopStripDay> {
  const db = useDbOrNull();
  const today = useToday();
  const target = day ?? today;

  return useQuery({
    queryKey: ['whoop', 'strip', target],
    enabled: db !== null,
    queryFn: async (): Promise<WhoopStripDay> => {
      if (db === null) return EMPTY;

      const recovery = await getRecoveryForDay(db, target);
      const sleep = await db.getFirstAsync<SleepRow>(
        `SELECT score_state, sleep_performance_percentage, total_in_bed_time_milli, raw
           FROM whoop_sleep WHERE local_date = ? AND nap = 0 ORDER BY start_at DESC LIMIT 1`,
        [target],
      );
      const cycleSql = `SELECT score_state, strain FROM whoop_cycle
           WHERE local_date = ? ORDER BY start_at DESC LIMIT 1`;
      const cycle = await db.getFirstAsync<CycleRow>(cycleSql, [target]);
      const yesterday = await db.getFirstAsync<CycleRow>(cycleSql, [addDays(target, -1)]);

      const scored = recovery !== null && recovery.scoreState === 'SCORED';
      const sleepScored = sleep !== null && sleep.score_state === 'SCORED';

      return {
        recoveryScore: scored ? recovery.recoveryScore : null,
        recoveryState:
          recovery === null ? 'missing' : recovery.scoreState === 'SCORED' ? 'scored' : 'pending',
        sleepHours: sleepScored ? sleptHoursOf(sleep.total_in_bed_time_milli, sleep.raw) : null,
        sleepPerformance: sleepScored ? sleep.sleep_performance_percentage : null,
        sleepState: stateOf(sleep),
        strainToday: cycle !== null && cycle.score_state === 'SCORED' ? cycle.strain : null,
        strainYesterday:
          yesterday !== null && yesterday.score_state === 'SCORED' ? yesterday.strain : null,
        strainState: stateOf(cycle),
        lastSyncAt: recovery?.updatedAt ?? null,
      };
    },
  });
}
