/**
 * Whether a session may be dragged to another day.
 *
 * The spacing rules are read against the calendar, not against the next
 * scheduled session: "next training day" is the next calendar day (R24, R90,
 * R91, declared reading). At four days a week or more, maximal CNS lifts are
 * separated by at least one non-CNS-heavy training day (R93). The house rule
 * keeps maximal sessions 2 calendar days apart, which on whole days is the
 * same bound R90 sets.
 *
 * A refusal is always plain words plus the rule number, never a silent
 * disabled control: "Can't move Power + Speed here: heavy squat yesterday".
 * On Today only the words are shown; the number lives in the Plan summary,
 * and in the setup refusals, which say it out loud.
 */
import type { DayType, DaysPerWeek, Sport } from './types/core.js';
import type { SessionWindow, WallWork } from './types/athlete.js';
import type { LocalDate, Weekday } from './types/calendar.js';
import type { MoveDecision } from './types/logs.js';
import type { SessionPlan, WeekPlan } from './types/plan.js';
import type { Ruleset } from './types/ruleset.js';
import { addDays, dayOffsetInWeek, diffDays, isWithin } from './calendar.js';
import { dayTypesFor } from './skeleton/index.js';
import { climbingWeekLayout, upperPowerNote, wallPlacementFor } from './skeleton/climbing.js';

/** No rule-book rule refused this; the shape of the week did. */
const STRUCTURAL = 0;

/** Day types as the athlete reads them (brief section 13 "Vocabulary"). */
const DAY_TYPE_LABELS: Record<DayType, string> = {
  full_body_strength: 'Full Body Strength',
  lower_strength: 'Lower Strength',
  upper_strength: 'Upper Strength',
  upper_mobility: 'Upper + Mobility',
  power_speed: 'Power + Speed',
  power: 'Power',
  speed: 'Speed',
  recovery_mobility: 'Recovery - Mobility',
};

/** The athlete-facing name of a day type. */
export function dayTypeLabel(dayType: DayType): string {
  return DAY_TYPE_LABELS[dayType];
}

/** House definition: a heavy bilateral squat day that ran maximal. */
function isHeavySquatSession(session: SessionPlan): boolean {
  return (
    session.isMaximalCns &&
    (session.dayType === 'lower_strength' || session.dayType === 'full_body_strength')
  );
}

/** A day whose maximal work is jumps (R91's "maximal plyometrics"). */
function hasMaximalPlyometrics(session: SessionPlan): boolean {
  return (
    session.isMaximalCns &&
    (session.dayType === 'power_speed' || session.dayType === 'power' || session.dayType === 'speed')
  );
}

function refuse(reason: string, rule: number): MoveDecision {
  return { ok: false, reason, rule };
}

/**
 * Can the session currently on `from` move to `to`?
 * Both dates must lie inside the week's calendar window: a session never
 * leaves its adherence week. Pass `today` to enforce "this week's next
 * scheduled session only"; without it the spacing rules alone decide.
 */
export function canMoveSession(
  week: WeekPlan,
  from: LocalDate,
  to: LocalDate,
  ruleset: Ruleset,
  today?: LocalDate,
): MoveDecision {
  const session = week.sessions.find((entry) => entry.date === from);
  if (session === undefined) return refuse('No session on that day.', STRUCTURAL);
  if (from === to) return { ok: true };

  const window = { start: week.windowStart, end: week.windowEnd };
  if (!isWithin(to, window)) {
    return refuse('A session stays inside its own training week.', STRUCTURAL);
  }
  if (week.sessions.some((entry) => entry.date === to)) {
    return refuse(`${dayTypeLabel(session.dayType)} can't share a day with another session.`, STRUCTURAL);
  }

  if (today !== undefined) {
    const upcoming = week.sessions
      .filter((entry) => diffDays(today, entry.date) >= 0)
      .sort((a, b) => diffDays(b.date, a.date));
    const next = upcoming[0];
    if (next !== undefined && next.date !== from) {
      return refuse("Only this week's next session moves.", STRUCTURAL);
    }
  }

  const others = week.sessions.filter((entry) => entry.date !== from);
  const label = dayTypeLabel(session.dayType);

  if (session.isMaximalCns) {
    for (const other of others) {
      const gap = diffDays(other.date, to);
      if (gap === 1 && isHeavySquatSession(other) && hasMaximalPlyometrics(session)) {
        return refuse(`Can't move ${label} here: heavy squat yesterday`, 91);
      }
      if (gap === -1 && isHeavySquatSession(session) && hasMaximalPlyometrics(other)) {
        return refuse(`Can't move ${label} here: maximal jumps the next day`, 91);
      }
    }
    for (const other of others) {
      if (!other.isMaximalCns) continue;
      const gap = Math.abs(diffDays(other.date, to));
      if (gap >= ruleset.constants.maximalSessionSpacingDays) continue;
      const when = diffDays(other.date, to) > 0 ? 'the day before' : 'the next day';
      return refuse(
        `Can't move ${label} here: ${dayTypeLabel(other.dayType)} is ${when}. Hard days stay 2 days apart.`,
        90,
      );
    }
    if (week.sessions.length >= 4) {
      for (const other of others) {
        if (!other.isMaximalCns) continue;
        const early = diffDays(other.date, to) > 0 ? other.date : to;
        const late = diffDays(other.date, to) > 0 ? to : other.date;
        const between = others.some(
          (entry) => diffDays(early, entry.date) > 0 && diffDays(entry.date, late) > 0,
        );
        if (!between) {
          return refuse(
            `Can't move ${label} here: nothing easy sits between it and ${dayTypeLabel(other.dayType)}.`,
            93,
          );
        }
      }
    }
  }

  return { ok: true };
}

