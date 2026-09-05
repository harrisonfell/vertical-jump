import { joinParts } from '@vert/engine/analytics';
import type { DaysPerWeek, Json, LocalDate } from '@/data/types';
import { formatDayDate, formatDayMonth } from './dates';

/**
 * The Plan's first line and its version note.
 *
 * Training age is shown as the answer the athlete gave, never as the level the
 * engine derived from it (brief section 13 "Vocabulary"): the owner picked
 * "4+ years", so the header says "4+ yrs" and the word "advanced" appears
 * nowhere on the screen.
 */

/**
 * The sport, as a word rather than as the engine's key.
 *
 * The sport decides which house rules run, so the Plan says it out loud: the
 * `house.sc.*` rules below only make sense once the header has named the sport
 * they belong to. "None / General athlete" carries no sport rule and so is not
 * shown; an unknown key is dropped rather than printed raw.
 */
const SPORT_LABELS: Readonly<Record<string, string>> = {
  basketball: 'Basketball',
  football: 'Football',
  soccer: 'Soccer',
  track_field: 'Track & Field',
  volleyball: 'Volleyball',
  baseball: 'Baseball',
  speed_climbing: 'Speed climbing',
};

export function sportLabel(sport: string | null): string | null {
  if (sport === null) return null;
  return SPORT_LABELS[sport] ?? null;
}

/** The onboarding answers, abbreviated to header width. */
export function trainingAgeLabel(years: number | null): string | null {
  if (years === null) return null;
  if (years < 0.5) return 'None';
  if (years < 1) return 'Under 1 yr';
  if (years < 4) return '1-3 yrs';
  return '4+ yrs';
}

export interface ProgramHeaderInput {
  /** Program length in weeks, W. */
  readonly weeks: number;
  readonly daysPerWeek: DaysPerWeek | null;
  /** The engine's sport key, or null when the athlete answered none. */
  readonly sport?: string | null;
  readonly trainingAgeYears: number | null;
  readonly startDate: LocalDate;
  /** The target date: the last day of the peak week. */
  readonly endDate: LocalDate;
}

/** "12 weeks · 4 days/wk · Speed climbing · 4+ yrs · Mon 8 Sep to Sat 29 Nov". */
export function programHeaderLine(input: ProgramHeaderInput): string {
  const span = `${formatDayDate(input.startDate)} to ${formatDayDate(input.endDate)}`;
  return joinParts([
    `${input.weeks} weeks`,
    input.daysPerWeek === null ? null : `${input.daysPerWeek} days/wk`,
    sportLabel(input.sport ?? null),
    trainingAgeLabel(input.trainingAgeYears),
    span,
  ]);
}

/** "Week 7 of 12 · Power block", the sentence the sticky header carries. */
export function contextTitle(w: number, weeks: number, blockLabel: string | null): string {
  return joinParts([`Week ${w} of ${weeks}`, blockLabel === null ? null : `${blockLabel} block`]);
}

export interface VersionNoteInput {
  readonly version: number;
  readonly since: LocalDate;
  readonly reason: string | null;
}

/** "v2 since 3 Oct (target date moved)". Only shown when more than one exists. */
export function versionNote(input: VersionNoteInput): string {
  const head = `v${input.version} since ${formatDayMonth(input.since)}`;
  return input.reason === null || input.reason === '' ? head : `${head} (${input.reason})`;
}

/**
 * "12 weeks, Mon 8 Sep to Sat 29 Nov" from a stored week layout, so a past
 * version can be read without regenerating anything.
 */
export function versionSpan(weekLayout: Json): string | null {
  if (!Array.isArray(weekLayout) || weekLayout.length === 0) return null;
  const first = weekLayout[0];
  const last = weekLayout[weekLayout.length - 1];
  if (typeof first !== 'object' || first === null) return null;
  if (typeof last !== 'object' || last === null) return null;
  const start = (first as Record<string, unknown>)['windowStart'];
  const end = (last as Record<string, unknown>)['windowEnd'];
  const weeks = weekLayout.length === 1 ? '1 week' : `${weekLayout.length} weeks`;
  if (typeof start !== 'string' || typeof end !== 'string') return weeks;
  return `${weeks}, ${formatDayDate(start)} to ${formatDayDate(end)}`;
}
