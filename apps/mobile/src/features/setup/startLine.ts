/**
 * When the program actually starts, said plainly in step 2.
 *
 * "12 weeks to 29 Nov" answers the length but not the question an athlete
 * standing in September asks, which is what day week 1 begins. Day 0 is the
 * engine's rule and nothing else: the first of the picked weekdays on or after
 * today (`programStartFor`). Pick Monday on a Saturday and the program starts
 * on the Monday, not tomorrow.
 *
 * Everything here is pure, and every date is written the way the Plan header
 * writes one ("Mon 7 Sep"), never as an ISO string in a sentence.
 */
import {
  addDays,
  diffDays,
  formatInteger,
  isLocalDate,
  programStartFor,
  programWeeks,
} from '@vert/engine';
import type { Weekday } from '@vert/engine';
import type { LocalDate } from '@/data/types';
import { formatDayDate } from './copy';

/** The cycle the owner runs, and the length step 2 offers when asked for none. */
export const DEFAULT_PROGRAM_WEEKS = 12;

/** The first training day: the first picked weekday on or after today. */
export function programStart(today: LocalDate, weekdays: readonly Weekday[]): LocalDate {
  return weekdays.length === 0 ? today : programStartFor(today, weekdays);
}

/**
 * The target date step 2 offers when the field is empty: twelve weeks of
 * training, so the last day is the day before the thirteenth week would start.
 */
export function defaultTargetDate(today: LocalDate, weekdays: readonly Weekday[]): LocalDate {
  return addDays(programStart(today, weekdays), DEFAULT_PROGRAM_WEEKS * 7 - 1);
}

export interface StartLineInput {
  readonly today: LocalDate;
  readonly weekdays: readonly Weekday[];
  /** Exactly as typed. Blank or unreadable falls back to the offered default. */
  readonly targetDate: string;
}

/**
 * "Starts Mon 7 Sep · 12 weeks to Sun 29 Nov".
 *
 * Null when the typed date is before the start, because there is no honest
 * sentence for a program that ends before it begins; the target field's own
 * refusal says that. Null too before any weekday is picked: with no picks
 * there is no day 0, and "Starts today" would be a promise the engine never
 * made.
 */
export function startAndTargetLine(input: StartLineInput): string | null {
  if (input.weekdays.length === 0) return null;
  const start = programStart(input.today, input.weekdays);
  const typed = input.targetDate.trim();
  const target = isLocalDate(typed) ? typed : defaultTargetDate(input.today, input.weekdays);
  if (diffDays(start, target) < 0) return null;
  const weeks = programWeeks(start, target);
  return [
    `Starts ${formatDayDate(start)}`,
    ` · ${formatInteger(weeks)} weeks to ${formatDayDate(target)}`,
  ].join('');
}

/** "Use Sun 29 Nov": the label on the control that fills the empty field. */
export function defaultTargetLabel(today: LocalDate, weekdays: readonly Weekday[]): string {
  return `Use ${formatDayDate(defaultTargetDate(today, weekdays))}`;
}
