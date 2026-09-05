/**
 * The plan skeleton: pure, built up front, the Plan's forward view.
 *
 * Blocks (Strength then Power, R108), weeks with their kind and the
 * progressed-week counter k, and per-week targets (extensive contacts, the
 * high-intensity allowance, the starting-percentage offset per load type, the
 * main-lift identity, the accessory rotation slot, the ladder rungs). It holds
 * no exercises and no loads: those come from `materializeWeek`.
 *
 * Program start is the first day 0 on or after today; W = floor((target -
 * start) / 7) + 1; the test is the k-th weekday pick (brief section 09
 * "Calendar and generation").
 */
import type { Athlete } from '../types/athlete.js';
import type { LocalDate, Weekday } from '../types/calendar.js';
import type {
  MainLiftSlot,
  PlanBlock,
  PlanSkeleton,
  SkeletonSession,
  SkeletonTargets,
  SkeletonWeek,
} from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';
import type { DayType, DaysPerWeek, ExerciseId, Sport } from '../types/core.js';
import {
  addDays,
  diffDays,
  programStartFor,
  programWeeks,
  sessionDatesFor,
  weekWindows,
  weekdayOf,
} from '../calendar.js';
import { IN_SEASON_LINE, deloadNotice, taperNotice } from '../materialize/copy.js';
import { blocksFor, chainFor, layoutFor, type LayoutWeek } from './layout.js';
import { climbingWeekLayout, wallPlacementFor } from './climbing.js';
import {
  accessoryRotationSlotFor,
  extensiveRangeFor,
  highIntensityFor,
  startingRungs,
  tendonModeFor,
  zeroStartOffsets,
} from './targets.js';

/** Short weekday labels for the Plan's peak-week note. Sunday first. */
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The back squat is kept across the Strength to Power transition to preserve
 * the working-max history; rotation happens only on plateau (brief 09). The
 * upper slot runs hypertrophy loads on Upper Strength at 4 and 5 days.
 */
export const DEFAULT_MAIN_LIFTS: Record<MainLiftSlot, ExerciseId> = {
  lower: 'back_squat',
  fullbody: 'back_squat',
  upper: 'db_bench_press',
};

/**
 * House `house.sc.box_squat_main_lift` and `house.sc.upper_power_day`: the box
 * squat is the climber's lower main lift and the weighted pull-up the upper
 * one, pull-up strength being the strongest single correlate with wall time.
 * Both are ordinary preferences: when the equipment is not on hand the main
 * lift slot falls back to the best row the pool still has.
 */
export const CLIMBING_MAIN_LIFTS: Record<MainLiftSlot, ExerciseId> = {
  lower: 'box_squat',
  fullbody: 'box_squat',
  upper: 'weighted_pull_up',
};

/** The main lift each slot starts a block on, for one sport. */
export function mainLiftsFor(sport: Sport): Record<MainLiftSlot, ExerciseId> {
  return sport === 'speed_climbing' ? { ...CLIMBING_MAIN_LIFTS } : { ...DEFAULT_MAIN_LIFTS };
}

/**
 * Week 1 of any first program carries one maximal CNS session, the test day
 * (R92); the strength day's top set is held here, or at RPE 6-7 without a max
 * (R76).
 */
export const WEEK1_TOP_SET_HOLD_PCT = 80;

/** Thrown when the athlete's weekday picks cannot make a training week. */
export class SkeletonInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'SkeletonInputError';
  }
}

/**
 * The weekly template verbatim from R133 to R136, in the order the athlete's
 * chosen weekdays run.
 */
export function dayTypesFor(daysPerWeek: DaysPerWeek): DayType[] {
  switch (daysPerWeek) {
    case 2:
      return ['full_body_strength', 'power_speed'];
    case 3:
      return ['full_body_strength', 'upper_mobility', 'power_speed'];
    case 4:
      return ['lower_strength', 'upper_strength', 'power_speed', 'recovery_mobility'];
    case 5:
      return ['lower_strength', 'upper_strength', 'power', 'speed', 'recovery_mobility'];
  }
}

