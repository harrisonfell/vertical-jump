/**
 * Block 6: per-set load prescription. A display layer applied AFTER Blocks 1
 * to 5 have filtered, ordered and selected exercises (Rule 0). It never
 * changes selection.
 *
 * What it applies, in order:
 *  1. The scheme for the exercise's load type (R149, R150 to R153).
 *  2. The starting percent, low end of the range plus the week's offset (R156).
 *  3. The rep descent across distinct steps; held sets repeat the low value
 *     (R161, R155).
 *  4. Ramp sets at 60 and 70 percent for 6 to 7 set heavy protocols (R157),
 *     excluded from the all-reps check and the RPE prompt.
 *  5. Caps, lowest wins: the Block 1 pain cap scoped to the attribute it names
 *     (R163), 90 percent under 18 (R1), the level cap (R154), the ballistic
 *     ceiling (safety override), the week-2 80 percent guard (house).
 *  6. RPE mode when there is no working max (R74, R158, R76 in week 1).
 *  7. Rounding: barbells to the nearest 5 lb half up, falling back to the
 *     inventory plate increment; dumbbells to the nearest available, ties
 *     down; ballistic loads always down (R162).
 *  8. Rest via R164.
 *  9. Soreness and pain reductions, which keep the unreduced row in `original`.
 *
 * Week kinds drive three shapes of the same scheme. A load week ascends. A
 * deload or taper week keeps the top of the ladder and cuts the reps to the
 * lowest value, which is R105 read as "loads held, volume cut". A peak week
 * takes the bottom of the ladder and carries the rep descent one step further,
 * because the peak session sits five days before the target date and must
 * sharpen rather than fatigue.
 */
import type { Athlete } from '../types/athlete.js';
import type { LoadType } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SetPrescription } from '../types/plan.js';
import {
  formatOptionalAddedLoadRow,
  formatTempo,
  kgToLb,
  lbToKg,
  type LoadGrid,
} from '../units.js';
import { defaultRole, hasWorkingMax, type PrescribeContext } from './context.js';
import { resolveCapPctFrom } from './caps.js';
import {
  DEFAULT_BODYWEIGHT_REPS,
  ascendingPercents,
  applyTopSetCap,
  descendingRepsFrom,
  descentFor,
  distinctPercents,
  repsForSets,
  rpeForSet,
} from './scheme.js';
import {
  formatLoadedRow,
  formatRpeRow,
  gridFor,
  loadLbForPercent,
  retitleReps,
  snapLoadLb,
  stepLbFor,
} from './display.js';
import {
  baseRow,
  codRows,
  distanceRows,
  holdRows,
  unloadedRows,
  type RowContext,
} from './rows.js';
import { resolveRest } from './rest.js';
import { usesAddedLoad, withAddedLoadDisplay } from './pullUp.js';

/**
 * The added-load branch: a weighted pull-up's rows carry the ADDED load only,
 * so they read "5 x BW + 45 lb" instead of "5 x 45 lb". Everything upstream of
 * this, the ladder, the caps, the rounding, the rest and the soreness
 * reduction, is the same pass every other lift takes; only the string changes,
 * and every exercise `usesAddedLoad` does not recognize leaves untouched.
 */
function addedLoadPass(exercise: Exercise, rows: SetPrescription[]): SetPrescription[] {
  return usesAddedLoad(exercise) ? withAddedLoadDisplay(rows) : rows;
}

/**
 * Safety override: loaded jumps run a straight 3 x 3 at a fixed load, never the
 * power scheme. Beginner bodyweight, intermediate at most 20 percent of squat
 * max, advanced 30 percent, always rounded down, and every rep counts as a
 * high-intensity contact.
 */
