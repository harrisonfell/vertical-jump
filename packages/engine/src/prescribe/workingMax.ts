/**
 * The working max per lift.
 *
 * Safety override (brief section 09): the working max is frozen at generation
 * and monotone rather than recomputed live from the heaviest set, which would
 * ratchet the estimate down about 6.5 percent per cycle. It is the maximum of
 * an entered 1RM (R72) and the best Epley over qualifying sets of the last
 * four weeks (R73, 10 reps or fewer). Epley-only maxes carry a 0.95 confidence
 * factor (house) until a set at RPE 8 or higher with 6 or fewer reps exists.
 * It rises only when a logged set's Epley exceeds it, by at most 5 percent per
 * week, and falls only via R97. Olympic lifts never use Epley (safety
 * override). The app never schedules a true 1RM attempt.
 */
import type { IsoInstant } from '../types/calendar.js';
import type { LiftId, WorkingMaxSource } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { Athlete, BestSet, WorkingMax } from '../types/athlete.js';
import type { SetLog } from '../types/logs.js';
import type { Ruleset } from '../types/ruleset.js';
import {
  TIMES,
  floorToStep,
  formatLoadLb,
  kgToLb,
  lbToKg,
  roundHalfUp,
  roundLoadLb,
  type LoadGrid,
} from '../units.js';

const MS_PER_DAY = 86400000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** One candidate estimate, kept so the Lifts row can say where it came from. */
export interface WorkingMaxCandidate {
  valueKg: number;
  source: 'entered' | 'epley' | 'rpe';
  /** The set the estimate came from, for "Epley from 265 lb x 3". */
  fromLog?: SetLog;
  /** 1.0 for entered, 0.95 for an unconfirmed Epley estimate. */
  confidence: number;
}

/** Epley: weight x (1 + reps / 30). Pure, no rounding, no confidence factor. */
export function epley(weightKg: number, reps: number): number {
  if (weightKg <= 0) throw new RangeError('weightKg must be positive');
  if (!Number.isInteger(reps) || reps < 1) throw new RangeError('reps must be a positive integer');
  return weightKg * (1 + reps / 30);
}

/** The grid a lift's max is stored on, so the shown percentages land clean. */
function gridForLift(exercise: Exercise): LoadGrid {
  if (exercise.requiresBarbell) return 'barbell';
  if (exercise.equipment.includes('dumbbell') || exercise.equipment.includes('kettlebell')) {
    return 'dumbbell';
  }
  return 'barbell';
}

function snapKg(valueKg: number, grid: LoadGrid, stepLb: number): number {
  return lbToKg(roundLoadLb(roundHalfUp(kgToLb(valueKg), 6), grid, stepLb));
}

/**
 * The best qualifying Epley estimate over `logs`, or null when none qualifies.
 * Qualifying means 10 reps or fewer, inside the lookback window, for a lift
 * that is neither an Olympic lift nor a tendon row. The confidence factor is
 * folded into the value.
 */
export function bestEpley(
  logs: SetLog[],
  exercise: Exercise,
  ruleset: Ruleset,
  asOf: IsoInstant,
): WorkingMaxCandidate | null {
  if (exercise.isOlympicLift) return null;
  // A heavy slow resistance row carries a load the athlete types, but a slow
  // eight-rep calf raise is a tendon exposure and not a strength attempt: an
  // Epley estimate off it is noise, and a working max nobody prescribes from
  // would still be shown, dropped by R97 and charted as a lift. It stays in
  // RPE mode for its whole life, which is why the load never has to become a
  // one-rep max to be useful.
  if (exercise.tendonMode === 'slow_resistance') return null;
  const rules = ruleset.constants.workingMax;
  const asOfMs = Date.parse(asOf);
  const cutoff = asOfMs - rules.epleyLookbackWeeks * MS_PER_WEEK;

  const mine = logs
    .filter((log) => log.exerciseId === exercise.id)
    .sort((a, b) =>
      a.completedAt === b.completedAt
        ? a.idempotencyKey.localeCompare(b.idempotencyKey)
        : a.completedAt.localeCompare(b.completedAt),
    );

  let best: { value: number; log: SetLog } | null = null;
  let confirmed = false;
  for (const log of mine) {
    const reps = log.repsDone;
    const loadKg = log.loadKg;
    if (reps === undefined || loadKg === undefined) continue;
    if (!Number.isInteger(reps) || reps < 1 || loadKg <= 0) continue;
    if (reps > rules.epleyMaxReps) continue;
    const at = Date.parse(log.completedAt);
    if (!Number.isFinite(at) || at < cutoff || at > asOfMs) continue;
    if (log.rpe !== undefined && log.rpe >= rules.rpeQualifyMin && reps <= rules.rpeQualifyMaxReps) {
      confirmed = true;
    }
    const value = epley(loadKg, reps);
    if (best === null || value > best.value) best = { value, log };
  }
  if (best === null) return null;
  const confidence = confirmed ? 1 : rules.epleyConfidence;
  return {
    valueKg: best.value * confidence,
    source: 'epley',
    fromLog: best.log,
    confidence,
  };
}