/**
 * Where the weekly test sits: the Power day at 2 days, the third weekday pick
 * at 3, 4 and 5 days (brief section 09 "Weekly templates"). 0-based, an index
 * into the chosen weekdays.
 */
export function testWeekdayIndexFor(daysPerWeek: DaysPerWeek): number {
  return daysPerWeek === 2 ? 1 : 2;
}

/** One week's day types by pick, and the pick the weekly test lands on. */
export interface WeekdayLayout {
  dayTypes: DayType[];
  testIndex: number;
}

/**
 * The day types this athlete's picks carry, and where the test sits.
 *
 * Every sport but speed climbing takes the rule book's template in pick order
 * (R133 to R136), which is what `dayTypesFor` and `testWeekdayIndexFor` give.
 * A speed climber whose picks can carry an upper-power day gets the wall-aware
 * placement instead (house `house.sc.sport_requirements`); one whose picks
 * cannot falls back to the plain order here, and the 48 h finger rule demotes
 * that day's pulls with a line naming the climbing day.
 */
export function weekdayLayoutFor(athlete: Athlete, ruleset: Ruleset): WeekdayLayout {
  const base = dayTypesFor(athlete.daysPerWeek);
  const fallback = { dayTypes: base, testIndex: testWeekdayIndexFor(athlete.daysPerWeek) };
  const wall = wallPlacementFor(athlete, ruleset);
  if (wall === undefined) return fallback;
  const placed = climbingWeekLayout(base, athlete.weekdays, wall);
  return placed ?? fallback;
}

/**
 * The Speed day at 5 days is extensive-only, no high-intensity contacts,
 * because it follows Power on the next day. Upper + Mobility and Recovery
 * carry no high-intensity work either.
 */
export function isExtensiveOnlyDay(dayType: DayType): boolean {
  return dayType === 'speed' || dayType === 'upper_mobility' || dayType === 'recovery_mobility';
}

/** The main-lift slot a day type fills, or null when it carries no main lift. */
export function mainLiftSlotFor(dayType: DayType): MainLiftSlot | null {
  if (dayType === 'full_body_strength') return 'fullbody';
  if (dayType === 'lower_strength') return 'lower';
  if (dayType === 'upper_strength' || dayType === 'upper_mobility') return 'upper';
  return null;
}

function weekdayLabel(date: LocalDate): string {
  return WEEKDAY_SHORT[weekdayOf(date)] ?? '';
}

function buildSessions(
  windowStart: LocalDate,
  weekdays: readonly Weekday[],
  dayTypes: readonly DayType[],
  testIndex: number,
): SkeletonSession[] {
  const dates = sessionDatesFor(windowStart, weekdays);
  const sessions: SkeletonSession[] = [];
  for (let index = 0; index < weekdays.length; index += 1) {
    const weekday = weekdays[index];
    const date = dates[index];
    const dayType = dayTypes[index];
    if (weekday === undefined || date === undefined || dayType === undefined) continue;
    sessions.push({ dayIndex: index, weekday, date, dayType, isTestDay: index === testIndex });
  }
  return sessions;
}

/**
 * The peak week is anchored to the target date, not to the weekday picks: the
 * peak session at target minus 5, mobility at minus 2, rest at minus 1, and
 * the test on the day. Anything that would fall before day 0 of the peak week
 * is dropped, which happens only when the target lands early in its week.
 */
