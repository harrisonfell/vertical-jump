/**
 * The best recent set, per main lift.
 *
 * The owner does not know a true 1RM for the box squat; what they know is the
 * heaviest set they actually did, and how hard it was. R73 reads exactly that:
 * Epley over reps and load, discounted by the house 0.95 confidence factor
 * unless the set was a genuine near-max, which the rule book calls RPE 8 or
 * higher at 6 reps or fewer. So the athlete types the set and the engine does
 * the arithmetic; nothing here estimates a max.
 *
 * Everything is pure and every field is kept as typed, so a refusal never
 * clears what the athlete wrote.
 */
import { lbToKg, isLocalDate, kgToLb, roundHalfUp } from '@vert/engine';
import { TIMES, formatInteger, formatLoadLb } from '@vert/engine/units';
import type { BestSet } from '@vert/engine';
import type { LocalDate } from '@/data';
import { MAX_LIFT_IDS } from './liftIds';
import type { MaxesValues } from './maxLifts';
import { ADDED_LOAD_MAX_LB, ADDED_LOAD_MIN_LB, parseNumber } from './stepTwoValidation';

/** Which max field a best set belongs to. One per lift step 2 offers. */
export type BestSetField = keyof MaxesValues;

/** One typed set, exactly as it sits in the form. */
export interface BestSetValues {
  readonly reps: string;
  readonly loadLb: string;
  /** Null until a chip is tapped. Effort is optional; the load is not. */
  readonly rpe: number | null;
  readonly date: string;
}

/** The whole block's value: at most one set per lift. */
export type BestSetsDraft = Readonly<Partial<Record<BestSetField, BestSetValues>>>;

/**
 * The effort chips, 6 to 10 in half steps.
 *
 * Halves matter here rather than anywhere else in the app: 8.5 is the answer
 * that turns a set into a near-max at 2 reps, and rounding it to 8 or 9 would
 * change the estimate the athlete gets back.
 */
export const RPE_CHIPS: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** R73's near-max test: RPE 8 or higher at 6 reps or fewer. */
export const NEAR_MAX_RPE = 8;
export const NEAR_MAX_REPS = 6;

/** Reps a set can plausibly carry. Past this it is a conditioning set. */
export const BEST_SET_REPS_MIN = 1;
export const BEST_SET_REPS_MAX = 20;

/**
 * A barred load, on the same scale step 2's 1RM field uses, and said in the
 * same words: two refusals about the same number on one screen have to agree.
 */
export const BAR_LOAD_MIN_LB = 45;
export const BAR_LOAD_MAX_LB = 1000;
const BAR_LOAD_LINE = 'That load reads between 45 and 1,000 lb.';

/** The lift each field's set is stored under, which is the engine's own id. */
export const BEST_SET_LIFT_IDS: Readonly<Record<BestSetField, string>> = {
  squatLb: MAX_LIFT_IDS.squat,
  hingeLb: MAX_LIFT_IDS.hinge,
  pressLb: MAX_LIFT_IDS.press,
  boxSquatLb: MAX_LIFT_IDS.boxSquat,
  pullUpAddedLb: MAX_LIFT_IDS.pullUp,
};

/** True where the load typed is what hangs off the athlete, not a bar. */
export function isAddedLoadField(field: BestSetField): boolean {
  return field === 'pullUpAddedLb';
}

/** A blank set, dated today, which is the answer for a set done today. */
export function emptyBestSet(today: LocalDate): BestSetValues {
  return { reps: '', loadLb: '', rpe: null, date: today };
}

/** True when nothing was typed, which is a complete and valid answer. */
export function isBlankBestSet(values: BestSetValues | undefined): boolean {
  if (values === undefined) return true;
  return values.reps.trim() === '' && values.loadLb.trim() === '' && values.rpe === null;
}

/**
 * True when this set waives the 0.95 confidence factor (R73), so the caption
 * can say so on the set the athlete just typed rather than only in general.
 */
export function isNearMaxSet(reps: number | null, rpe: number | null): boolean {
  if (reps === null || rpe === null) return false;
  return rpe >= NEAR_MAX_RPE && reps <= NEAR_MAX_REPS;
}

export type BestSetErrorField = 'reps' | 'loadLb' | 'date';
export type BestSetErrors = Readonly<Partial<Record<BestSetErrorField, string>>>;