function ballisticRows(context: RowContext, capPct: number): SetPrescription[] {
  const reps = context.scheme.repDescent?.[0] ?? 3;
  const workingMax = context.ctx.squatWorkingMax ?? context.ctx.workingMax;
  if (!hasWorkingMax(workingMax) || capPct <= 0) return unloadedRows(context, reps);
  const loadLb = loadLbForPercent(workingMax.valueKg, capPct, 'ballistic', context.stepLb);
  if (loadLb <= 0) return unloadedRows(context, reps);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < context.setCount; index += 1) {
    const row = baseRow(index + 1, context.rest);
    row.reps = reps;
    row.loadPercent = capPct;
    row.loadKg = lbToKg(loadLb);
    row.displayLoad = formatLoadedRow(reps, loadLb);
    rows.push(row);
  }
  return rows;
}

/**
 * R158 with R76: the only per-set display when there is no working max.
 *
 * @param rpeAt which effort a set carries, by 0-based index. The default is the
 *   ladder, which ascends across the sets of an ascending scheme. A straight
 *   scheme passes its own, because a row whose load is meant to be the same on
 *   every set cannot ask for a different effort on each one.
 */
function rpeRows(
  context: RowContext,
  reps: number[],
  rpeAt: (index: number) => number = (index) =>
    rpeForSet(index, context.athlete.level, context.ctx.isFirstProgramWeek1, context.ctx.ruleset),
): SetPrescription[] {
  // R105: a reduced week takes its volume off the reps as well as the sets,
  // in RPE mode exactly as in percent mode.
  const cap = context.ctx.reducedRepsCap;
  // R63, R61, R65: the cut never takes a set below its load type's rep floor.
  // Rule 0 puts Block 4's band above Block 5's deload magnitude.
  const floor = repFloorFor(context);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < reps.length; index += 1) {
    const raw = reps[index] ?? 1;
    const setReps = cap === undefined ? raw : Math.max(floor, Math.min(raw, cap));
    const dayRpeCap = context.ctx.dayRpeCap;
    const laddered = rpeAt(index);
    const rpe = dayRpeCap === undefined ? laddered : Math.min(laddered, dayRpeCap);
    const row = baseRow(index + 1, context.rest);
    row.reps = setReps;
    row.targetRpe = rpe;
    row.displayLoad = formatRpeRow(setReps, rpe);
    rows.push(row);
  }
  return rows;
}

function percentRows(
  context: RowContext,
  workingMaxKg: number,
  percents: number[],
  reps: number[],
  heldFrom: number,
  startSetNumber: number,
  isRamp: boolean,
): SetPrescription[] {
  const rows: SetPrescription[] = [];
  for (let index = 0; index < percents.length; index += 1) {
    const percent = percents[index] ?? 0;
    const setReps = reps[index] ?? reps[reps.length - 1] ?? 1;
    const loadLb = loadLbForPercent(workingMaxKg, percent, context.grid, context.stepLb);
    const row = baseRow(startSetNumber + index, context.rest);
    row.reps = setReps;
    row.loadPercent = percent;
    row.loadKg = lbToKg(loadLb);
    row.displayLoad = formatLoadedRow(setReps, loadLb);
    row.isRamp = isRamp;
    row.isHeld = !isRamp && index >= heldFrom;
    rows.push(row);
  }
  return rows;
}

/**
 * The lowest rep count this row's load type allows (R61 to R66). Block 4 owns
 * the band and Rule 0 puts it above Block 5's reduced-week magnitudes, so no
 * cut may push a set out of it.
 */
function repFloorFor(context: RowContext): number {
  const band = context.scheme.reps;
  const bottom = band?.bottom;
  if (bottom === undefined || !Number.isFinite(bottom) || bottom < 1) return 1;
  return Math.trunc(bottom);
}

function padFront(values: number[], length: number): number[] {
  const out = [...values];
  while (out.length < length) {
    const first = out[0];
    if (first === undefined) break;
    out.unshift(first);
  }
  return out;
}

function padBack(values: number[], length: number): number[] {
  const out = [...values];
  while (out.length < length) {
    const last = out[out.length - 1];
    if (last === undefined) break;
    out.push(last);
  }
  return out;
}

