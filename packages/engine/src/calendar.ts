/**
 * LocalDate arithmetic. A LocalDate is a plain `YYYY-MM-DD` string with no
 * zone: the athlete's own day, resolved upstream by `localDay(ts, tz, hour)`.
 * Everything here is done in UTC so a daylight-saving change can never move a
 * training day. The engine never reads the clock: "today" is always a
 * parameter.
 */
import type { DateWindow, LocalDate, Weekday } from './types/calendar.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Thrown when a string is not a valid `YYYY-MM-DD` date. */
export class LocalDateError extends RangeError {
  constructor(value: string) {
    super(`not a YYYY-MM-DD local date: ${value}`);
    this.name = 'LocalDateError';
  }
}

/** Parse a LocalDate into its UTC epoch milliseconds at midnight. */
export function parseLocalDate(date: LocalDate): number {
  const match = DATE_PATTERN.exec(date);
  if (match === null) throw new LocalDateError(date);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new LocalDateError(date);
  const ms = Date.UTC(year, month - 1, day);
  const round = new Date(ms);
  if (round.getUTCFullYear() !== year || round.getUTCMonth() !== month - 1 || round.getUTCDate() !== day) {
    throw new LocalDateError(date);
  }
  return ms;
}

/** True when the string is a well-formed, real calendar date. */
export function isLocalDate(value: string): value is LocalDate {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Format UTC epoch milliseconds back into a LocalDate. */
export function formatLocalDate(ms: number): LocalDate {
  const date = new Date(ms);
  const year = `${date.getUTCFullYear()}`.padStart(4, '0');
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shift a LocalDate by a whole number of calendar days, forward or back. */
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  return formatLocalDate(parseLocalDate(date) + days * MS_PER_DAY);
}

/** 0 is Sunday through 6 is Saturday. */
export function weekdayOf(date: LocalDate): Weekday {
  return new Date(parseLocalDate(date)).getUTCDay() as Weekday;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((parseLocalDate(to) - parseLocalDate(from)) / MS_PER_DAY);
}

/** The earlier of two dates. */
export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return parseLocalDate(a) <= parseLocalDate(b) ? a : b;
}

/** The later of two dates. */
export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return parseLocalDate(a) >= parseLocalDate(b) ? a : b;
}

/** Inclusive on both ends. */
export function isWithin(date: LocalDate, window: DateWindow): boolean {
  const ms = parseLocalDate(date);
  return ms >= parseLocalDate(window.start) && ms <= parseLocalDate(window.end);
}

/** The first date on or after `from` that falls on `weekday`. */
export function nextWeekdayOnOrAfter(from: LocalDate, weekday: Weekday): LocalDate {
  const delta = (weekday - weekdayOf(from) + 7) % 7;
  return addDays(from, delta);
}

/**
 * The W calendar weeks of a program, each running day 0 to day 6 from
 * `programStart`. This is the declared deviation from the rule book's
 * floating 7-day window (brief 09 "Calendar and generation"): the adherence
 * window is the calendar week from the first chosen weekday.
 */
export function weekWindows(programStart: LocalDate, W: number): DateWindow[] {
  if (!Number.isInteger(W) || W < 1) throw new RangeError('W must be an integer of at least 1');
  const windows: DateWindow[] = [];
  for (let index = 0; index < W; index += 1) {
    const start = addDays(programStart, index * 7);
    windows.push({ start, end: addDays(start, 6) });
  }
  return windows;
}

/**
 * Program length in weeks: W = floor((target - start) / 7) + 1, so the last
 * week (the peak week) always contains the target date.
 */
export function programWeeks(programStart: LocalDate, targetDate: LocalDate): number {
  const days = diffDays(programStart, targetDate);
  if (days < 0) throw new RangeError('targetDate is before programStart');
  return Math.floor(days / 7) + 1;
}

/** 1-based week number containing `date`, or null when it falls outside. */
export function weekIndexOf(programStart: LocalDate, W: number, date: LocalDate): number | null {
  const days = diffDays(programStart, date);
  if (days < 0) return null;
  const index = Math.floor(days / 7) + 1;
  return index > W ? null : index;
}

/**
 * Program start is the first day 0 on or after today, where day 0 is the
 * first chosen weekday in template order (brief 09 "Calendar and generation").
 */
export function programStartFor(today: LocalDate, weekdays: readonly Weekday[]): LocalDate {
  const day0 = weekdays[0];
  if (day0 === undefined) throw new RangeError('weekdays must contain at least one day');
  return nextWeekdayOnOrAfter(today, day0);
}

/**
 * Days from day 0 to `weekday` inside one training week, 0 to 6. The chosen
 * weekdays run in template order, so the offset wraps forward from day 0 and
 * never leaves the week's own window.
 */
export function dayOffsetInWeek(day0: Weekday, weekday: Weekday): number {
  return (weekday - day0 + 7) % 7;
}

/**
 * The dates one training week's sessions fall on, in template order.
 * `windowStart` is day 0 of that week.
 */
export function sessionDatesFor(
  windowStart: LocalDate,
  weekdays: readonly Weekday[],
): LocalDate[] {
  const day0 = weekdays[0];
  if (day0 === undefined) throw new RangeError('weekdays must contain at least one day');
  return weekdays.map((weekday) => addDays(windowStart, dayOffsetInWeek(day0, weekday)));
}
