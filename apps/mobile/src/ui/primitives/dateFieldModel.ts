/**
 * The date mapping behind DateField, kept pure so a test can hold it without
 * a renderer.
 *
 * Two calendars meet here. The app stores a LocalDate, a plain `YYYY-MM-DD`
 * with no zone, and the engine reads it as UTC midnight. The platform picker
 * hands back a `Date`, which is an instant in the device's own zone. Convert
 * one straight into the other and a phone west of Greenwich loses a day every
 * time: `new Date('2026-11-29')` is 28 Nov at 19:00 in New York.
 *
 * So the crossing is done on calendar parts, never on epoch arithmetic, and
 * the instant handed to the picker sits at local noon, which is the one hour
 * of the day no daylight-saving shift can move onto another date.
 */
import { isLocalDate, maxDate, minDate, weekdayLabelOf, weekdayOf } from '@vert/engine';
import type { LocalDate } from '@vert/engine';
import { formatShortDate } from '@vert/engine/analytics';

/** Midday: far enough from either edge that no zone offset changes the day. */
const PICKER_HOUR = 12;

/**
 * "Sun 29 Nov 2026". A target date is a day the athlete has to find in a
 * calendar, so the field reads it as one, with the weekday first. Built from
 * the engine's own formatters so it matches the Plan header and Settings.
 */
export function formatFullDate(date: LocalDate): string {
  return `${weekdayLabelOf(date, weekdayOf(date))} ${formatShortDate(date)} ${date.slice(0, 4)}`;
}

/**
 * What the closed control reads. A value that is not a date yet is shown
 * exactly as typed rather than corrected or blanked, so nothing an athlete
 * entered disappears behind a placeholder.
 */
export function dateFieldText(value: string, empty: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return empty;
  return isLocalDate(trimmed) ? formatFullDate(trimmed) : trimmed;
}

/** A LocalDate as an instant at local noon, which is what the picker takes. */
export function localDateToDate(date: LocalDate): Date {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return new Date(year, month - 1, day, PICKER_HOUR, 0, 0, 0);
}

/** The picker's instant back as the athlete's own calendar day. */
export function dateToLocalDate(date: Date): LocalDate {
  const year = `${date.getFullYear()}`.padStart(4, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Hold a day inside the offered range. Either bound may be absent. */
export function clampDate(
  date: LocalDate,
  minimum?: LocalDate,
  maximum?: LocalDate,
): LocalDate {
  const floored = minimum === undefined ? date : maxDate(date, minimum);
  return maximum === undefined ? floored : minDate(floored, maximum);
}

export interface PickerStartInput {
  /** The field's value, exactly as it stands. Often empty, sometimes junk. */
  readonly value: string;
  /** Where to open when the field holds no date: usually today. */
  readonly fallback: LocalDate;
  readonly minimumDate?: LocalDate;
  readonly maximumDate?: LocalDate;
}

/**
 * The day the wheels land on when the picker opens: the value if it reads as
 * a date, otherwise the offered fallback, and in both cases inside the range,
 * because a picker that opens on a day it will not accept reads as broken.
 */
export function pickerStart(input: PickerStartInput): LocalDate {
  const trimmed = input.value.trim();
  const base = isLocalDate(trimmed) ? trimmed : input.fallback;
  return clampDate(base, input.minimumDate, input.maximumDate);
}

/** The day a field with no fallback of its own opens on, from the device clock. */
export function todayFromClock(now: Date): LocalDate {
  return dateToLocalDate(now);
}