/** Every refusal one typed set carries. A blank set carries none. */
export function validateBestSet(
  values: BestSetValues | undefined,
  field: BestSetField,
  today: LocalDate,
): BestSetErrors {
  if (isBlankBestSet(values) || values === undefined) return {};
  const errors: { reps?: string; loadLb?: string; date?: string } = {};

  const reps = parseNumber(values.reps);
  if (reps === null) {
    errors.reps = 'Enter the reps you did.';
  } else if (
    !Number.isInteger(reps) ||
    reps < BEST_SET_REPS_MIN ||
    reps > BEST_SET_REPS_MAX
  ) {
    errors.reps = `Reps read between ${formatInteger(BEST_SET_REPS_MIN)} and ${formatInteger(BEST_SET_REPS_MAX)}.`;
  }

  const load = parseNumber(values.loadLb);
  const added = isAddedLoadField(field);
  const min = added ? ADDED_LOAD_MIN_LB : BAR_LOAD_MIN_LB;
  const max = added ? ADDED_LOAD_MAX_LB : BAR_LOAD_MAX_LB;
  if (load === null) {
    errors.loadLb = added ? 'Enter the load you hung.' : 'Enter the load you lifted.';
  } else if (load < min || load > max) {
    errors.loadLb = added
      ? `That load reads between ${formatInteger(min)} and ${formatInteger(max)} lb.`
      : BAR_LOAD_LINE;
  }

  const date = values.date.trim();
  if (!isLocalDate(date)) {
    errors.date = "That isn't a date. Use YYYY-MM-DD, for example 2026-08-31.";
  } else if (date > today) {
    errors.date = 'A set you have done is today or earlier.';
  }

  return errors;
}

/** True when any lift's set is refused, which is what blocks the step. */
export function bestSetsHaveErrors(draft: BestSetsDraft, today: LocalDate): boolean {
  return (Object.keys(draft) as BestSetField[]).some(
    (field) => Object.keys(validateBestSet(draft[field], field, today)).length > 0,
  );
}

/**
 * The stored document: `{ box_squat: { reps, loadKg, rpe?, at } }`.
 *
 * Blank and refused sets write nothing at all, so a half-typed row never
 * reaches R73 as a set the athlete did not claim.
 */
export function bestSetsFrom(
  draft: BestSetsDraft,
  today: LocalDate,
): Record<string, BestSet> {
  const out: Record<string, BestSet> = {};
  for (const field of Object.keys(draft) as BestSetField[]) {
    const values = draft[field];
    if (values === undefined || isBlankBestSet(values)) continue;
    if (Object.keys(validateBestSet(values, field, today)).length > 0) continue;
    const reps = parseNumber(values.reps);
    const load = parseNumber(values.loadLb);
    const lift = BEST_SET_LIFT_IDS[field];
    if (reps === null || load === null) continue;
    const set: BestSet = { reps: Math.round(reps), loadKg: lbToKg(load), at: values.date.trim() };
    if (values.rpe !== null) set.rpe = values.rpe;
    out[lift] = set;
  }
  return out;
}

/** One stored set read back into the form, or a blank one dated today. */
export function bestSetValuesFrom(
  stored: BestSet | undefined,
  today: LocalDate,
): BestSetValues {
  if (stored === undefined) return emptyBestSet(today);
  return {
    reps: `${stored.reps}`,
    loadLb: `${roundHalfUp(kgToLb(stored.loadKg), 0)}`,
    rpe: stored.rpe ?? null,
    date: stored.at,
  };
}

/** The whole block, read back off the stored document. */
export function bestSetsDraftFrom(
  stored: Readonly<Partial<Record<string, BestSet>>>,
  fields: readonly BestSetField[],
  today: LocalDate,
): BestSetsDraft {
  const draft: Partial<Record<BestSetField, BestSetValues>> = {};
  for (const field of fields) {
    draft[field] = bestSetValuesFrom(stored[BEST_SET_LIFT_IDS[field]], today);
  }
  return draft;
}

/**
 * "2 x 305 lb at RPE 8.5, counts as a near-max": the line under a typed set,
 * with the engine's own multiplication sign and load notation.
 * Null when nothing has been typed yet.
 */
export function bestSetSummary(values: BestSetValues | undefined): string | null {
  if (values === undefined || isBlankBestSet(values)) return null;
  const reps = parseNumber(values.reps);
  const load = parseNumber(values.loadLb);
  if (reps === null || load === null) return null;
  const effort = values.rpe === null ? '' : ` at RPE ${values.rpe}`;
  const near = isNearMaxSet(reps, values.rpe)
    ? ' · counts as a near-max'
    : ' · read at 95% until the effort says near-max';
  return `${reps} ${TIMES} ${formatLoadLb(load)}${effort}${near}`;
}
