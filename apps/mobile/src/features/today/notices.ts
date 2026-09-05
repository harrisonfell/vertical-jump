import { RULESET_V1, sorenessNotice, testDeferredNotice, weekdayLabelOf } from '@vert/engine';
import { formatInteger } from '@vert/engine/units';
import { weekdayOf } from '../../lib/localDay';

/**
 * The notices a session grows after it was generated.
 *
 * Most of what Today says was decided when the week was built and is already in
 * the session's snapshot. Two things are not: the soreness answer, which
 * arrives at the top of the screen minutes before the first set, and the repeat
 * label, which belongs to the week rather than to the session. Both are built
 * from the engine's own copy so the wording matches the Plan's.
 */

export interface SorenessInput {
  readonly sorenessPre: number | null;
  readonly isTestDay: boolean;
  /** Today, so the deferred test can name the day it moves to. */
  readonly today: string;
  /**
   * This week's sessions. The test rides the next SCHEDULED session, never
   * simply tomorrow, so a sore Saturday cannot name an empty Sunday.
   */
  readonly weekSessions?: readonly { readonly scheduledDate: string }[];
}

/** True at 7 or higher: R27, read as "that workout only". */
export function isSoreEnough(value: number | null): boolean {
  return value !== null && value >= RULESET_V1.constants.soreness.threshold;
}

/** The week's earliest session after today, which is what a deferred test rides. */
export function nextScheduledDate(
  sessions: readonly { readonly scheduledDate: string }[],
  today: string,
): string | null {
  return (
    [...sessions]
      .filter((entry) => entry.scheduledDate > today)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0]?.scheduledDate ?? null
  );
}

/** Said when the week has no session left to carry the test. There is no chaining. */
export const TEST_MISSED_LINE = 'No session left this week: the test is missed.';

/**
 * "Soreness 8/10. Today one tier down: reps up, loads −10%, no depth jumps."
 * and, on a test day, "Test moved to Fri (soreness)."
 */
export function sorenessNotices({
  sorenessPre,
  isTestDay,
  today,
  weekSessions = [],
}: SorenessInput): string[] {
  if (!isSoreEnough(sorenessPre) || sorenessPre === null) return [];
  const out = [sorenessNotice(sorenessPre, RULESET_V1.constants.soreness.percentDrop)];
  if (isTestDay && RULESET_V1.constants.soreness.deferTest) {
    const moved = nextScheduledDate(weekSessions, today);
    out.push(
      moved === null
        ? TEST_MISSED_LINE
        : testDeferredNotice(weekdayLabelOf(moved, weekdayOf(moved))),
    );
  }
  return out;
}

/** "Repeat of week 7: same loads, same sets." */
export function repeatNotice(repeatOfWeek: number | null): string | null {
  if (repeatOfWeek === null) return null;
  return `Repeat of week ${formatInteger(repeatOfWeek)}: same loads, same sets.`;
}

/** "Test moved from Sat", when the test rode over onto this session. */
export function testMovedFrom(
  sessions: readonly { readonly scheduledDate: string; readonly testStatus: string | null }[],
  today: string,
): string | null {
  const deferred = sessions
    .filter((entry) => entry.testStatus === 'deferred' && entry.scheduledDate < today)
    .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))[0];
  if (deferred === undefined) return null;
  return weekdayLabelOf(deferred.scheduledDate, weekdayOf(deferred.scheduledDate));
}
