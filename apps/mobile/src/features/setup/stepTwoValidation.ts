/**
 * Step 2's rules, pure so they can be read and tested without a render.
 *
 * Two of them are hard and refuse the step: the goal has to be above the
 * current height, and the target date has to be at least two weeks out. The
 * weekday refusals come from the engine's own `validateWeekdays` and say the
 * rule number out loud, which is one of the two places a rule number appears.
 */
import {
  RULESET_V1,
  diffDays,
  formatInteger,
  isLocalDate,
  mmToIn,
  programStartFor,
  programWeeks,
  validateWeekdays,
} from '@vert/engine';
import {
  formatInValue,
  formatRateInPerWk,
  formatShortDate,
  requiredPaceInPerWk,
} from '@vert/engine/analytics';
import type { DaysPerWeek, Sport, WallWork, SessionWindow, Weekday } from '@vert/engine';
import type { LocalDate } from '@/data';

/** The OVR Jump's own field: under 6 in or over 60 in is not a reading. */
export const HEIGHT_MIN_IN = 6;
export const HEIGHT_MAX_IN = 60;
/** Hard: the program needs two weeks to have a shape at all. */
export const MIN_TARGET_DAYS = 14;

export type MeasureMode = 'device' | 'reach';

export interface StepTwoDraft {
  readonly measure: MeasureMode;
  /** Raw text, kept exactly as typed so an error never clears a field. */
  readonly baselineIn: string;
  readonly reachIn: string;
  readonly touchIn: string;
  readonly canonical: boolean;
  readonly goalIn: string;
  readonly targetDate: string;
  readonly weekdays: readonly number[];
  readonly daysPerWeek: DaysPerWeek;
  readonly bodyweightLb: string;
  readonly squatLb: string;
  readonly hingeLb: string;
  readonly pressLb: string;
  /** Speed climbing's lower main lift. Blank on every other sport. */
  readonly boxSquatLb: string;
  /** The load hung on a weighted pull-up, not the bodyweight under it. */
  readonly pullUpAddedLb: string;
  readonly inSeason: boolean;
}

export type StepTwoField =
  | 'baselineIn'
  | 'reachIn'
  | 'touchIn'
  | 'goalIn'
  | 'targetDate'
  | 'weekdays'
  | 'bodyweightLb'
  | 'squatLb'
  | 'hingeLb'
  | 'pressLb'
  | 'boxSquatLb'
  | 'pullUpAddedLb';

export interface StepTwoResult {
  readonly errors: Readonly<Partial<Record<StepTwoField, string>>>;
  /** The baseline the goal is measured against, in inches, when it parses. */
  readonly currentIn: number | null;
  readonly goalValue: number | null;
  readonly ok: boolean;
}

