import { formatClock } from '@/app/syncLineText';
import type { ReadingState } from '@/data';
import type { RecoveryBand, StripSlot, StripState } from '@/ui';
import { daysBetween } from '@/lib/localDay';

/**
 * The Whoop strip's model, in every state it can honestly be in.
 *
 * Three slots, always all three: Recovery, Sleep, Strain. A slot that vanishes
 * when Whoop has nothing to say reads as a day with nothing wrong with it, so
 * every slot stays and says which of the four things is true instead: it has a
 * number, Whoop has not scored the day yet, there is no cycle for the day, or
 * the strap is not linked.
 *
 * It never gives an instruction and never turns a number into a colour on its
 * own: the band word sits beside the dot, and "Data by WHOOP" sits under the
 * row because the terms require it. A connection that has gone quiet keeps its
 * numbers on screen with the age beside them rather than blanking the row
 * (D-17).
 */

/** Whoop's own bands, at the 33 and 66 hairlines. */
export function recoveryBand(score: number): RecoveryBand {
  if (score < 34) return 'low';
  if (score < 67) return 'moderate';
  return 'high';
}

/** Two days without a sync is stale enough to say so (brief section 06). */
export const STALE_DAYS = 2;

export type { ReadingState };

export interface StripModel {
  readonly state: StripState;
  readonly slots: readonly StripSlot[];
  readonly syncedAt?: string;
  readonly staleDays?: number;
  readonly importedDays?: number;
  readonly importTotalDays?: number;
}

export interface StripInput {
  readonly connectionStatus: string | null;
  readonly backfillDaysDone: number;
  readonly backfillDaysTotal: number;
  readonly lastSyncAt: string | null;
  readonly recoveryScore: number | null;
  readonly recoveryState: ReadingState;
  readonly sleepPerformance: number | null;
  /** Hours actually asleep, as "7.2 h" under the performance percent. */
  readonly sleepHours: number | null;
  readonly sleepState: ReadingState;
  /** Today's day strain, still accumulating, which is why yesterday's is kept. */
  readonly strainToday: number | null;
  readonly strainYesterday: number | null;
  readonly strainState: ReadingState;
  readonly today: string;
}

const RECOVERY = 'Recovery';
const SLEEP = 'Sleep';
const STRAIN = 'Strain';

/** One decimal, the way Whoop writes a strain. */
export function formatStrain(value: number): string {
  return value.toFixed(1);
}

/** "7.2 h": hours asleep, to a tenth. */
export function formatSleepHours(hours: number): string {
  return `${hours.toFixed(1)} h`;
}

/** A percent, rounded the way Whoop shows one. */
function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function slotFor(
  label: string,
  reading: ReadingState,
  value: string | null,
  detail: string | null,
  band: RecoveryBand | null,
): StripSlot {
  if (reading !== 'scored' || value === null) {
    return { label, value: null, state: reading === 'pending' ? 'pending' : 'noData' };
  }
  return {
    label,
    value,
    state: 'value',
    ...(detail === null ? null : { detail }),
    ...(band === null ? null : { band }),
  };
}

/** The three slots, in their fixed order, from what the mirror holds. */
export function stripSlots(input: StripInput): StripSlot[] {
  return [
    slotFor(
      RECOVERY,
      input.recoveryState,
      input.recoveryScore === null ? null : percent(input.recoveryScore),
      null,
      input.recoveryScore === null ? null : recoveryBand(input.recoveryScore),
    ),
    slotFor(
      SLEEP,
      input.sleepState,
      input.sleepPerformance === null ? null : percent(input.sleepPerformance),
      input.sleepHours === null ? null : formatSleepHours(input.sleepHours),
      null,
    ),
    slotFor(
      STRAIN,
      input.strainState,
      input.strainToday === null ? null : formatStrain(input.strainToday),
      input.strainYesterday === null ? null : `yday ${formatStrain(input.strainYesterday)}`,
      null,
    ),
  ];
}

/** The same three labels, each saying the strap is not linked. */
function unlinkedSlots(): StripSlot[] {
  return [RECOVERY, SLEEP, STRAIN].map((label) => ({
    label,
    value: null,
    state: 'notConnected' as const,
  }));
}

export function stripModel(input: StripInput): StripModel {
  if (input.connectionStatus === 'revoked' || input.connectionStatus === 'error') {
    return { state: 'revoked', slots: unlinkedSlots() };
  }
  if (input.connectionStatus === 'connecting') {
    return {
      state: 'importing',
      slots: stripSlots(input),
      importedDays: input.backfillDaysDone,
      importTotalDays: input.backfillDaysTotal === 0 ? 90 : input.backfillDaysTotal,
    };
  }
  if (input.connectionStatus !== 'connected') {
    return { state: 'notConnected', slots: unlinkedSlots() };
  }

  const slots = stripSlots(input);

  if (input.backfillDaysTotal > 0 && input.backfillDaysDone < input.backfillDaysTotal) {
    return {
      state: 'importing',
      slots,
      importedDays: input.backfillDaysDone,
      importTotalDays: input.backfillDaysTotal,
    };
  }

  const syncDay = input.lastSyncAt === null ? null : input.lastSyncAt.slice(0, 10);
  const age = syncDay === null ? null : daysBetween(syncDay, input.today);
  if (age !== null && age >= STALE_DAYS) {
    return { state: 'stale', slots, staleDays: age };
  }

  const clock = input.lastSyncAt === null ? null : formatClock(input.lastSyncAt);
  return { state: 'connected', slots, ...(clock == null ? null : { syncedAt: clock }) };
}
