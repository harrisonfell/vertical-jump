/**
 * The owner's own placement: under the upper-body emphasis the athlete names
 * the two weekdays the upper days go on (Monday and Wednesday for the owner,
 * whose volleyball sits on Tuesday and Thursday), and the rest of the week is
 * placed around them.
 *
 *   Upper power   the named day that can carry hard finger work when the wall
 *                 is on the calendar, else the first named day in pick order.
 *   Upper + Mob   the other named day.
 *   Lower         the first pick left that has another pick at least two days
 *                 after it, so the Power day can keep R91's gap.
 *   Power (test)  `powerIndexFor`, exactly as the climbing placement uses it.
 *   Speed         at five days, the pick left after that (R136).
 *
 * Returns undefined, and the caller falls back to its own placement, unless
 * the template is the emphasis one, exactly two upper days are named, and
 * both are among the picks.
 *
 * Pure and side-effect free.
 */
import { dayOffsetInWeek } from '../calendar.js';
import type { Weekday } from '../types/calendar.js';
import type { DayType } from '../types/core.js';
import {
  canCarryHardFinger,
  powerIndexFor,
  remaining,
  type ClimbingWeekLayout,
  type WallPlacement,
} from './climbing.js';

/** How many upper days the emphasis template carries at four and five days. */
export const UPPER_DAY_COUNT = 2;

export function upperDayLayout(
  base: readonly DayType[],
  weekdays: readonly Weekday[],
  upperWeekdays: readonly Weekday[] | undefined,
  wall?: WallPlacement,
): ClimbingWeekLayout | undefined {
  if (!base.includes('upper_strength') || !base.includes('upper_mobility')) return undefined;
  if (upperWeekdays === undefined || upperWeekdays.length !== UPPER_DAY_COUNT) return undefined;
  if (weekdays.length !== base.length) return undefined;
  const upper = weekdays
    .map((weekday, index) => (upperWeekdays.includes(weekday) ? index : -1))
    .filter((index) => index >= 0);
  if (upper.length !== UPPER_DAY_COUNT) return undefined;
  const day0 = weekdays[0];
  if (day0 === undefined) return undefined;
  const offsets = weekdays.map((weekday) => dayOffsetInWeek(day0, weekday));

  const hard =
    (wall === undefined
      ? undefined
      : upper.find((index) => canCarryHardFinger(weekdays[index] as Weekday, wall))) ??
    upper[0];
  const second = upper.find((index) => index !== hard);
  if (hard === undefined || second === undefined) return undefined;

  const free = remaining(weekdays.length, upper);
  const lowerIndex =
    free.find((index) =>
      free.some((other) => (offsets[other] ?? 0) - (offsets[index] ?? 0) >= 2),
    ) ?? free[0];
  if (lowerIndex === undefined) return undefined;
  const powerIndex = powerIndexFor(
    free.filter((index) => index !== lowerIndex),
    offsets,
    lowerIndex,
  );
  const left = remaining(weekdays.length, [...upper, lowerIndex, powerIndex]);

  const dayTypes: DayType[] = new Array<DayType>(weekdays.length).fill('upper_mobility');
  dayTypes[hard] = 'upper_strength';
  dayTypes[second] = 'upper_mobility';
  dayTypes[lowerIndex] = 'lower_strength';
  dayTypes[powerIndex] = base.includes('power') ? 'power' : 'power_speed';
  const speedIndex = left[0];
  if (speedIndex !== undefined) dayTypes[speedIndex] = 'speed';
  return { dayTypes, testIndex: powerIndex, upperIndex: hard };
}
