/**
 * Block 4 volume for one session: how many sets and reps each row carries
 * before Block 6 puts a load on them.
 *
 * The two plyometric budgets live here. Extensive contacts sit inside the
 * level range on the Power day (R82 to R84) and are traded against
 * high-intensity contacts by R89; high-intensity contacts are capped at 25 per
 * session (R85) and high-amplitude contacts at 20 (R52), both hard caps.
 * Conventions (brief section 09): every landing counts, so a depth jump is 2
 * contacts per rep and 10 reps is the binding cap once the test's 5 attempts
 * are counted; each change-of-direction cut is one extensive contact; the
 * warm-up carries none; primer pogos count as extensive.
 *
 * Rest is one displayed value, the longest applicable rule (R164).
 */
import { CONTACT_CAPS, clamp, computeExtensiveTarget, depthJumpRepBudget } from '../budgets.js';
import { isCalfVolume } from './sport.js';
import type { ExerciseId, ExerciseRole, LoadType } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SetPrescription } from '../types/plan.js';
import type { TemplateOptions } from './order.js';
import type { PlacedRow } from './trim.js';
import type { SelectContext } from './assemble.js';

/** Load types that always render as reps or time, never as a percent (R159). */
export const UNLOADED_LOAD_TYPES = new Set<LoadType>(['bodyweight', 'mobility', 'prehab']);

/**
 * House definition of a maximal CNS session, the contact half of it: this many
 * high-intensity contacts make one. Named here so the speed-climbing reactive
 * day can be held one contact below it.
 */
export const MAXIMAL_CNS_HIGH_INTENSITY_CONTACTS = 10;

/** Sets and reps one row was allocated. */
export interface Volume {
  sets: number;
  reps?: number;
  durationS?: number;
  distanceM?: number;
}

export function extensiveRepsFor(exercise: Exercise): number {
  switch (exercise.id) {
    case 'hurdle_hop':
      return 5;
    case 'box_jump':
      return 3;
    case 'tuck_jump':
      return 4;
    default:
      return 5;
  }
}

/** The rep band each extensive drill may be stretched into. */
export function extensiveRepBand(exercise: Exercise): { min: number; max: number } {
  switch (exercise.id) {
    case 'box_jump':
      return { min: 3, max: 6 };
    case 'tuck_jump':
      return { min: 3, max: 6 };
    default:
      return { min: 4, max: 8 };
  }
}

/** Sets and reps one extensive drill was allocated. */
export interface ExtensiveAllocation {
  sets: number;
  reps: number;
}

/**
 * Deterministic closest fit of the remaining extensive target across the
 * chosen drills. Canonical reps are tried first, so an exactly reachable
 * target keeps the rule-book set shapes (hurdle hops of 5, box jumps of 3);
 * only when no exact fit exists does the search stretch the rep band, and it
 * then prefers the smallest departure from the canonical reps.
 */
export function allocateExtensive(
  drills: readonly Exercise[],
  remaining: number,
  maxSets: number,
): ExtensiveAllocation[] {
  if (drills.length === 0) return [];
  const canonical = drills.map(extensiveRepsFor);
  const bands = drills.map(extensiveRepBand);
  const best: ExtensiveAllocation[] = drills.map((_, index) => ({ sets: 1, reps: canonical[index] ?? 5 }));
  let bestKey: [number, number, number] = [Number.POSITIVE_INFINITY, 0, 0];
  const current: ExtensiveAllocation[] = drills.map((_, index) => ({ sets: 1, reps: canonical[index] ?? 5 }));

  const better = (key: [number, number, number]): boolean => {
    for (let index = 0; index < 3; index += 1) {
      const a = key[index] ?? 0;
      const b = bestKey[index] ?? 0;
      if (a !== b) return index === 2 ? a > b : a < b;
    }
    return false;
  };

  const walk = (index: number): void => {
    if (index === drills.length) {
      let total = 0;
      let deviation = 0;
      let setsTotal = 0;
      for (let i = 0; i < drills.length; i += 1) {
        const entry = current[i];
        if (entry === undefined) continue;
        total += entry.sets * entry.reps;
        deviation += Math.abs(entry.reps - (canonical[i] ?? entry.reps));
        setsTotal += entry.sets;
      }
      const key: [number, number, number] = [Math.abs(total - remaining), deviation, setsTotal];
      if (better(key)) {
        bestKey = key;
        for (let i = 0; i < drills.length; i += 1) {
          const entry = current[i];
          if (entry !== undefined) best[i] = { sets: entry.sets, reps: entry.reps };
        }
      }
      return;
    }
    const band = bands[index] ?? { min: 4, max: 8 };
    const entry = current[index];
    if (entry === undefined) return;
    for (let sets = maxSets; sets >= 1; sets -= 1) {
      for (let reps = band.max; reps >= band.min; reps -= 1) {
        entry.sets = sets;
        entry.reps = reps;
        walk(index + 1);
      }
    }
  };
  walk(0);
  return best;
}