/**
 * Resolve one lift's working max, frozen at `asOf`.
 *
 * `previous` is the value already frozen, which the monotone rule measures
 * against: the result never rises more than `maxRaisePctPerWeek` in a week,
 * measured from the last raise, and never falls except through
 * `applyFailureDrop`. A lift with no entered max and no qualifying log comes
 * back at 0 kg with source `rpe`, which is the engine's "run RPE mode" signal.
 */
export function resolveWorkingMax(
  lift: LiftId,
  exercise: Exercise,
  previous: WorkingMax | undefined,
  enteredOneRmKg: number | null,
  logs: SetLog[],
  ruleset: Ruleset,
  asOf: IsoInstant,
): WorkingMax {
  const rules = ruleset.constants.workingMax;
  const grid = gridForLift(exercise);
  const stepLb = ruleset.constants.loadGrid.barbellStepLb;
  const candidate = bestEpley(logs, exercise, ruleset, asOf);
  const entered = enteredOneRmKg !== null && enteredOneRmKg > 0 ? enteredOneRmKg : null;

  let source: WorkingMaxSource;
  let confidence: number;
  let rawKg: number;
  if (entered !== null && (candidate === null || entered >= candidate.valueKg)) {
    source = 'entered';
    confidence = 1;
    rawKg = entered;
  } else if (candidate !== null) {
    source = 'epley';
    confidence = candidate.confidence;
    rawKg = candidate.valueKg;
  } else if (previous !== undefined) {
    return { ...previous, frozenAt: asOf };
  } else {
    return {
      lift,
      valueKg: 0,
      source: 'rpe',
      confidence: 0,
      frozenAt: asOf,
      failStreak: 0,
    };
  }

  let valueKg = snapKg(rawKg, grid, stepLb);

  if (previous !== undefined) {
    if (valueKg <= previous.valueKg) {
      return { ...previous, frozenAt: asOf };
    }
    const since = Date.parse(previous.lastRaiseAt ?? previous.frozenAt);
    const weeks = Number.isFinite(since)
      ? Math.max(0, Math.floor((Date.parse(asOf) - since) / MS_PER_WEEK))
      : 0;
    const allowedKg = previous.valueKg * (1 + (rules.maxRaisePctPerWeek / 100) * weeks);
    if (valueKg > allowedKg) {
      const cappedLb = floorToStep(roundHalfUp(kgToLb(allowedKg), 6), stepLb);
      valueKg = lbToKg(cappedLb);
    }
    if (valueKg <= previous.valueKg) {
      return { ...previous, frozenAt: asOf };
    }
  }

  return {
    lift,
    valueKg,
    source,
    confidence,
    frozenAt: asOf,
    lastRaiseAt: asOf,
    failStreak: previous?.failStreak ?? 0,
  };
}

/**
 * R97: a logged failed set drops the lift 5 percent, 10 percent on a second
 * consecutive failure. The only way a working max falls. The result is snapped
 * to the 5 lb barbell grid, which is the grid every percentage is shown on.
 */
export function applyFailureDrop(
  current: WorkingMax,
  ruleset: Ruleset,
  asOf: IsoInstant,
): WorkingMax {
  const magnitudes = ruleset.constants.outcomeMagnitudes;
  const dropPct =
    current.failStreak >= 1 ? magnitudes.secondFailureDropPct : magnitudes.holdWorkingMaxDropPct;
  const stepLb = ruleset.constants.loadGrid.barbellStepLb;
  const droppedLb = roundLoadLb(
    roundHalfUp(kgToLb(current.valueKg) * (1 - dropPct / 100), 6),
    'barbell',
    stepLb,
  );
  return {
    ...current,
    valueKg: lbToKg(droppedLb),
    failStreak: current.failStreak + 1,
    frozenAt: asOf,
  };
}

/**
 * Week-2 guard (R107, house): when the max came from week-1 RPE logs, the top
 * set is capped at 80 percent in that lift's first percent week. An entered
 * 1RM is not guarded, because with a 1RM in hand week 1 already ran on
 * percentages under the week-1 80 percent house cap, so week 2 is no longer
 * that lift's first percent week.
 */
