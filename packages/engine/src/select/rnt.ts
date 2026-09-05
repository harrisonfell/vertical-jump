/**
 * House `house.sc.rnt_valgus_control`: where the week's knee-alignment rows
 * land, and the clock the wall gap is measured on.
 *
 * Split out of `sport.ts` so both files stay under the 500-line limit. Nothing
 * here is read by any sport but speed climbing: an athlete with no
 * `valgusControl` gets an empty placement and no line.
 *
 * Two clocks live in this file and in `sport.ts`, and the shipped rule text
 * names both. The wall gap is measured window END to window START, because it
 * is about proximity; the hard-finger gap in `sport.ts` is measured session
 * START to session START, because it is about how often a tissue is loaded.
 */
import { addDays, diffDays, weekdayOf } from '../calendar.js';
import type { Athlete, SessionWindow, WallWork } from '../types/athlete.js';
import type { LocalDate, Weekday } from '../types/calendar.js';
import type { Exercise } from '../types/exercise.js';
import type { SessionBlock, SkeletonSession, WeekPlan } from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';

/** Long weekday names for the placement lines. Sunday first. */
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Short weekday names for the demotion lines. Sunday first. */
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The window a gym session is assumed to occupy when nothing better is known.
 * The engine schedules dates, not clock times, so the wall-work gap needs one
 * window to measure from; `athlete.sessionWindow` overrides it once the
 * athlete has said when they train.
 */
export const ASSUMED_SESSION_WINDOW = { start: '17:00', end: '19:00' } as const;

/** When this athlete trains, or the assumed window when they have not said. */
export function sessionWindowFor(athlete: Athlete): { start: string; end: string } {
  return athlete.sessionWindow ?? ASSUMED_SESSION_WINDOW;
}

/** Minutes since local midnight, or `fallback` when the text is not a time. */
export function minutesOfDay(text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match === null) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return hours * 60 + minutes;
}

/** True when a session carries an RNT knee-alignment row. */
export function sessionHasRnt(
  blocks: readonly SessionBlock[],
  byId: ReadonlyMap<string, Exercise>,
): boolean {
  return blocks.some((block) =>
    block.exercises.some((row) => byId.get(row.exerciseId)?.isRnt === true),
  );
}

/** Where the week's RNT rows landed, and what to say when one had to move. */
export interface RntPlacement {
  /** Session ids that carry the RNT row, in date order. */
  sessionIds: string[];
  /**
   * Plain words for a session that was skipped, second person and no rule
   * number: "RNT moved off Tuesday: it is inside 6 hours of your wall session."
   */
  lines: string[];
}

/** One week's RNT placement, by `dayIndex`. */
export interface RntPlan {
  /** `dayIndex` values that carry the RNT row. */
  dayIndexes: Set<number>;
  /** Those placed anyway because no session in the week was far enough. */
  forced: Set<number>;
  /**
   * The "moved off" explanations. A week-level fact: the day they name has no
   * RNT row on it, so `materializeWeek` puts them on the week's lines rather
   * than on a session's notices, where they would never be read.
   */
  movedLines: string[];
  /** The cue a forced session carries, because nothing cleared the wall. */
  forcedLines: string[];
  /** Both of the above, moved first, for a caller that wants the whole set. */
  lines: string[];
}

/** True when this date's assumed session window clears the wall by `hours`. */
export function farFromWall(date: LocalDate, athlete: Athlete, hours: number): boolean {
  const wall = athlete.wallWork;
  if (wall === undefined || wall.weekdays.length === 0) return true;
  const window = sessionWindowFor(athlete);
  const sessionStart = minutesOfDay(window.start, 17 * 60);
  const sessionEnd = minutesOfDay(window.end, 19 * 60);
  const wallStart = minutesOfDay(wall.typicalStart, 0);
  const wallEnd = minutesOfDay(wall.typicalEnd, 24 * 60);
  const minutes = hours * 60;
  for (let offset = -2; offset <= 2; offset += 1) {
    const dayMinutes = offset * 1440;
    const weekday = weekdayOf(addDays(date, offset));
    if (!wall.weekdays.includes(weekday)) continue;
    const gap = Math.max(
      0,
      dayMinutes + wallStart - sessionEnd,
      sessionStart - (dayMinutes + wallEnd),
    );
    if (gap < minutes) return false;
  }
  return true;
}

/* ------------------------------------------- the wall as a finger session */