/**
 * R8 and R9 name "repetitive pogo and sprint volume": the low-amplitude fast
 * extensive drills and every sprint or change-of-direction run.
 */
export function isPogoOrSprint(exercise: Exercise): boolean {
  if (exercise.movementPattern === 'sprint' || exercise.movementPattern === 'cod') return true;
  const plyo = exercise.plyometric;
  return (
    plyo !== undefined &&
    plyo.category === 'extensive' &&
    plyo.amplitude === 'low' &&
    plyo.contactTime === 'fast'
  );
}

/** What is left of a volume after a Block 1 percentage cut (R8, R9). */
function keepFraction(pct: number | undefined): number {
  if (pct === undefined || !Number.isFinite(pct) || pct <= 0) return 1;
  return Math.max(0, 1 - Math.min(100, pct) / 100);
}

/**
 * R8 and R9 cut "by at least" their percentage, so the fraction is taken off
 * both dimensions of the volume and rounded down, never up. One set and one
 * rep are the floor: the drill stays in the session, at a token dose.
 */
function cutSetsReps(sets: number, reps: number, keep: number): { sets: number; reps: number } {
  if (keep >= 1) return { sets, reps };
  return {
    sets: Math.max(1, Math.floor(sets * keep)),
    reps: Math.max(1, Math.floor(reps * keep)),
  };
}

/**
 * House `house.sc.sport_requirements`: the speed-climbing Speed day is a
 * reactive day rather than an extensive-only one, so it may carry approach,
 * seated and quick-contact jumps. It follows the Power day, so R90 and R91
 * hold it one contact below the maximal-CNS threshold. Every other day and
 * every other sport keeps the R85 cap alone.
 */
function reactiveDayHighCap(context: SelectContext): number {
  if (context.athlete.sport !== 'speed_climbing') return Number.POSITIVE_INFINITY;
  if (context.session.dayType !== 'speed') return Number.POSITIVE_INFINITY;
  return MAXIMAL_CNS_HIGH_INTENSITY_CONTACTS - 1;
}

/**
 * House `house.sc.calf_volume_low`: the calf and Achilles rows this session
 * carries never run more than the ruleset's set cap. The pool filter has
 * already kept them off every day but the week's calf day.
 */
function capCalfVolume(
  rows: readonly PlacedRow[],
  volumes: Map<ExerciseId, Volume>,
  context: SelectContext,
  factor: number,
): void {
  if (context.athlete.sport !== 'speed_climbing') return;
  const cap = context.ruleset.constants.climbing.calfSetsCap;
  for (const row of rows) {
    const exercise = row.exercise;
    if (!isCalfVolume(exercise)) continue;
    const planned = volumes.get(exercise.id);
    const sets = Math.min(
      planned?.sets ?? Math.max(1, Math.round(exercise.defaultSets * factor)),
      Math.max(1, cap),
    );
    const volume: Volume = { ...(planned ?? {}), sets };
    if (exercise.displayMode === 'time' && volume.durationS === undefined) {
      volume.durationS = exercise.holdSecondsRange?.minS ?? 30;
    }
    volumes.set(exercise.id, volume);
  }
}