export function week2GuardCapPct(
  workingMax: WorkingMax,
  isFirstPercentWeekForLift: boolean,
  levelCapPct: number,
  ruleset: Ruleset,
): number {
  if (!isFirstPercentWeekForLift) return levelCapPct;
  if (workingMax.source === 'entered') return levelCapPct;
  return Math.min(levelCapPct, ruleset.constants.workingMax.week2GuardPct);
}

/**
 * The same guard as a ramp: 80 percent in the lift's first percent week, then
 * one 5 percent step per week to the level cap.
 */
export function guardCapPctForPercentWeek(
  workingMax: WorkingMax,
  percentWeekIndexForLift: number,
  levelCapPct: number,
  ruleset: Ruleset,
): number {
  if (workingMax.source === 'entered') return levelCapPct;
  const constants = ruleset.constants;
  const step = constants.outcomeMagnitudes.progressStartStepPct;
  const index = Math.max(0, Math.floor(percentWeekIndexForLift));
  return Math.min(levelCapPct, constants.workingMax.week2GuardPct + step * index);
}

/**
 * Brief section 13, "New lift without a max": the one line Today, the Lifts
 * section and Progress all show for a lift that has no working max yet. It
 * lives beside `workingMaxSourceLine` so the two cannot drift apart.
 */
export const NO_MAX_LINE = 'No 1RM yet · log load and effort; prescribed after 2 sets';

/**
 * The "entered 275 lb" or "est. 275 lb, Epley from 265 lb x 3" line the runner
 * and the Lifts section show. Built from the units formatters.
 */
export function workingMaxSourceLine(workingMax: WorkingMax, fromLog?: SetLog): string {
  if (workingMax.valueKg <= 0) return 'no max yet, RPE mode';
  const value = formatLoadLb(kgToLb(workingMax.valueKg));
  if (workingMax.source === 'entered') return `entered ${value}`;
  const reps = fromLog?.repsDone;
  const loadKg = fromLog?.loadKg;
  if (reps !== undefined && loadKg !== undefined) {
    return `est. ${value} · Epley from ${formatLoadLb(kgToLb(loadKg))} ${TIMES} ${reps}`;
  }
  return `est. ${value}`;
}

/* ------------------------------------------------- entered revisions (R72) */

/**
 * A 1RM or rep-max the athlete typed, with the instant they typed it.
 *
 * INTERFACE_GAP: `WorkingMax` records `frozenAt` and `lastRaiseAt` but nothing
 * says when the athlete entered the number behind it, and `Athlete` stores an
 * entered 1RM as a `WorkingMax` row with source `entered`. Until the data
 * model carries an entry instant, callers pass one here.
 */
export interface EnteredOneRm {
  /** The load typed, in kilograms. On an added-load lift, the added load. */
  valueKg: number;
  /** Reps that load is for: 1 for a true 1RM, 5 for a working 5RM (R73). */
  reps: number;
  /** When the athlete typed it. */
  enteredAt: IsoInstant;
}

/**
 * The 1RM one entry implies: R72 straight through at one rep, R73's Epley
 * above it with the house confidence factor, because a rep max entered from
 * memory is an estimate and not a tested single.
 */
export function enteredMaxCandidate(entered: EnteredOneRm, ruleset: Ruleset): WorkingMaxCandidate {
  if (entered.valueKg <= 0) throw new RangeError('entered valueKg must be positive');
  const reps = Math.max(1, Math.trunc(entered.reps));
  if (reps === 1) return { valueKg: entered.valueKg, source: 'entered', confidence: 1 };
  const confidence = ruleset.constants.workingMax.epleyConfidence;
  return { valueKg: epley(entered.valueKg, reps) * confidence, source: 'epley', confidence };
}

/** A working max snapped to the grid its percentages will be displayed on. */
export function snapWorkingMaxKg(valueKg: number, grid: LoadGrid, stepLb: number): number {
  return snapKg(valueKg, grid, stepLb);
}

/* --------------------------------------------------- entered best sets (R73) */

/**
 * A best recent set the athlete typed, as the set log R73 already reads.
 *
 * The entry is a retro-logged set, so it is folded into the log stream rather
 * than given a path of its own: `bestEpley` then applies the four-week
 * lookback, the 10-rep ceiling and the house confidence factor exactly as it
 * does for a set logged in the app, and the factor is WAIVED by the same
 * clause that waives it for a logged set (RPE 8 or higher at 6 reps or fewer).
 *
 * @param lift the lift the set belongs to.
 * @param best the reps, load, effort and day the athlete typed.
 */