function buildPeakSessions(
  windowStart: LocalDate,
  targetDate: LocalDate,
  layout: WeekdayLayout,
): SkeletonSession[] {
  const dayTypes = layout.dayTypes;
  // The peak session is the week's heavy bilateral day, wherever the picks put
  // it: `lower` at four and five days, `fullbody` at two and three.
  const strengthDay =
    dayTypes.find((dayType) => dayType === 'lower_strength' || dayType === 'full_body_strength') ??
    dayTypes[0] ??
    'full_body_strength';
  const testDay = dayTypes[layout.testIndex] ?? 'power_speed';
  const targetOffset = diffDays(windowStart, targetDate);
  const wanted: { offset: number; dayType: DayType; isTestDay: boolean }[] = [
    { offset: targetOffset - 5, dayType: strengthDay, isTestDay: false },
    { offset: targetOffset - 2, dayType: 'recovery_mobility', isTestDay: false },
    { offset: targetOffset, dayType: testDay, isTestDay: true },
  ];
  const sessions: SkeletonSession[] = [];
  for (const entry of wanted) {
    if (entry.offset < 0) continue;
    const previous = sessions[sessions.length - 1];
    const date = addDays(windowStart, entry.offset);
    if (previous !== undefined && diffDays(previous.date, date) <= 0) continue;
    sessions.push({
      dayIndex: sessions.length,
      weekday: weekdayOf(date),
      date,
      dayType: entry.dayType,
      isTestDay: entry.isTestDay,
    });
  }
  return sessions;
}

function peakNote(sessions: readonly SkeletonSession[], targetDate: LocalDate): string {
  const parts: string[] = [];
  const peak = sessions.find((session) => !session.isTestDay);
  const mobility = sessions.find((session) => session.dayType === 'recovery_mobility');
  if (peak !== undefined && peak !== mobility) parts.push(`peak session ${weekdayLabel(peak.date)}`);
  if (mobility !== undefined) parts.push(`mobility ${weekdayLabel(mobility.date)}`);
  parts.push(`rest ${weekdayLabel(addDays(targetDate, -1))}`);
  parts.push(`target test ${weekdayLabel(targetDate)}`);
  return `Peak week: ${parts.join(', ')}.`;
}

function blockOrdinalOf(blocks: readonly PlanBlock[], w: number): number {
  return blocks.findIndex((block) => w >= block.weekFrom && w <= block.weekTo);
}

/**
 * Build the whole skeleton. Pure: `today` is a parameter, nothing reads the
 * clock, and no choice here needs the PRNG because every value is derived.
 */
