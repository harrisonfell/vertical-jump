/**
 * One local-day function, used everywhere.
 *
 * A training day is not a UTC day and not always a calendar day: a session
 * logged at 1 a.m. after a late gym still belongs to the day before. So the
 * instant is read in the athlete's own zone with Intl (no date library, no
 * bundled tz table), and anything before the rollover hour is attributed to
 * the previous calendar date.
 *
 * The subtraction happens on the calendar date, never on the timestamp, so a
 * daylight-saving jump cannot skip or repeat a day.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date in the athlete's zone, "YYYY-MM-DD". */
export type LocalDay = string;

export interface ZoneParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

/** Wall-clock parts of an instant in a named zone. Throws on an unusable zone. */
export function zoneParts(tsIso: string | Date, timezone: string): ZoneParts {
  const instant = tsIso instanceof Date ? tsIso : new Date(tsIso);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`localDay: "${String(tsIso)}" is not a timestamp.`);
  }
  const parts = formatterFor(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number.parseInt(part.value, 10);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function toIsoDay(year: number, month: number, day: number): LocalDay {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * The training day an instant belongs to.
 *
 * @param tsIso       an ISO timestamp, or a Date
 * @param timezone    an IANA zone, e.g. "America/New_York"
 * @param rolloverHour 0 to 23; hours before it belong to the previous day
 */
export function localDay(tsIso: string | Date, timezone: string, rolloverHour = 0): LocalDay {
  if (!Number.isInteger(rolloverHour) || rolloverHour < 0 || rolloverHour > 23) {
    throw new RangeError(`localDay: rolloverHour must be 0 to 23, got ${String(rolloverHour)}.`);
  }
  const { year, month, day, hour } = zoneParts(tsIso, timezone);
  if (hour >= rolloverHour) return toIsoDay(year, month, day);
  return addDays(toIsoDay(year, month, day), -1);
}

/** Calendar arithmetic on "YYYY-MM-DD". Zone-free, so DST cannot reach it. */
export function addDays(day: LocalDay, delta: number): LocalDay {
  assertLocalDay(day);
  const base = Date.UTC(
    Number.parseInt(day.slice(0, 4), 10),
    Number.parseInt(day.slice(5, 7), 10) - 1,
    Number.parseInt(day.slice(8, 10), 10),
  );
  const moved = new Date(base + delta * 86_400_000);
  return toIsoDay(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Whole days from a to b, positive when b is later. */
export function daysBetween(a: LocalDay, b: LocalDay): number {
  assertLocalDay(a);
  assertLocalDay(b);
  return Math.round((dayToUtc(b) - dayToUtc(a)) / 86_400_000);
}

/** 0 Sunday to 6 Saturday, for a date that has no time and no zone. */
export function weekdayOf(day: LocalDay): number {
  assertLocalDay(day);
  return new Date(dayToUtc(day)).getUTCDay();
}

/**
 * Milliseconds until the athlete's day next turns over.
 *
 * The app stays resident for days on iOS, so `todayLocal` read once at boot is
 * the wrong answer by the next morning: yesterday's session is still on Today,
 * yesterday never becomes missed, and a set logged after the rollover is
 * stamped on the wrong training day. This is the interval a timer arms for.
 *
 * Wall-clock minutes, never a fixed 24 hours from now, so a daylight-saving
 * shift moves the boundary with the clock. One second is added so the timer
 * fires just after the boundary rather than exactly on it.
 */
export function msUntilNextRollover(
  timezone: string,
  rolloverHour = 0,
  now: Date = new Date(),
): number {
  const { hour, minute } = zoneParts(now, timezone);
  const minutesNow = hour * 60 + minute;
  const target = rolloverHour * 60;
  const delta = target > minutesNow ? target - minutesNow : target - minutesNow + 1440;
  return delta * 60_000 + 1_000;
}

/** The athlete's today, given their zone and rollover hour. */
export function todayLocal(timezone: string, rolloverHour = 0, now: Date = new Date()): LocalDay {
  return localDay(now, timezone, rolloverHour);
}

function dayToUtc(day: LocalDay): number {
  return Date.UTC(
    Number.parseInt(day.slice(0, 4), 10),
    Number.parseInt(day.slice(5, 7), 10) - 1,
    Number.parseInt(day.slice(8, 10), 10),
  );
}

function assertLocalDay(day: string): void {
  if (!ISO_DAY.test(day)) throw new RangeError(`localDay: "${day}" is not a YYYY-MM-DD date.`);
}
