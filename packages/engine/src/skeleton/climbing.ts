/**
 * House `house.sc.sport_requirements`: which of the athlete's picked weekdays
 * carries which day type, once the wall is on the calendar.
 *
 * The rule book's weekly template (R133 to R136) fixes the SET of day types a
 * week carries; it does not fix which pick each one lands on. For every sport
 * but speed climbing the engine takes them in order, and this file is never
 * reached. For speed climbing the wall decides:
 *
 *   Upper power   a pick that is also a climbing day, earliest first, with the
 *                 same-day gap kept, so the week's one hard finger session and
 *                 the wall share a day rather than sitting 14 h apart. A pick
 *                 48 h clear of every climbing day works too, and is what an
 *                 athlete who climbs twice a week gets.
 *   Lower         the first pick that is NOT a climbing day: the heavy squat
 *                 gets a clear day where one is going spare.
 *   Power (test)  a pick at least two calendar days after the squat (R91) with
 *                 another pick between them (R93).
 *   Recovery      the first pick left.
 *   Speed         at five days, the pick left after that (R136).
 *
 * When no pick can carry the upper-power day, this returns undefined: setup
 * refuses with `upperPowerRefusal` and the generator falls back to the plain
 * template order, where the 48 h finger rule demotes the pulls and the session
 * says why.
 *
 * Pure and side-effect free; nothing here reads a clock or the ruleset.
 */
import { dayOffsetInWeek } from '../calendar.js';
import { sameDayWallGapOk, type WallGapInput } from '../select/rnt.js';
import type { Weekday } from '../types/calendar.js';
import type { DayType, Sport } from '../types/core.js';
import type { Ruleset } from '../types/ruleset.js';

/** Short weekday labels for the setup refusal. Sunday first. */
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The week as the athlete reads it, so a refusal lists Monday before Sunday. */
const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Everything the placement needs to know about the wall. */
export interface WallPlacement {
  /** Weekdays the athlete climbs, Sunday at 0. */
  weekdays: readonly Weekday[];
  /** True when the gym and wall windows clear each other by the same-day gap. */
  sameDayGapOk: boolean;
  /** The same-day gap in hours, for the refusal's own words. */
  sameDayGapHours: number;
  /** The hard-finger spacing in hours (48), for the refusal's own words. */
  spacingHours: number;
}

/** Which pick carries which day type, and where the weekly test sits. */
export interface ClimbingWeekLayout {
  /** One day type per pick, in the order the picks were given. */
  dayTypes: DayType[];
  /** Index of the pick the weekly test lands on. */
  testIndex: number;
  /** Index of the upper-power pick, so a caller can say where it went. */
  upperIndex: number;
}

/** Enough of an athlete to place the week: the sport and the two windows. */
export interface WallPlacementInput extends WallGapInput {
  sport: Sport;
}

/**
 * The wall as the placement reads it, or undefined for an athlete the rule
 * never touches: any sport but speed climbing, and any climber who has not
 * said when they climb.
 */
export function wallPlacementFor(
  input: WallPlacementInput,
  ruleset: Ruleset,
): WallPlacement | undefined {
  if (input.sport !== 'speed_climbing') return undefined;
  const wall = input.wallWork;
  if (wall === undefined || wall.weekdays.length === 0) return undefined;
  if (wall.fingerLoad === 'light') return undefined;
  const climbing = ruleset.constants.climbing;
  const sameDayGapHours = wall.sameDayGapHours ?? climbing.rntWallGapHours;
  return {
    weekdays: [...wall.weekdays],
    sameDayGapOk: sameDayWallGapOk(input, sameDayGapHours),
    sameDayGapHours,
    spacingHours: climbing.fingerSpacingHours,
  };
}

/** Whole days between two weekdays, whichever way round the week runs. */
function daysApart(a: Weekday, b: Weekday): number {
  const forward = dayOffsetInWeek(a, b);
  return Math.min(forward, 7 - forward);
}

/**
 * True when this weekday is at least `spacingHours` from every climbing day,
 * on the whole-day clock the finger rules use (a weekday two days from the
 * nearest climbing day is 48 h clear, and the week repeats, so both directions
 * count).
 */
export function clearOfWall(weekday: Weekday, wall: WallPlacement): boolean {
  if (wall.weekdays.length === 0) return true;
  const nearest = Math.min(...wall.weekdays.map((day) => daysApart(weekday, day)));
  return nearest * 24 >= wall.spacingHours;
}

/**
 * Whether this weekday could carry hard finger work: a climbing day with the
 * same-day gap kept, or a day clear of the wall by the finger spacing.
 */
export function canCarryHardFinger(weekday: Weekday, wall: WallPlacement): boolean {
  if (wall.weekdays.includes(weekday)) return wall.sameDayGapOk;
  return clearOfWall(weekday, wall);
}

