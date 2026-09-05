import type { PainLocation } from '@vert/engine';
import { severePainSentence, weekdayLabelOf } from '@vert/engine';
import { formatInteger } from '@vert/engine/units';
import { formatShortDate } from '@vert/engine/analytics';
import { daysBetween, weekdayOf } from '../../lib/localDay';

/**
 * The cards that appear above a session when the calendar and the body have
 * something to say: a missed workout, a long break, a pain reassessment, and
 * the one-time coach mark on the very first session.
 *
 * All plain facts, no guilt, no streaks (brief section 13). Copy that section
 * 06 or 13 states verbatim is here verbatim.
 */

/** The kv key the coach mark's dismissal is stored under. */
export const COACH_MARK_FIRST_SESSION = 'today.firstSession';

/** Fourteen days away is a break, not a lapse. */
export const REENTRY_DAYS = 14;

/** The kv key a skipped soreness question is remembered under. */
export function sorenessSkipKey(sessionId: string): string {
  return `today.soreness.skipped.${sessionId}`;
}

/**
 * The kv key a declined readiness throw is remembered under
 * (house `house.sc.readiness_gate`). A declined test is a decision, so it
 * outlives the component that asked, and the row stays on screen with whatever
 * the other channel knows.
 */
export function readinessSkipKey(sessionId: string): string {
  return `today.readiness.skipped.${sessionId}`;
}

/** A miss stays offerable for a week and a half, across the week boundary. */
export const MISSED_WINDOW_DAYS = 10;

const PAIN_LOCATIONS: readonly PainLocation[] = [
  'knee',
  'achilles_calf',
  'hamstring',
  'hip',
  'back',
  'shoulder',
  'shin',
  'other',
];

/**
 * The restricted-plan sentence, built per site from the engine's own templates.
 *
 * The exclusions differ by location (a shoulder at 5+ does not stop jumping),
 * so the copy is never allowed to name a body part the athlete did not report.
 */
export function restrictedNotice(location: string): string {
  const known = PAIN_LOCATIONS.find((entry) => entry === location);
  return severePainSentence(known ?? 'other');
}

/** "Missed Mon · Lower Strength". */
export function missedLine(date: string, dayType: string): string {
  return `Missed ${weekdayLabelOf(date, weekdayOf(date))} · ${dayType}`;
}

/** The re-entry card's one line, from brief section 06. */
export const REENTRY_LINE =
  'Repeat the last load week with working maxes −10% and contacts −25%. Normal after a break.';

export function reentryTitle(lastDate: string, today: string): string {
  const days = daysBetween(lastDate, today);
  return `${formatInteger(days)} days since your last session`;
}

/** True once the gap crosses the fourteenth day. */
export function needsReentry(lastCompletedDate: string | null, today: string): boolean {
  if (lastCompletedDate === null) return false;
  return daysBetween(lastCompletedDate, today) >= REENTRY_DAYS;
}

/** "Knee check due · Answer", the collapsed reassessment row. */
export function reassessmentRow(location: string): string {
  return `${capitalize(location)} check due`;
}

/** The full reassessment question, from brief section 13. */
export function reassessmentQuestion(
  location: string,
  onset: 'new' | 'ongoing',
  severity: string,
): string {
  return `${capitalize(
    location,
  )} check. Two weeks ago you reported ${onset}, ${severity} ${location} pain and the program ran it as moderate. How is it now?`;
}

export function reassessmentDue(reassessDueAt: string | null, today: string): boolean {
  if (reassessDueAt === null) return false;
  return daysBetween(reassessDueAt, today) >= 0;
}

/** The coach mark shown once, on the first session ever. */
export const COACH_MARK_LINES: readonly string[] = [
  'Tap a row when the set is done.',
  'Edit with the pencil beside it.',
  'Finish even if you did not get through everything.',
  'In week 1 you log the weight you use.',
];

export function sessionCounter(index: number, total: number): string {
  return `Session ${formatInteger(index)} of ${formatInteger(total)}`;
}

/** "Target date passed (29 Nov). Last test 33.5 in vs goal 36.0." */
export function targetPassedLine(targetDate: string, lastIn: string, goalIn: string): string {
  return `Target date passed (${formatShortDate(
    targetDate,
  )}). Last test ${lastIn} in vs goal ${goalIn}.`;
}

function capitalize(word: string): string {
  return word.length === 0 ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`;
}