export function planSkeleton(athlete: Athlete, today: LocalDate, ruleset: Ruleset): PlanSkeleton {
  const weekdays = athlete.weekdays;
  if (weekdays.length !== athlete.daysPerWeek) {
    throw new SkeletonInputError(
      `pick ${athlete.daysPerWeek} training days: ${weekdays.length} chosen`,
    );
  }
  const programStart = programStartFor(today, weekdays);
  if (diffDays(programStart, athlete.targetDate) < 0) {
    throw new SkeletonInputError(
      'Your target date is before your first training day. Pick a date at least a week out.',
    );
  }
  const chain = chainFor(ruleset, programWeeks(programStart, athlete.targetDate));
  const W = chain.programWeeks;
  const layoutWeeks: LayoutWeek[] = layoutFor(ruleset, W, athlete.level);
  const blocks = blocksFor(layoutWeeks);
  const windows = weekWindows(programStart, W);
  const weekLayout = weekdayLayoutFor(athlete, ruleset);
  const dayTypes = weekLayout.dayTypes;
  const testIndex = weekLayout.testIndex;
  const range = extensiveRangeFor(ruleset, athlete.level);
  const rungs = startingRungs([], athlete.inventory);
  const depthJumpEligible =
    ruleset.constants.depthJumpEligible[athlete.level] && athlete.readinessPassedAt !== undefined;

  const weeks: SkeletonWeek[] = [];
  let previousAllowance = ruleset.constants.contactCaps.highIntensityPerSession;
  let loadWeekOrdinal = 0;
  let currentBlock = -1;

  for (let index = 0; index < layoutWeeks.length; index += 1) {
    const layout = layoutWeeks[index];
    const window = windows[index];
    if (layout === undefined || window === undefined) continue;
    const blockOrdinal = blockOrdinalOf(blocks, layout.w);
    const block = blocks[blockOrdinal];
    const blockStartWeek = block?.weekFrom ?? layout.w;
    if (blockOrdinal !== currentBlock) {
      currentBlock = blockOrdinal;
      loadWeekOrdinal = 0;
    }

    const highIntensity = highIntensityFor(
      {
        blockType: layout.blockType,
        kind: layout.kind,
        level: athlete.level,
        loadWeekOrdinal,
        depthJumpsAllowed: depthJumpEligible && blockOrdinal >= 1 && layout.kind === 'load',
        previousAllowance,
        inSeason: athlete.inSeason,
      },
      ruleset,
    );
    if (layout.kind === 'load') loadWeekOrdinal += 1;
    previousAllowance = highIntensity.rawAllowance;

    const targets: SkeletonTargets = {
      extensiveBottom: range.bottom,
      extensiveTop: range.top,
      highIntensityAllowance: highIntensity.highIntensityAllowance,
      depthJumpReps: highIntensity.depthJumpReps,
      startOffsetPct: zeroStartOffsets(),
      mainLiftBySlot: mainLiftsFor(athlete.sport),
      accessoryRotationSlot: accessoryRotationSlotFor(layout.w, blockStartWeek, ruleset),
      ladderRungs: { ...rungs },
      tendonMode: tendonModeFor(athlete.trainingAge, layout.w, blockOrdinal, layout.blockType),
    };

    // A chained program does not peak into the far target: it ends on its own
    // last test, and the next program is built from that test (brief 09 "over
    // 16: chain 12-week programs from the last test"). Anchoring the peak week
    // to `targetDate` would date its sessions weeks outside their own window.
    const peakAnchor = chain.chained
      ? sessionDatesFor(window.start, weekdays)[testIndex] ?? addDays(window.start, 6)
      : athlete.targetDate;
    const sessions =
      layout.kind === 'peak'
        ? buildPeakSessions(window.start, peakAnchor, weekLayout)
        : buildSessions(window.start, weekdays, dayTypes, testIndex);

    // The Plan's forward view and the session notice say the same thing in the
    // same words, so the week never carries two wordings of one fact.
    const notes: string[] = [];
    if (layout.kind === 'deload') notes.push(deloadNotice(layout.w, W));
    if (layout.kind === 'taper') notes.push(taperNotice(layout.w, W));
    if (layout.kind === 'peak') notes.push(peakNote(sessions, peakAnchor));
    if (layout.w === blockStartWeek && blockOrdinal > 0 && layout.blockType === 'power') {
      notes.push(
        `Power block begins (week ${layout.w}). Main lift down to 3 sets, jumps up. Back squat stays.`,
      );
    }
    if (layout.w === 1) {
      notes.push(
        'Week 1 has one maximal effort session: the test day. The strength top set is held at 80%.',
      );
    }
    if (athlete.inSeason) notes.push(IN_SEASON_LINE);
    if (chain.chained && layout.w === W) {
      notes.push(
        `Program 1 of the chain ends here. ${chain.remainingWeeks} weeks remain: build the next program from this test.`,
      );
    }

    weeks.push({
      w: layout.w,
      kind: layout.kind,
      blockType: layout.blockType,
      k: 0,
      windowStart: window.start,
      windowEnd: window.end,
      sessions,
      targets,
      notes,
    });
  }

  return {
    programStart,
    targetDate: athlete.targetDate,
    W,
    daysPerWeek: athlete.daysPerWeek,
    weekdays: [...weekdays],
    testWeekdayIndex: testIndex,
    blocks,
    weeks,
  };
}

/** The week with this 1-based number, or undefined. */
export function weekAt(skeleton: PlanSkeleton, w: number): SkeletonWeek | undefined {
  return skeleton.weeks.find((week) => week.w === w);
}

/**
 * Rebuild the targets for one week after an outcome changed k, the extensive
 * target, the starting offsets or the ladder rungs. Used when a week is
 * re-materialized and when a repeat costs the longest remaining block a load
 * week.
 */
export function retargetWeek(
  skeleton: PlanSkeleton,
  w: number,
  ruleset: Ruleset,
  patch: Partial<SkeletonTargets>,
): SkeletonWeek {
  void ruleset;
  const week = weekAt(skeleton, w);
  if (week === undefined) throw new SkeletonInputError(`no week ${w} in this program`);
  return { ...week, targets: { ...week.targets, ...patch } };
}

export * from './layout.js';
export * from './climbing.js';
export * from './targets.js';
export * from './advance.js';
