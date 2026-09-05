import { addDays } from '../../lib/localDay';
import type { Json, LocalDate, Timestamp } from '../types';

/**
 * Moving a fixture in time.
 *
 * The engine's owner fixture is anchored to literal dates so it is
 * byte-identical run to run. The app's today comes from the clock, so the
 * fixture is slid by one whole-day offset on the way into the store: the week
 * the athlete opens is the fixture's week 7, on the same day of that week.
 *
 * Snapshots are stored verbatim, so the walker below moves the dates inside
 * them too. Nothing else is touched: a snapshot whose window says one date and
 * whose sessions say another is worse than no snapshot at all.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})(T.*)$/;

/** A calendar date moved by whole days. */
export function shiftDay(day: LocalDate, shift: number): LocalDate {
  if (shift === 0 || !DAY.test(day)) return day;
  return addDays(day, shift);
}

/** An ISO instant moved by whole days, keeping its wall clock and zone. */
export function shiftInstant(at: Timestamp, shift: number): Timestamp {
  if (shift === 0) return at;
  const match = INSTANT.exec(at);
  if (match === null) return at;
  const day = match[1];
  const rest = match[2];
  if (day === undefined || rest === undefined) return at;
  return `${addDays(day, shift)}${rest}`;
}

/** 0 Sunday to 6 Saturday, moved by the same offset so the calendar agrees. */
export function rotateWeekday(weekday: number, shift: number): number {
  return (((weekday + shift) % 7) + 7) % 7;
}

/** Keys whose numbers are weekdays, not measurements. */
const WEEKDAY_KEY = 'weekday';
const WEEKDAYS_KEY = 'weekdays';

/**
 * Walks a snapshot and moves every date-shaped string and weekday number.
 * Structure, key order and every other value are left exactly as they were.
 */
export function shiftJson(value: unknown, shift: number, key?: string): Json {
  if (shift === 0) return value as Json;

  if (typeof value === 'string') {
    if (DAY.test(value)) return addDays(value, shift);
    if (INSTANT.test(value)) return shiftInstant(value, shift);
    return value;
  }

  if (typeof value === 'number') {
    return key === WEEKDAY_KEY ? rotateWeekday(value, shift) : value;
  }

  if (Array.isArray(value)) {
    const childKey = key === WEEKDAYS_KEY ? WEEKDAY_KEY : undefined;
    return value.map((item) => shiftJson(item, shift, childKey));
  }

  if (typeof value === 'object' && value !== null) {
    const out: Record<string, Json> = {};
    for (const [name, item] of Object.entries(value)) out[name] = shiftJson(item, shift, name);
    return out;
  }

  return value as Json;
}