function loadableRows(context: RowContext): SetPrescription[] {
  const { ctx, scheme, setCount, athlete } = context;
  const constants = ctx.ruleset.constants;
  const cap = resolveCapPctFrom(context.exercise, athlete, ctx, ctx.painCaps, context.loadType);
  const descent = descentFor(scheme, athlete.level, ctx.useFiveThreeOne === true);
  const workingMax = ctx.workingMax;

  if (!hasWorkingMax(workingMax)) {
    return rpeRows(context, repsForSets(descent, setCount));
  }

  const offset = ctx.targets.startOffsetPct[context.loadType] ?? 0;
  const startPct = Math.min((scheme.startPct ?? 0) + offset, cap.capPct);
  const lowestReps = descent[descent.length - 1] ?? 1;

  if (scheme.mode === 'straight') {
    const percents = new Array<number>(setCount).fill(startPct);
    return percentRows(
      context,
      workingMax.valueKg,
      percents,
      repsForSets(descent, setCount),
      setCount,
      1,
      false,
    );
  }

  if (ctx.kind === 'deload' || ctx.kind === 'taper') {
    // R105 read as "loads held": the reduced week rebuilds the ladder the
    // preceding load week actually ran and takes its tail. Climbing to the
    // level cap here would prescribe a HIGHER top set than the week this one
    // unloads, which is the opposite of a deload.
    const priorSets = ctx.priorLoadWeekSets;
    const priorTop =
      priorSets === undefined
        ? cap.capPct
        : (applyTopSetCap(
            ascendingPercents(startPct, scheme.stepPct, Math.max(1, Math.trunc(priorSets))),
            cap.capPct,
          ).percents.at(-1) ?? cap.capPct);
    const ladder = distinctPercents(startPct, scheme.stepPct, Math.min(cap.capPct, priorTop));
    const tail = ladder.slice(Math.max(0, ladder.length - setCount));
    const percents = padFront(tail, setCount);
    // R105: loads are held and the volume comes off the reps and the sets,
    // but never below the load type's rep band (R61 to R66, Block 4).
    const floor = Math.min(lowestReps, repFloorFor(context));
    const capped = Math.max(floor, Math.min(lowestReps, ctx.reducedRepsCap ?? lowestReps));
    const reps = new Array<number>(setCount).fill(capped);
    return percentRows(context, workingMax.valueKg, percents, reps, setCount, 1, false);
  }

  if (ctx.kind === 'peak') {
    const ladder = distinctPercents(startPct, scheme.stepPct, cap.capPct);
    const percents = padBack(ladder.slice(0, setCount), setCount);
    const reps = descendingRepsFrom(lowestReps, setCount, scheme.reps?.bottom ?? 1);
    return percentRows(context, workingMax.valueKg, percents, reps, setCount, 1, false);
  }

  const rampPercents =
    context.loadType === 'heavy_strength' && setCount >= 6
      ? constants.rampSetPct.slice(0, Math.min(2, constants.rampSetPct.length))
      : [];
  const workingSets = Math.max(1, setCount - rampPercents.length);
  const raw = ascendingPercents(startPct, scheme.stepPct, workingSets);
  const capped = applyTopSetCap(raw, cap.capPct);
  const reps = repsForSets(descent, workingSets);

  const ramps =
    rampPercents.length > 0
      ? percentRows(
          context,
          workingMax.valueKg,
          rampPercents,
          new Array<number>(rampPercents.length).fill(descent[0] ?? 1),
          rampPercents.length,
          1,
          true,
        )
      : [];

  // R148 and R157: the ramp rows already used set numbers 1 and 2, so the
  // working sets carry on from there and no set number appears twice.
  const working = percentRows(
    context,
    workingMax.valueKg,
    capped.percents,
    reps,
    capped.heldFrom,
    rampPercents.length + 1,
    false,
  );
  return [...ramps, ...working];
}

