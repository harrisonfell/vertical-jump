/**
 * A window on the 24-hour clock, typed as two "HH:MM" strings.
 *
 * The wall (step 1) and the gym (step 2 and Settings) are both windows of this
 * shape, and the engine reads them the same way: `SessionWindow` for the gym,
 * `typicalStart` and `typicalEnd` on `WallWork` for the wall. The refusals are
 * written once here so every field that asks for a time says the same thing.
 *
 * Pure: strings in, errors or a window out, and every field is kept exactly as
 * typed so a refusal never clears what the athlete wrote.
 */
import type { SessionWindow } from '@vert/engine';

/** A 24-hour clock time, which is the only shape a window reads in. */
export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export const CLOCK_SHAPE_LINE = 'Use a 24-hour time, for example 18:00.';
export const CLOCK_BOTH_LINE = 'Enter both times, or leave both blank.';
export const CLOCK_ORDER_LINE = 'The end time has to be after the start.';

export interface ClockWindowErrors {
  readonly start?: string;
  readonly end?: string;
}

/**
 * Every refusal a typed window carries. Two blank fields carry none: not
 * naming a window is an answer.
 */
export function validateClockWindow(startText: string, endText: string): ClockWindowErrors {
  const start = startText.trim();
  const end = endText.trim();
  const errors: { start?: string; end?: string } = {};

  if (start !== '' && !CLOCK.test(start)) errors.start = CLOCK_SHAPE_LINE;
  if (end !== '' && !CLOCK.test(end)) errors.end = CLOCK_SHAPE_LINE;
  if (errors.start === undefined && errors.end === undefined) {
    if (start === '' && end !== '') errors.start = CLOCK_BOTH_LINE;
    if (end === '' && start !== '') errors.end = CLOCK_BOTH_LINE;
    if (start !== '' && end !== '' && end <= start) errors.end = CLOCK_ORDER_LINE;
  }
  return errors;
}

/** The window the engine reads, or null unless both times are clock times. */
export function clockWindowFrom(startText: string, endText: string): SessionWindow | null {
  const start = startText.trim();
  const end = endText.trim();
  if (!CLOCK.test(start) || !CLOCK.test(end)) return null;
  return { start, end };
}

/** "08:00 to 10:00", or "not set" when the athlete named no window. */
export function clockWindowLabel(start: string, end: string): string {
  return start.trim() === '' || end.trim() === '' ? 'not set' : `${start.trim()} to ${end.trim()}`;
}