/**
 * The days inside this week a session could legally move to, for the Plan's
 * drag affordance and for "Train today anyway" on a rest day.
 */
export function legalMoveTargets(
  week: WeekPlan,
  from: LocalDate,
  ruleset: Ruleset,
  today?: LocalDate,
): LocalDate[] {
  const targets: LocalDate[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(week.windowStart, offset);
    if (date === from) continue;
    if (canMoveSession(week, from, date, ruleset, today).ok) targets.push(date);
  }
  return targets;
}

/** Day types whose top set or jumps make the day a maximal CNS day. */
function isMaximalDayType(dayType: DayType): boolean {
  return (
    dayType === 'full_body_strength' ||
    dayType === 'lower_strength' ||
    dayType === 'power_speed' ||
    dayType === 'power'
  );
}

function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function isDaysPerWeek(value: number): value is DaysPerWeek {
  return value === 2 || value === 3 || value === 4 || value === 5;
}

function isStrengthDayType(dayType: DayType): boolean {
  return dayType === 'full_body_strength' || dayType === 'lower_strength';
}

/**
 * Enough of the athlete for setup to check the wall against the picks. Absent,
 * or for any sport but speed climbing, the check below is the one every sport
 * has always had.
 */
export interface WeekdayLayoutContext {
  sport: Sport;
  wallWork?: WallWork;
  sessionWindow?: SessionWindow;
}

/**
 * True when the weekday layout the athlete picked at setup breaks a spacing
 * rule, so Setup can refuse inline before a program is ever built. Setup
 * refusals say the rule number out loud (brief section 06 "Weekday pick
 * refused").
 *
 * @param context the sport and the wall and gym windows. Given for a speed
 *   climber who has said when they climb, the spacing rules are checked
 *   against the wall-aware placement rather than against the template order.
 *   Picks that cannot carry the upper-power day are not refused: the generator
 *   falls back to the template order and demotes that day's pulls, and
 *   `weekdayLayoutNote` says so beside the picks.
 */
export function validateWeekdayLayout(
  weekdays: number[],
  daysPerWeek: number,
  ruleset: Ruleset,
  context?: WeekdayLayoutContext,
): MoveDecision {
  if (!isDaysPerWeek(daysPerWeek)) {
    return refuse('Train between 2 and 5 days a week.', STRUCTURAL);
  }
  if (weekdays.length !== daysPerWeek) {
    return refuse(`Pick ${daysPerWeek} training days.`, STRUCTURAL);
  }
  if (!weekdays.every(isWeekday)) return refuse('Pick days of the week.', STRUCTURAL);
  const picks: Weekday[] = weekdays.filter(isWeekday);
  const day0 = picks[0];
  if (day0 === undefined) return refuse('Pick a first training day.', STRUCTURAL);
  const offsets = picks.map((weekday) => dayOffsetInWeek(day0, weekday));
  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1];
    const current = offsets[index];
    if (previous === undefined || current === undefined || current <= previous) {
      return refuse('Pick different days, in the order you train them.', STRUCTURAL);
    }
  }

  const base = dayTypesFor(daysPerWeek);
  // House `house.sc.sport_requirements`: a climber's picks decide which day
  // carries what, so the spacing rules below are checked against the placement
  // the generator will actually build, not against the template order.
  const wall = context === undefined ? undefined : wallPlacementFor(context, ruleset);
  const placed = wall === undefined ? undefined : climbingWeekLayout(base, picks, wall);
  // No placement means no pick can carry the upper-power day. That is the
  // generator's fallback, not a refusal: it takes the template order and the
  // finger rule demotes that day's pulls (`weekdayLayoutFor`).
  const dayTypes = placed?.dayTypes ?? base;
  for (let a = 0; a < offsets.length; a += 1) {
    const typeA = dayTypes[a];
    const offsetA = offsets[a];
    if (typeA === undefined || offsetA === undefined || !isMaximalDayType(typeA)) continue;
    for (let b = a + 1; b < offsets.length; b += 1) {
      const typeB = dayTypes[b];
      const offsetB = offsets[b];
      if (typeB === undefined || offsetB === undefined || !isMaximalDayType(typeB)) continue;
      if (offsetB - offsetA >= 2) continue;
      if (isStrengthDayType(typeA) !== isStrengthDayType(typeB)) {
        return refuse("Strength and Power can't be on consecutive days (rule 91). Pick another day.", 91);
      }
      return refuse(
        `${dayTypeLabel(typeA)} and ${dayTypeLabel(typeB)} can't be on consecutive days (rule 90). Pick another day.`,
        90,
      );
    }
  }

  return { ok: true };
}

/** The setup-time name the brief uses. */
export const validateWeekdays = validateWeekdayLayout;

/**
 * The plain-words note beside a legal pick that cannot carry the upper-power
 * day (house `house.sc.sport_requirements`), or null when it can, when the
 * athlete has no wall, or when the picks are not yet a full week. The pick
 * is not refused: the generator runs the template order and the 48 h finger
 * rule turns that day's pulls into light work with a line naming the climbing
 * day, so setup says the same thing here, before the program is built.
 */
export function weekdayLayoutNote(
  weekdays: number[],
  daysPerWeek: number,
  ruleset: Ruleset,
  context?: WeekdayLayoutContext,
): string | null {
  if (context === undefined || !isDaysPerWeek(daysPerWeek)) return null;
  const picks: Weekday[] = weekdays.filter(isWeekday);
  if (picks.length !== daysPerWeek) return null;
  const base = dayTypesFor(daysPerWeek);
  if (!base.includes('upper_strength')) return null;
  const wall = wallPlacementFor(context, ruleset);
  if (wall === undefined) return null;
  if (climbingWeekLayout(base, picks, wall) !== undefined) return null;
  return upperPowerNote(wall);
}