/**
 * A tendon row whose load is the athlete's to add: `tendonMode` is
 * `slow_resistance` and the exercise is loadable, which in the seed is the
 * heavy slow calf raise.
 *
 * Prehab is unloaded as a load type, and reading it that way left this row as
 * a bare "8 x BW" with nowhere to record a dumbbell and no tempo, so the load
 * could never climb week to week. It is not a loaded row either: a bodyweight
 * calf raise is a complete set and is where most athletes start, so the weight
 * is offered rather than demanded.
 */
function isTendonRow(exercise: Exercise, loadType: LoadType): boolean {
  return loadType === 'prehab' && exercise.loadable && exercise.tendonMode === 'slow_resistance';
}

/**
 * The tendon row: reps and a tempo the athlete keeps, at bodyweight, with a
 * dumbbell they may add on top.
 *
 * There is no working max for a calf raise and an Epley estimate off a tendon
 * row would be noise, so the effort is stated and the load is typed (R74,
 * R158), which is what lets a weight reach the log at all. It is one effort
 * number across the sets rather than the ascending ladder, because the prehab
 * scheme is straight: the load is meant to be the same on every set. The
 * effort takes the top of the standing ladder, so the level cap and the week-1
 * cap both still bind it.
 *
 * An effort that comes in well under the target is the row's own signal that
 * bodyweight has stopped being heavy, which is the point at which a dumbbell
 * is worth adding.
 */
function tendonRows(context: RowContext): SetPrescription[] {
  const { scheme, ctx, athlete } = context;
  const fallback = scheme.repDescent?.[0] ?? DEFAULT_BODYWEIGHT_REPS;
  const reps = ctx.repsPerSet ?? fallback;
  const ladder = ctx.ruleset.constants.rpeLadder;
  const top = rpeForSet(
    Math.max(0, ladder.length - 1),
    athlete.level,
    ctx.isFirstProgramWeek1,
    ctx.ruleset,
  );
  const tempo = scheme.slowResistance;
  const line = tempo === undefined ? undefined : formatTempo(tempo.tempoUpS, tempo.tempoDownS);
  return rpeRows(context, new Array<number>(context.setCount).fill(reps), () => top).map((row) => {
    const next: SetPrescription = {
      ...row,
      optionalLoad: true,
      displayLoad: formatOptionalAddedLoadRow(row.reps ?? reps, row.targetRpe ?? top),
    };
    if (line !== undefined) next.detailLine = line;
    return next;
  });
}

function buildRows(context: RowContext): SetPrescription[] {
  const { exercise, loadType, scheme } = context;
  if (exercise.displayMode === 'distance') return distanceRows(context);
  if (exercise.displayMode === 'time') return holdRows(context);
  if (exercise.codCutsPerRep !== undefined) return codRows(context);
  if (isTendonRow(exercise, loadType)) return tendonRows(context);
  if (
    !exercise.loadable ||
    loadType === 'bodyweight' ||
    loadType === 'mobility' ||
    loadType === 'prehab' ||
    scheme.mode === 'none'
  ) {
    return unloadedRows(context);
  }
  if (loadType === 'ballistic') {
    const cap = resolveCapPctFrom(
      exercise,
      context.athlete,
      context.ctx,
      context.ctx.painCaps,
      loadType,
    );
    return ballisticRows(context, cap.capPct);
  }
  return loadableRows(context);
}

/**
 * One entry per set: set number, reps or duration or distance, load percent,
 * display load, target RPE, rest, ramp and held flags, and the original
 * prescription when reduced. Never a range, never a single percent for the
 * whole exercise (R148).
 */