/** One wall session, as a window on a date. */
export interface WallSession {
  date: LocalDate;
  weekday: Weekday;
  /** Minutes since local midnight. */
  startMinutes: number;
  endMinutes: number;
  /** "Tue evening", for the line a demoted session carries. */
  label: string;
}

/** Morning, afternoon or evening, read off the window's start. */
function partOfDay(startMinutes: number): string {
  if (startMinutes < 12 * 60) return 'morning';
  if (startMinutes < 17 * 60) return 'afternoon';
  return 'evening';
}

/**
 * The athlete's wall sessions on the days around `date`, in date order.
 * The engine schedules dates, so the wall is read off the weekday pattern and
 * the typical window; a whole day counts when no window is given.
 *
 * @param radiusDays how far either side of `date` to look. Two days covers
 *   every gap the finger rules measure and keeps the walk cheap.
 */
export function wallSessionsAround(
  date: LocalDate,
  athlete: Athlete,
  radiusDays = 2,
): WallSession[] {
  const wall = athlete.wallWork;
  if (wall === undefined || wall.weekdays.length === 0) return [];
  const start = minutesOfDay(wall.typicalStart, 0);
  const end = minutesOfDay(wall.typicalEnd, 24 * 60);
  const out: WallSession[] = [];
  for (let offset = -radiusDays; offset <= radiusDays; offset += 1) {
    const on = addDays(date, offset);
    const weekday = weekdayOf(on);
    if (!wall.weekdays.includes(weekday)) continue;
    out.push({
      date: on,
      weekday,
      startMinutes: start,
      endMinutes: end,
      label: `${WEEKDAY_SHORT[weekday] ?? 'that day'} ${partOfDay(start)}`,
    });
  }
  return out;
}

/**
 * House `house.sc.hard_finger_spacing`, the owner's own reading: a speed
 * climbing wall session IS a hard finger session, and the one exception is a
 * gym session on the same day, far enough either side of the wall window.
 *
 * So a gym session may carry hard finger rows when EITHER it sits on a wall
 * day with the same-day gap kept (the gym window ends `sameDayGapHours`
 * before the wall window starts, or starts that many hours after it ends), OR
 * it is at least `spacingHours` from every wall session, start to start on
 * the same whole-day clock `hoursBetweenSessions` uses.
 *
 * @param sameDayGapHours the same-day exception's gap; callers resolve it as
 *   `wallWork.sameDayGapHours` then `constants.climbing.rntWallGapHours`,
 *   which is the same six hours the knee-alignment row keeps.
 * @returns `ok` false with the wall session that refused it, so the caller can
 *   name the day in the line the athlete reads.
 */
export function wallFingerVerdict(
  date: LocalDate,
  athlete: Athlete,
  spacingHours: number,
  sameDayGapHours: number,
): { ok: boolean; blockedBy?: WallSession } {
  const wall = athlete.wallWork;
  if (wall === undefined || wall.weekdays.length === 0) return { ok: true };
  if (wall.fingerLoad === 'light') return { ok: true };
  const near = wallSessionsAround(date, athlete, Math.ceil(spacingHours / 24));
  if (near.length === 0) return { ok: true };

  const sameDay = near.filter((session) => session.date === date);
  if (sameDay.length > 0) {
    const gapMinutes = Math.max(0, sameDayGapHours) * 60;
    const window = sessionWindowFor(athlete);
    const sessionStart = minutesOfDay(window.start, 17 * 60);
    const sessionEnd = minutesOfDay(window.end, 19 * 60);
    for (const session of sameDay) {
      const gap = Math.max(session.startMinutes - sessionEnd, sessionStart - session.endMinutes);
      if (gap < gapMinutes) return { ok: false, blockedBy: session };
    }
    return { ok: true };
  }

  for (const session of near) {
    if (Math.abs(diffDays(date, session.date)) * 24 >= spacingHours) continue;
    return { ok: false, blockedBy: session };
  }
  return { ok: true };
}

/**
 * The line a session carries when the wall took its hard finger rows: plain
 * words, second person, the wall day named, no rule number.
 */
export function wallFingerLine(wall: WallSession, spacingHours: number): string {
  return `Pull-ups moved to light work: climbing ${wall.label}, ${spacingHours} h finger rule`;
}

/** The two windows the same-day gap is measured between. */
export interface WallGapInput {
  wallWork?: WallWork;
  sessionWindow?: SessionWindow;
}

/**
 * True when a gym session and a wall session ON THE SAME DAY are `gapHours`
 * apart, either way round: the gym window ends that long before the wall
 * window starts, or starts that long after it ends. Weekday-independent,
 * because one window covers every gym day, so it is a single fact about the
 * athlete's two windows and not about a date.
 */
