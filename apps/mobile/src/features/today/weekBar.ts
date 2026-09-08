import { formatInteger } from '@vert/engine/units';
import type { LocalDate, SessionStatus } from '@/data/types';

/**
 * The week, as one segment per training day.
 *
 * The count of segments is the count of sessions the program scheduled for
 * this week, never seven and never a percentage: a four-day week is four
 * marks, and "3 of 4" is a sentence the athlete can act on in a way that "75%"
 * is not. Rest days are not segments, because a rest day is not something to
 * complete.
 *
 * Pure, so the counting can be tested without a database or a renderer.
 */

export interface WeekDay {
  readonly scheduledDate: LocalDate;
  readonly status: SessionStatus;
}

export interface WeekSegment {
  readonly key: string;
  /** True once the day was finished. A day part-logged is not a day done. */
  readonly filled: boolean;
}

export interface WeekBarModel {
  readonly segments: readonly WeekSegment[];
  /** "3 of 4 sessions done". Empty-safe: null when there is nothing to say. */
  readonly line: string | null;
  readonly accessibilityLabel: string;
}

/** Only a finished session fills its segment. */
function isDone(status: SessionStatus): boolean {
  return status === 'done';
}

export function weekBarModel(
  sessions: readonly WeekDay[],
  weekNumber: number | null,
): WeekBarModel {
  const ordered = [...sessions].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const segments = ordered.map((session) => ({
    key: session.scheduledDate,
    filled: isDone(session.status),
  }));
  const done = segments.filter((segment) => segment.filled).length;
  const week = weekNumber === null ? '' : `Week ${formatInteger(weekNumber)}: `;

  if (segments.length === 0) {
    return { segments, line: null, accessibilityLabel: 'No sessions scheduled this week' };
  }

  const line = `${week}${formatInteger(done)} of ${formatInteger(segments.length)} sessions done`;
  return { segments, line, accessibilityLabel: line };
}