export function getPerSetPrescription(
  exercise: Exercise,
  athlete: Athlete,
  weekContext: PrescribeContext,
): SetPrescription[] {
  const constants = weekContext.ruleset.constants;
  const loadType = weekContext.loadTypeOverride ?? exercise.loadType;
  const scheme = constants.schemes[loadType];
  const setCount = Math.max(1, Math.trunc(weekContext.sets));
  const role = weekContext.role ?? defaultRole(exercise);
  const rest = resolveRest(exercise, role, setCount, weekContext.ruleset);
  const grid = gridFor(exercise, loadType);
  const stepLb = stepLbFor(athlete, grid);

  const rows = buildRows({
    exercise,
    athlete,
    ctx: weekContext,
    loadType,
    scheme,
    setCount,
    rest,
    grid,
    stepLb,
  });

  // R27 drops "every lift" one tier. A row whose reps Block 4 allocated
  // against a contact budget (plyometrics, change of direction, sprints, the
  // weekly test's fixed 5 attempts) is not a lift rep count: adding reps there
  // would raise ground contacts past R82 to R85 on the sorest day of the week,
  // and Rule 0 puts Block 4 above this Block 6 display pass.
  if (isContactBudgeted(exercise)) return addedLoadPass(exercise, rows);
  return addedLoadPass(
    exercise,
    applySorenessReduction(
      rows,
      weekContext.sorenessToday,
      constants.soreness.repsAdd,
      constants.soreness.percentDrop,
      { grid, stepLb, threshold: constants.soreness.threshold },
    ),
  );
}

/**
 * Rows whose volume the contact budgets set, not the rep band: every
 * plyometric (the weekly jump test included), every change-of-direction drill
 * and every sprint. R27's rep bump never touches these.
 */
export function isContactBudgeted(exercise: Exercise): boolean {
  return (
    exercise.plyometric !== undefined ||
    exercise.codCutsPerRep !== undefined ||
    exercise.sprintDistanceM !== undefined ||
    exercise.loadType === 'ballistic'
  );
}

/** How the soreness reduction should round and when it should fire. */
export interface SorenessOptions {
  grid?: LoadGrid;
  stepLb?: number;
  threshold?: number;
}

/**
 * R27 read as "that workout only": every lift gets +2 reps per set and 10
 * percentage points off, high-intensity contacts halve and depth jumps are
 * removed, and a scheduled test is deferred. The unreduced row is kept in
 * `original` so the session detail can show both. Duration and distance rows
 * are untouched: a 30 s hold has no intensity tier to drop.
 */
export function applySorenessReduction(
  sets: SetPrescription[],
  sorenessToday: number | null | undefined,
  repsAdd: number,
  percentDrop: number,
  options: SorenessOptions = {},
): SetPrescription[] {
  const threshold = options.threshold ?? 7;
  if (sorenessToday === null || sorenessToday === undefined) return sets;
  if (!Number.isFinite(sorenessToday) || sorenessToday < threshold) return sets;
  const grid = options.grid ?? 'barbell';
  const stepLb = options.stepLb ?? 5;

  return sets.map((set) => {
    if (set.reps === undefined) return set;
    const original: SetPrescription = { ...set };
    delete original.original;
    const reps = set.reps + repsAdd;
    const reduced: SetPrescription = { ...set, reps, original };

    if (set.loadPercent !== undefined && set.loadPercent > 0 && set.loadKg !== undefined) {
      const percent = Math.max(0, set.loadPercent - percentDrop);
      const loadLb = snapLoadLb((kgToLb(set.loadKg) * percent) / set.loadPercent, grid, stepLb);
      reduced.loadPercent = percent;
      reduced.loadKg = lbToKg(loadLb);
      reduced.displayLoad = formatLoadedRow(reps, loadLb);
    } else {
      reduced.displayLoad = retitleReps(set.displayLoad, set.reps, reps);
    }
    return reduced;
  });
}

export * from './context.js';
export * from './scheme.js';
export * from './display.js';
export * from './caps.js';
export * from './rest.js';
export * from './workingMax.js';
export * from './pullUp.js';