export function planVolume(rows: readonly PlacedRow[], context: SelectContext, options: TemplateOptions): {
  volumes: Map<ExerciseId, Volume>;
  targetExtensive: number;
} {
  const constants = context.ruleset.constants;
  const { week } = context;
  const targets = week.targets;
  const factor = week.kind === 'load' ? 1 : week.kind === 'deload' ? constants.deload.volumeFactorMax : constants.taper.volumeFactor;
  // Block 1 runs first (Rule 0), so its cuts bind the budgets this function
  // spends: R4 halves the high-intensity contacts, R8 and R9 cut pogo and
  // sprint volume. The athlete-facing notice says both happened.
  const cuts = context.painGate.volumeCuts;
  const pogoSprintKeep = keepFraction(cuts.pogoSprintPct);
  const soreFactor =
    context.sorenessReduction === true ? constants.soreness.highIntensityFactor : 1;
  const highFactor = (cuts.highIntensityFactor ?? 1) * soreFactor;
  const highCap = Math.min(
    highFactor < 1
      ? Math.min(
          CONTACT_CAPS.highIntensityPerSession,
          Math.floor(targets.highIntensityAllowance * highFactor),
        )
      : CONTACT_CAPS.highIntensityPerSession,
    reactiveDayHighCap(context),
  );
  const volumes = new Map<ExerciseId, Volume>();
  let highSpent = 0;
  let extensiveSpent = 0;
  // R52 is a hard cap across every high-amplitude drill together, so the
  // running total is carried through the intensive rows as well as the
  // extensive fill below.
  let amplitudeSpent = 0;

  const testRow = rows.find((row) => row.block === 'jump_test');
  if (testRow !== undefined) {
    volumes.set(testRow.exercise.id, { sets: 1, reps: constants.contactCaps.testAttemptContacts });
    highSpent += constants.contactCaps.testAttemptContacts;
  }

  const primerRows = rows.filter((row) => row.block === 'primer' && row.exercise.plyometric !== undefined);
  primerRows.forEach((row, index) => {
    const sets = index === 0 ? constants.fixedTestPrimer.pogoSets : constants.fixedTestPrimer.submaxCmjSets;
    const base = index === 0 ? constants.fixedTestPrimer.pogoReps : constants.fixedTestPrimer.submaxCmjReps;
    const cut = cutSetsReps(
      Math.max(1, Math.round(sets * factor)),
      base,
      isPogoOrSprint(row.exercise) ? pogoSprintKeep : 1,
    );
    const scaled = cut.sets;
    const reps = cut.reps;
    const plyo = row.exercise.plyometric;
    volumes.set(row.exercise.id, { sets: scaled, reps });
    const contacts = scaled * reps * (plyo?.contactsPerRep ?? 1);
    extensiveSpent += contacts;
    if (plyo?.amplitude === 'high') amplitudeSpent += contacts;
  });

  const powerRows = rows.filter((row) => row.block === 'power');
  const depthRow = powerRows.find((row) => row.exercise.readinessRequired);
  if (depthRow !== undefined) {
    const budgeted = Math.min(targets.depthJumpReps, depthJumpRepBudget(highSpent, highCap));
    const reps = 2;
    const sets = clamp(Math.floor(budgeted / reps), 1, 5);
    volumes.set(depthRow.exercise.id, { sets, reps });
    highSpent += sets * reps * CONTACT_CAPS.depthJumpContactsPerRep;
    amplitudeSpent += sets * reps * CONTACT_CAPS.depthJumpContactsPerRep;
  }
  for (const row of powerRows) {
    if (row === depthRow) continue;
    const plyo = row.exercise.plyometric;
    if (plyo === undefined || plyo.category !== 'intensive') continue;
    const remainingHigh = highCap - highSpent;
    const perSet = 3 * plyo.contactsPerRep;
    let sets = clamp(Math.floor(remainingHigh / perSet), 0, Math.round(3 * factor * soreFactor));
    if (plyo.amplitude === 'high') {
      const room = CONTACT_CAPS.highAmplitudePerSession - amplitudeSpent;
      sets = clamp(Math.floor(room / perSet), 0, sets);
    }
    // A row the budget cannot pay for is recorded at zero sets, never left
    // without a volume: falling through to the exercise default would put its
    // full set count back on the session and blow R85 or R52.
    if (sets <= 0) {
      volumes.set(row.exercise.id, { sets: 0, reps: 3 });
      continue;
    }
    volumes.set(row.exercise.id, { sets, reps: 3 });
    highSpent += sets * perSet;
    if (plyo.amplitude === 'high') amplitudeSpent += sets * perSet;
  }

  // Brief section 13 tendon line: the jump day's tendon row carries one extra
  // set on a depth-jump week ("calf iso Sat (+1 set: depth-jump week)").
  if (depthRow !== undefined) {
    for (const row of rows) {
      if (row.role !== 'tendon') continue;
      const exercise = row.exercise;
      const base = Math.max(1, Math.round(exercise.defaultSets * factor));
      const volume: Volume = { sets: base + 1 };
      if (exercise.displayMode === 'time') {
        volume.durationS = exercise.holdSecondsRange?.minS ?? 30;
      }
      volumes.set(exercise.id, volume);
    }
  }

  for (const row of rows.filter((entry) => entry.block === 'cod' || entry.block === 'conditioning')) {
    const keep = isPogoOrSprint(row.exercise) ? pogoSprintKeep : 1;
    const sets = cutSetsReps(Math.max(1, Math.round(row.exercise.defaultSets * factor)), 1, keep).sets;
    const volume: Volume = { sets, reps: 1 };
    if (row.exercise.sprintDistanceM !== undefined) volume.distanceM = row.exercise.sprintDistanceM;
    volumes.set(row.exercise.id, volume);
    extensiveSpent += sets * (row.exercise.codCutsPerRep ?? 0);
  }

  // House `house.sc.readiness_gate`: "volume held" means this week's raise is
  // not taken today. One progressed week is exactly one step of the R89
  // formula, so the target is rebuilt at the previous k rather than cut by a
  // second magnitude of its own.
  const k = context.holdExtensiveRaise === true ? Math.max(0, week.k - 1) : week.k;
  const targetExtensive = Math.round(
    computeExtensiveTarget(
      targets.extensiveBottom,
      targets.extensiveTop,
      k,
      Math.max(targets.highIntensityAllowance, highSpent),
      constants.r89.extensiveStepPerWeek,
      constants.r89.highIntensityFactor,
    ) * factor,
  );

  const extensiveDrills = powerRows
    .filter((row) => row.exercise.plyometric?.category === 'extensive' && !volumes.has(row.exercise.id))
    .map((row) => row.exercise);
  const remaining = Math.max(0, targetExtensive - extensiveSpent);
  const maxSets = options.reducedWeek ? 3 : 6;
  const allocation = allocateExtensive(extensiveDrills, remaining, maxSets);
  extensiveDrills.forEach((exercise, index) => {
    const entry = allocation[index] ?? { sets: 1, reps: extensiveRepsFor(exercise) };
    let sets = entry.sets;
    let reps = entry.reps;
    // R52 is a hard cap: a high-amplitude drill takes what room is left, at a
    // shorter set if a full one will not fit, and drops out when none is.
    if (exercise.plyometric?.amplitude === 'high') {
      const contactsPerRep = exercise.plyometric.contactsPerRep;
      const room = CONTACT_CAPS.highAmplitudePerSession - amplitudeSpent;
      const perSet = Math.max(1, reps * contactsPerRep);
      if (room < perSet) {
        reps = Math.floor(room / Math.max(1, contactsPerRep));
        sets = reps >= 1 ? 1 : 0;
      } else {
        sets = clamp(Math.floor(room / perSet), 0, sets);
      }
      amplitudeSpent += sets * reps * contactsPerRep;
    } else {
      sets = Math.max(1, sets);
    }
    if (isPogoOrSprint(exercise)) {
      const cut = cutSetsReps(sets, reps, pogoSprintKeep);
      sets = cut.sets;
      reps = cut.reps;
    }
    volumes.set(exercise.id, { sets, reps });
  });

  capCalfVolume(rows, volumes, context, factor);
  return { volumes, targetExtensive };
}