export function sameDayWallGapOk(input: WallGapInput, gapHours: number): boolean {
  const wall = input.wallWork;
  if (wall === undefined) return true;
  const window = input.sessionWindow ?? ASSUMED_SESSION_WINDOW;
  const sessionStart = minutesOfDay(window.start, 17 * 60);
  const sessionEnd = minutesOfDay(window.end, 19 * 60);
  const wallStart = minutesOfDay(wall.typicalStart, 0);
  const wallEnd = minutesOfDay(wall.typicalEnd, 24 * 60);
  const gap = Math.max(wallStart - sessionEnd, sessionStart - wallEnd);
  return gap >= Math.max(0, gapHours) * 60;
}

/**
 * House `house.sc.rnt_valgus_control`: which sessions of the week carry the
 * knee-alignment row. Sessions that clear the wall by the required gap are
 * taken first, in date order; a recovery day is never used because its
 * template has no injury-prevention slot. When too few sessions clear the
 * gap, the remaining rows are placed anyway with a line saying so.
 */
export function planRntSessions(
  sessions: readonly SkeletonSession[],
  athlete: Athlete,
  ruleset: Ruleset,
): RntPlan {
  const control = athlete.valgusControl;
  const empty: RntPlan = {
    dayIndexes: new Set(),
    forced: new Set(),
    movedLines: [],
    forcedLines: [],
    lines: [],
  };
  if (control === undefined || !control.required) return empty;
  const climbing = ruleset.constants.climbing;
  // `??`, never `||`: a zero the athlete typed is an answer. Nought sessions
  // asks for no rows at all, and a nought-hour gap says the wall needs no
  // spacing, so nothing may be reported as moved or forced for that athlete.
  const wanted = Math.max(0, control.sessionsPerWeek ?? climbing.rntSessionsPerWeek);
  const gapHours = Math.max(0, control.minHoursFromWall ?? climbing.rntWallGapHours);
  const eligible = [...sessions]
    .filter((session) => session.dayType !== 'recovery_mobility')
    .sort((a, b) => diffDays(b.date, a.date));
  if (wanted === 0 || eligible.length === 0) return empty;

  const far = eligible.filter((session) => farFromWall(session.date, athlete, gapHours));
  const near = eligible.filter((session) => !farFromWall(session.date, athlete, gapHours));
  const taken = [...far, ...near].slice(0, wanted);
  const takenIds = new Set(taken.map((session) => session.dayIndex));
  const forced = new Set(
    taken.filter((session) => near.includes(session)).map((session) => session.dayIndex),
  );

  const movedLines: string[] = [];
  for (const session of eligible.slice(0, wanted)) {
    if (takenIds.has(session.dayIndex)) continue;
    if (!near.includes(session)) continue;
    const day = WEEKDAY_LONG[weekdayOf(session.date)] ?? 'that day';
    movedLines.push(`RNT moved off ${day}: it is inside ${gapHours} hours of your wall session.`);
  }
  const forcedLines =
    forced.size > 0 ? [`RNT: keep ${gapHours} h from wall work.`] : [];
  return {
    dayIndexes: takenIds,
    forced,
    movedLines,
    forcedLines,
    lines: [...movedLines, ...forcedLines],
  };
}

/**
 * House `house.sc.rnt_valgus_control`: place the week's RNT knee-alignment
 * rows over an already materialized week. Two a week by default, each at
 * least `minHoursFromWall` hours from a wall session; when no session in the
 * week is far enough, the row is placed anyway and a line says why.
 *
 * @param week the materialized week whose sessions are being placed on.
 * @param athlete read for `wallWork` and `valgusControl`; when either is
 *   absent the placement is empty and nothing is scheduled.
 * @param ruleset read for `constants.climbing.rntSessionsPerWeek` and
 *   `constants.climbing.rntWallGapHours`.
 */
export function placeRnt(week: WeekPlan, athlete: Athlete, ruleset: Ruleset): RntPlacement {
  const sessions = week.sessions ?? [];
  const asSkeleton: SkeletonSession[] = sessions.map((session, index) => ({
    dayIndex: index,
    weekday: session.weekday,
    date: session.date,
    dayType: session.dayType,
    isTestDay: session.isTestDay,
  }));
  const plan = planRntSessions(asSkeleton, athlete, ruleset);
  const sessionIds = sessions
    .filter((_session, index) => plan.dayIndexes.has(index))
    .map((session) => session.id);
  return { sessionIds, lines: plan.lines };
}