/** A number the athlete typed, or null. Blank is null, not zero. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Weekday picks in template order: ascending, so day 0 is the earliest pick. */
export function orderWeekdays(days: readonly number[]): Weekday[] {
  return [...new Set(days)]
    .filter((day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
}

/** Jump height from the two reach-and-touch numbers, in inches. */
export function reachTouchIn(reach: number | null, touch: number | null): number | null {
  if (reach === null || touch === null) return null;
  return touch - reach;
}

function heightError(value: number | null, missing: string): string | undefined {
  if (value === null) return missing;
  if (value < HEIGHT_MIN_IN || value > HEIGHT_MAX_IN) {
    return `A jump height reads between ${HEIGHT_MIN_IN} and ${HEIGHT_MAX_IN} in. Check the number.`;
  }
  return undefined;
}

function loadError(text: string): string | undefined {
  const value = parseNumber(text);
  if (value === null) return undefined;
  if (value < 45 || value > 1000) return 'A 1RM reads between 45 and 1,000 lb.';
  return undefined;
}

/** The lightest added load worth entering, and the heaviest that is a reading. */
export const ADDED_LOAD_MIN_LB = 5;
export const ADDED_LOAD_MAX_LB = 300;

/**
 * A weighted pull-up is prescribed as added load alone, so its field is not a
 * 1RM field: 40 lb is an ordinary answer and 500 lb is not a reading.
 */
function addedLoadError(text: string): string | undefined {
  const value = parseNumber(text);
  if (value === null) return undefined;
  if (value < ADDED_LOAD_MIN_LB || value > ADDED_LOAD_MAX_LB) {
    return `An added load reads between ${formatInteger(ADDED_LOAD_MIN_LB)} and ${formatInteger(ADDED_LOAD_MAX_LB)} lb.`;
  }
  return undefined;
}

export interface StepTwoContext {
  readonly today: LocalDate;
  /**
   * The climbing answers from step 1, when there are any.
   *
   * Given a sport and a wall, `validateWeekdays` checks the picks against the
   * placement the generator will actually build rather than against the
   * template order, so a climber who picks four days that cannot carry the
   * upper-power session is refused here with the engine's own sentence
   * (`house.sc.sport_requirements`) instead of finding out at build time.
   */
  readonly sport?: Sport;
  readonly wallWork?: WallWork | null;
  readonly sessionWindow?: SessionWindow | null;
}

/** The engine's layout context, or undefined when the sport has no wall. */
function layoutContext(
  context: StepTwoContext,
): { sport: Sport; wallWork?: WallWork; sessionWindow?: SessionWindow } | undefined {
  if (context.sport === undefined) return undefined;
  const wall = context.wallWork ?? undefined;
  const window = context.sessionWindow ?? undefined;
  return {
    sport: context.sport,
    ...(wall === undefined ? null : { wallWork: wall }),
    ...(window === undefined ? null : { sessionWindow: window }),
  };
}

/** Every rule step 2 enforces, in one pass. */
export function validateStepTwo(draft: StepTwoDraft, context: StepTwoContext): StepTwoResult {
  const errors: Partial<Record<StepTwoField, string>> = {};

  let currentIn: number | null;
  if (draft.measure === 'device') {
    currentIn = parseNumber(draft.baselineIn);
    const problem = heightError(currentIn, 'Enter your baseline jump height.');
    if (problem !== undefined) errors.baselineIn = problem;
  } else {
    const reach = parseNumber(draft.reachIn);
    const touch = parseNumber(draft.touchIn);
    if (reach === null) errors.reachIn = 'Enter your standing reach.';
    if (touch === null) errors.touchIn = 'Enter the height you touched.';
    currentIn = reachTouchIn(reach, touch);
    if (currentIn !== null && currentIn <= 0) {
      errors.touchIn = 'Touch height has to be above your standing reach.';
      currentIn = null;
    } else {
      const problem = heightError(currentIn, 'Enter your standing reach and touch height.');
      if (problem !== undefined && reach !== null && touch !== null) errors.touchIn = problem;
    }
  }

  const goalValue = parseNumber(draft.goalIn);
  if (goalValue === null) {
    errors.goalIn = 'Enter a goal jump height.';
  } else if (goalValue > HEIGHT_MAX_IN) {
    errors.goalIn = `A jump height reads between ${HEIGHT_MIN_IN} and ${HEIGHT_MAX_IN} in. Check the number.`;
  } else if (currentIn !== null && goalValue <= currentIn) {
    errors.goalIn = `Your goal has to be above ${formatInValue(currentIn)} in, where you are now.`;
  }

  const target = draft.targetDate.trim();
  if (target === '' || !isLocalDate(target)) {
    errors.targetDate = "That isn't a date. Use YYYY-MM-DD, for example 2026-12-05.";
  } else {
    const days = diffDays(context.today, target);
    if (days < MIN_TARGET_DAYS) {
      errors.targetDate =
        days < 0
          ? 'That date has passed. Pick a date at least 2 weeks out.'
          : `That is ${formatInteger(days)} days out. Pick a date at least 2 weeks out.`;
    }
  }

  const picks = orderWeekdays(draft.weekdays);
  const weekdayDecision = validateWeekdays(
    picks,
    draft.daysPerWeek,
    RULESET_V1,
    layoutContext(context),
  );
  if (!weekdayDecision.ok) errors.weekdays = weekdayDecision.reason;

  const bodyweight = parseNumber(draft.bodyweightLb);
  if (bodyweight !== null && (bodyweight < 60 || bodyweight > 500)) {
    errors.bodyweightLb = 'Bodyweight reads between 60 and 500 lb.';
  }
  const squat = loadError(draft.squatLb);
  if (squat !== undefined) errors.squatLb = squat;
  const hinge = loadError(draft.hingeLb);
  if (hinge !== undefined) errors.hingeLb = hinge;
  const press = loadError(draft.pressLb);
  if (press !== undefined) errors.pressLb = press;
  const boxSquat = loadError(draft.boxSquatLb);
  if (boxSquat !== undefined) errors.boxSquatLb = boxSquat;
  const pullUp = addedLoadError(draft.pullUpAddedLb);
  if (pullUp !== undefined) errors.pullUpAddedLb = pullUp;

  return {
    errors,
    currentIn,
    goalValue,
    ok: Object.keys(errors).length === 0,
  };
}

export interface FeasibilityInput {
  readonly currentIn: number;
  readonly goalIn: number;
  readonly targetDate: LocalDate;
  readonly today: LocalDate;
  readonly weekdays: readonly Weekday[];
}

/**
 * The feasibility line, shown as soon as the goal and the date are valid:
 * "12 weeks to 29 Nov. From 29.4 in to 36.0 in is +0.55 in/wk."
 *
 * The required pace is the analytics one, fixed at program start, so the line
 * setup shows and the grey line on the chart are the same number.
 */
export function feasibilityLine(input: FeasibilityInput): string | null {
  if (!isLocalDate(input.targetDate)) return null;
  const start =
    input.weekdays.length === 0 ? input.today : programStartFor(input.today, input.weekdays);
  if (diffDays(start, input.targetDate) < 0) return null;
  const weeks = programWeeks(start, input.targetDate);
  const pace = requiredPaceInPerWk(input.currentIn, input.goalIn, weeks);
  return [
    `${formatInteger(weeks)} weeks to ${formatShortDate(input.targetDate)}.`,
    ` From ${formatInValue(input.currentIn)} in to ${formatInValue(input.goalIn)} in`,
    ` is ${formatRateInPerWk(pace)}.`,
  ].join('');
}

/** The line the three-day week earns, verbatim (brief section 05 "Setup"). */
export const THREE_DAY_LINE =
  'At 3 days a week, missing one session repeats the week (under 75%).';

/** Millimetres from an inch reading, for the columns that store millimetres. */
export function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4 * 10) / 10;
}

/** Inches from a stored millimetre reading, for a field that shows one. */
export function mmToInches(mm: number): number {
  return Math.round(mmToIn(mm) * 10) / 10;
}