export function repsForLoadType(exercise: Exercise, context: SelectContext, setIndex: number): number {
  const scheme = context.ruleset.constants.schemes[exercise.loadType];
  const descent = scheme.repDescent;
  if (descent !== null && descent.length > 0) {
    return descent[Math.min(setIndex, descent.length - 1)] ?? descent[descent.length - 1] ?? 5;
  }
  return scheme.reps?.top ?? 8;
}

export function provisionalRestFor(exercise: Exercise, role: ExerciseRole, sets: number, context: SelectContext): { restS: number; restRule: string } {
  const bounds = context.ruleset.constants.restBoundsS;
  const candidates: { value: number; rule: string }[] = [];
  const plyo = exercise.plyometric;
  if (exercise.loadType === 'mobility' || exercise.loadType === 'prehab') {
    candidates.push({ value: bounds.prehabMobility, rule: 'prehab and mobility rest' });
  } else if (plyo === undefined && exercise.movementPattern !== 'sprint' && exercise.movementPattern !== 'cod') {
    const band = sets >= 6 ? bounds.sets6to7 : sets >= 4 ? bounds.sets4to5 : bounds.sets2to3;
    const upper = role === 'main_lift' || role === 'secondary';
    candidates.push({ value: upper ? band.top : band.bottom, rule: 'set count' });
  }
  if (plyo !== undefined && plyo.isMaximalJump) candidates.push({ value: bounds.maximalJump, rule: 'maximal jumps' });
  if (plyo !== undefined && !plyo.isMaximalJump) candidates.push({ value: bounds.extensiveDrill, rule: 'extensive drill' });
  if (exercise.movementPattern === 'sprint' || exercise.movementPattern === 'cod') {
    candidates.push({ value: bounds.sprint, rule: 'sprint and change of direction' });
  }
  if (exercise.fatigueCost === 'high') candidates.push({ value: 120, rule: 'high fatigue cost' });
  if (candidates.length === 0) candidates.push({ value: bounds.accessory, rule: 'accessory' });
  const longest = candidates.reduce((best, entry) => (entry.value > best.value ? entry : best));
  return { restS: longest.value, restRule: `Longest applicable rest: ${longest.rule}` };
}