export function bestSetLog(lift: LiftId, best: BestSet): SetLog {
  const log: SetLog = {
    id: `best-set:${lift}:${best.at}`,
    sessionId: `best-set:${lift}`,
    exerciseId: lift,
    setNumber: 1,
    repsDone: best.reps,
    loadKg: best.loadKg,
    loadSource: 'entered',
    completedAt: `${best.at}T12:00:00.000Z`,
    plannedDate: best.at,
    idempotencyKey: `best-set:${lift}:${best.at}`,
  };
  if (best.rpe !== undefined) log.rpe = best.rpe;
  return log;
}

/**
 * Every best set on the athlete's profile, as set logs. Empty for an athlete
 * who typed none, which is every athlete the field was added for.
 */
export function bestSetLogs(athlete: Pick<Athlete, 'bestSets'>): SetLog[] {
  const entries = athlete.bestSets;
  if (entries === undefined) return [];
  const out: SetLog[] = [];
  for (const [lift, best] of Object.entries(entries)) {
    if (best === undefined) continue;
    if (best.reps < 1 || best.loadKg <= 0) continue;
    out.push(bestSetLog(lift, best));
  }
  return out.sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
}

/**
 * Whether an entry supersedes the value already frozen: true when the athlete
 * typed it after that value was frozen, and true when nothing is frozen yet.
 * Comparing against the freeze rather than against the entry itself is what
 * makes the replacement happen once: the week after, the freeze is newer than
 * the entry, so an R97 drop taken since is not undone.
 */
export function enteredRevisionApplies(
  previous: WorkingMax | undefined,
  entered: EnteredOneRm,
): boolean {
  if (previous === undefined) return true;
  const at = Date.parse(entered.enteredAt);
  const frozen = Date.parse(previous.frozenAt);
  if (!Number.isFinite(at) || !Number.isFinite(frozen)) return false;
  return at > frozen;
}

/**
 * `resolveWorkingMax` with R72 read as "the athlete's own number wins": a
 * revision typed after the stored value was frozen replaces that value at the
 * next freeze, downward included.
 *
 * The monotone rule exists so a submaximal week cannot ratchet an estimate
 * down; it was never meant to outlive the athlete correcting the number. The
 * owner's box squat is the case: 345 lb is stored, the 345 attempt fails, 320
 * lb is entered, and without this the stored 345 would survive every freeze
 * because 320 is lower. `failStreak` resets, because the revision already
 * accounts for the failure that prompted it.
 *
 * An entry that is not newer than the freeze is not read at all: the call
 * falls through to `resolveWorkingMax` with no entered value, which is the
 * same convention the generator already follows, so a revision cannot climb
 * back over an R97 drop taken after it.
 *
 * @param bestSet a best recent set the athlete typed for this lift, read as an
 *   Epley source (R73) alongside the logs. Its confidence factor is waived on
 *   the same terms a logged set's is: RPE 8 or higher at 6 reps or fewer.
 *   The 1RM entry still wins the freeze it is read on, because a number the
 *   athlete typed as their max outranks an estimate from a working set; the
 *   best set is what the NEXT weekly freeze reads.
 */
export function resolveWorkingMaxWithEntry(
  lift: LiftId,
  exercise: Exercise,
  previous: WorkingMax | undefined,
  entered: EnteredOneRm | null,
  logs: SetLog[],
  ruleset: Ruleset,
  asOf: IsoInstant,
  bestSet?: BestSet | null,
): WorkingMax {
  const withBest =
    bestSet === undefined || bestSet === null ? logs : [...logs, bestSetLog(lift, bestSet)];
  if (entered === null || !enteredRevisionApplies(previous, entered)) {
    // The entry is read once, at the freeze after it was typed. Re-reading it
    // every week would let it climb back over an R97 drop taken since.
    return resolveWorkingMax(lift, exercise, previous, null, withBest, ruleset, asOf);
  }
  const candidate = enteredMaxCandidate(entered, ruleset);
  const stepLb = ruleset.constants.loadGrid.barbellStepLb;
  const valueKg = snapKg(candidate.valueKg, gridForLift(exercise), stepLb);
  const resolved: WorkingMax = {
    lift,
    valueKg,
    source: candidate.source,
    confidence: candidate.confidence,
    frozenAt: asOf,
    // The revision re-anchors the monotone clock, up or down. The +5 percent
    // per week ceiling is measured from the last time the number was SET, and
    // the athlete has just set it: the owner's 320 lb entry is a fresh
    // statement, not a value that has been sitting there earning headroom, so
    // the next rise off it may only come a week later. Without this a downward
    // revision would arrive with weeks of accumulated allowance behind it and
    // a logged set could jump the max the same day it was entered.
    lastRaiseAt: asOf,
    failStreak: 0,
  };
  return resolved;
}