/** Weekdays that could carry the upper-power day, in Monday-first order. */
export function upperPowerCandidates(wall: WallPlacement): Weekday[] {
  const found = WEEK_ORDER.filter((weekday) => canCarryHardFinger(weekday, wall));
  return found.length > 0 ? found : [...wall.weekdays].sort((a, b) => a - b);
}

/** "Tue", "Tue or Thu", "Sun, Tue or Thu". */
function listWeekdays(weekdays: readonly Weekday[]): string {
  const names = weekdays.map((weekday) => WEEKDAY_SHORT[weekday] ?? '');
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''}`;
}

/**
 * The plain-words setup refusal when none of the picked weekdays can carry the
 * upper-power day. Second person, no rule number, and it names the days that
 * would work (brief section 06, "Weekday pick refused").
 */
export function upperPowerRefusal(wall: WallPlacement): string {
  const suggestion = listWeekdays(upperPowerCandidates(wall));
  const tail = suggestion === '' ? '' : ` Pick ${suggestion}.`;
  return (
    `Upper power needs a climbing day at least ${wall.sameDayGapHours} h before the wall, ` +
    `or a day ${wall.spacingHours} h from climbing.${tail}`
  );
}

/** The pick indexes not yet spent, in the order the athlete trains them. */
function remaining(count: number, taken: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!taken.includes(index)) out.push(index);
  }
  return out;
}

/**
 * Where the Power day goes: the first pick left that is at least two calendar
 * days after the heavy squat (R91) with another pick between them (R93). When
 * no pick clears both, the two-day gap alone decides; when none clears that
 * either, the last pick left takes it, which is the best the week allows and
 * is what `validateWeekdayLayout` refuses at setup anyway.
 */
function powerIndexFor(
  free: readonly number[],
  offsets: readonly number[],
  lowerIndex: number,
): number {
  const squat = offsets[lowerIndex] ?? 0;
  const between = (index: number): boolean =>
    offsets.some((offset, at) => at !== index && offset > squat && offset < (offsets[index] ?? 0));
  const clear = free.filter((index) => (offsets[index] ?? 0) - squat >= 2);
  return clear.find(between) ?? clear[0] ?? free[free.length - 1] ?? 0;
}

/**
 * The climbing week's day types, by pick. Returns undefined when the athlete's
 * picks cannot carry an upper-power day, and for any day count whose template
 * has no separate upper day (two and three days), where the wall changes
 * nothing.
 *
 * @param base the rule book's day types for this day count, in template order.
 * @param weekdays the athlete's picks, in the order they train them.
 * @param wall the climbing days and the two gaps.
 */
export function climbingWeekLayout(
  base: readonly DayType[],
  weekdays: readonly Weekday[],
  wall: WallPlacement,
): ClimbingWeekLayout | undefined {
  if (!base.includes('upper_strength')) return undefined;
  if (weekdays.length !== base.length) return undefined;
  if (wall.weekdays.length === 0) return undefined;
  const day0 = weekdays[0];
  if (day0 === undefined) return undefined;
  const offsets = weekdays.map((weekday) => dayOffsetInWeek(day0, weekday));

  const onWall = weekdays.findIndex(
    (weekday) => wall.weekdays.includes(weekday) && wall.sameDayGapOk,
  );
  const upperIndex =
    onWall >= 0 ? onWall : weekdays.findIndex((weekday) => clearOfWall(weekday, wall));
  if (upperIndex < 0) return undefined;

  const afterUpper = remaining(weekdays.length, [upperIndex]);
  const lowerIndex =
    afterUpper.find((index) => !wall.weekdays.includes(weekdays[index] as Weekday)) ??
    afterUpper[0];
  if (lowerIndex === undefined) return undefined;

  const free = remaining(weekdays.length, [upperIndex, lowerIndex]);
  const powerIndex = powerIndexFor(free, offsets, lowerIndex);
  const left = remaining(weekdays.length, [upperIndex, lowerIndex, powerIndex]);

  const dayTypes: DayType[] = new Array<DayType>(weekdays.length).fill('recovery_mobility');
  dayTypes[lowerIndex] = 'lower_strength';
  dayTypes[upperIndex] = 'upper_strength';
  // Four days runs the combined Power + Speed day (R135); five days splits it,
  // and the Speed day (R136) takes the last pick left, after Recovery.
  dayTypes[powerIndex] = base.includes('power') ? 'power' : 'power_speed';
  const recoveryIndex = left[0];
  if (recoveryIndex !== undefined) dayTypes[recoveryIndex] = 'recovery_mobility';
  const speedIndex = left[1];
  if (speedIndex !== undefined) dayTypes[speedIndex] = 'speed';

  return { dayTypes, testIndex: powerIndex, upperIndex };
}