/**
 * R105: a reduced week prescribes at or under half the prior week's working
 * reps. Halving the set count alone leaves a 3-set row at two thirds, so a
 * non-loadable row's reps come down with it. Loadable rows keep the brief's
 * worked shape (lowest reps, halved sets) because Block 6 rewrites them.
 */
function plannedFor(exercise: Exercise, context: SelectContext, factor: number): Volume {
  const sets = Math.max(1, Math.round(exercise.defaultSets * factor));
  if (factor >= 1 || exercise.displayMode !== 'reps') return { sets };
  if (exercise.loadable && !UNLOADED_LOAD_TYPES.has(exercise.loadType)) return { sets };
  let baseTotal = 0;
  for (let index = 0; index < exercise.defaultSets; index += 1) {
    baseTotal += repsForLoadType(exercise, context, index);
  }
  const target = Math.round(baseTotal * factor);
  return { sets, reps: Math.max(1, Math.floor(target / sets)) };
}

/** R8, R9: take the cut off the reps where there are reps, off the sets otherwise. */
function cutPogoSprint(planned: Volume, exercise: Exercise, keep: number): Volume {
  if (keep >= 1 || !isPogoOrSprint(exercise)) return planned;
  const cut = cutSetsReps(planned.sets, planned.reps ?? 1, keep);
  const out: Volume = { ...planned, sets: cut.sets };
  if (planned.reps !== undefined) out.reps = cut.reps;
  return out;
}

export function buildSets(
  exercise: Exercise,
  role: ExerciseRole,
  volume: Volume | undefined,
  context: SelectContext,
): SetPrescription[] {
  const constants = context.ruleset.constants;
  const factor = context.week.kind === 'load' ? 1 : context.week.kind === 'deload' ? constants.deload.volumeFactorMax : constants.taper.volumeFactor;
  // R8 and R9 cut pogo and sprint volume. `planVolume` already cut the rows it
  // budgeted; a row it left to the exercise default is cut here instead, so a
  // sprint chosen into the power block comes down too.
  const planned =
    volume ??
    cutPogoSprint(
      plannedFor(exercise, context, factor),
      exercise,
      keepFraction(context.painGate.volumeCuts.pogoSprintPct),
    );
  const { restS, restRule } = provisionalRestFor(exercise, role, planned.sets, context);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < planned.sets; index += 1) {
    const set: SetPrescription = {
      setNumber: index + 1,
      displayLoad: '',
      restS,
      restRule,
      isRamp: false,
      isHeld: false,
    };
    if (exercise.displayMode === 'time') {
      set.durationS = planned.durationS ?? exercise.holdSecondsRange?.minS ?? 30;
    } else if (exercise.displayMode === 'distance') {
      set.distanceM = planned.distanceM ?? exercise.sprintDistanceM ?? 10;
      set.reps = planned.reps ?? 1;
    } else {
      set.reps = planned.reps ?? repsForLoadType(exercise, context, index);
    }
    rows.push(set);
  }
  return rows;
}