/**
 * The binding top-set cap, lowest wins.
 *
 * R154 caps by level (80, 87, 92); on the 5% grid those display as 80, 85 and
 * 90, because a step above the cap repeats the previous step (R155). R163
 * lowers the cap to 80% under a mild-pain rule, scoped to the attribute the
 * rule names. R1 caps at 90% under 18. The ballistic ceiling (safety override)
 * is a hard 0 / 20 / 30% of squat max that no progression rule may raise. The
 * week-2 guard (R107, house) holds a lift's first percent week at 80%.
 *
 * Safety override: `respectsLevelCap` is true for `power` in the shipped
 * ruleset, so R154's literal exemption for Olympic lifts is never reachable.
 */
import type { Athlete } from '../types/athlete.js';
import type { Exercise } from '../types/exercise.js';
import type { LoadType } from '../types/core.js';
import type { CappedAttribute, PainCaps, PainGateResult } from '../types/pain.js';
import type { PrescribeContext } from './context.js';
import { hasWorkingMax } from './context.js';
import { guardCapPctForPercentWeek } from './workingMax.js';

/** One cap that applied, with the plain words the runner shows. */
export interface CapCandidate {
  capPct: number;
  note: string;
}

/** Does an 80% pain cap scoped to `attribute` bind this exercise (R163)? */
export function painCapBinds(exercise: Exercise, attribute: CappedAttribute): boolean {
  switch (attribute) {
    case 'knee_stress':
      return exercise.kneeStress !== 'low';
    case 'spine_stress':
      return exercise.spineStress !== 'low';
    case 'shoulder_stress':
      return exercise.shoulderStress !== 'low';
    case 'axial_load':
      return exercise.isAxialLoad;
    case 'pressing':
      return exercise.isPressing;
    case 'overhead':
      return exercise.isOverhead;
    case 'all':
      return true;
  }
}

/**
 * The binding cap for one exercise this week, built from a `PainCaps` rather
 * than the whole Block 1 verdict so `getPerSetPrescription` can call it with
 * what its week context carries.
 */
export function resolveCapPctFrom(
  exercise: Exercise,
  athlete: Athlete,
  weekContext: PrescribeContext,
  painCaps: PainCaps | undefined,
  loadType: LoadType,
): { capPct: number; note: string | undefined } {
  const constants = weekContext.ruleset.constants;
  const scheme = constants.schemes[loadType];
  const candidates: CapCandidate[] = [];

  const levelCap = constants.levelTopSetCapPct[athlete.level];
  if (scheme.respectsLevelCap) {
    candidates.push({ capPct: levelCap, note: `Held at the ${levelCap}% cap` });
  }

  if (loadType === 'ballistic') {
    const ceiling = Math.min(
      constants.loadedJumpCeilingPct[athlete.level],
      exercise.ballisticCapPct ?? constants.loadedJumpCeilingPct[athlete.level],
    );
    candidates.push({
      capPct: ceiling,
      note: `Loaded jumps stay at ${ceiling}% of squat max`,
    });
  }

  if (!athlete.isAdult) {
    const under18 = constants.painCaps.under18CapPct;
    candidates.push({ capPct: under18, note: `Capped at ${under18}%: under 18` });
  }

  const caps = painCaps ?? weekContext.painCaps;
  const scopedPct = caps?.intensityPct;
  if (scopedPct !== undefined && caps !== undefined) {
    const binds = caps.scopedTo.some((attribute) => painCapBinds(exercise, attribute));
    if (binds) {
      const reason = weekContext.painCapReason ?? 'reported pain';
      candidates.push({ capPct: scopedPct, note: `Capped at ${scopedPct}%: ${reason}` });
    }
  } else if (weekContext.painCapPct !== undefined) {
    const reason = weekContext.painCapReason ?? 'reported pain';
    candidates.push({
      capPct: weekContext.painCapPct,
      note: `Capped at ${weekContext.painCapPct}%: ${reason}`,
    });
  }

  if (weekContext.dayCapPct !== undefined && scheme.mode === 'ascending') {
    candidates.push({
      capPct: weekContext.dayCapPct,
      note: weekContext.dayCapNote ?? `Held at the ${weekContext.dayCapPct}% cap`,
    });
  }

  if (weekContext.isFirstProgramWeek1 && scheme.mode === 'ascending') {
    const week1 = constants.workingMax.week2GuardPct;
    candidates.push({
      capPct: week1,
      note: `Week 1 top set held at ${week1}%`,
    });
  }

  if (hasWorkingMax(weekContext.workingMax) && scheme.mode === 'ascending') {
    const index = weekContext.percentWeekIndexForLift;
    const guard =
      index !== undefined
        ? guardCapPctForPercentWeek(weekContext.workingMax, index, levelCap, weekContext.ruleset)
        : weekContext.isFirstPercentWeekForLift && weekContext.workingMax.source !== 'entered'
          ? Math.min(levelCap, constants.workingMax.week2GuardPct)
          : levelCap;
    if (guard < levelCap) {
      candidates.push({ capPct: guard, note: `Capped at ${guard}%: first weeks on this lift` });
    }
  }

  if (candidates.length === 0) return { capPct: 100, note: undefined };

  let winner = candidates[0] as CapCandidate;
  for (const candidate of candidates) {
    if (candidate.capPct < winner.capPct) winner = candidate;
  }
  return { capPct: winner.capPct, note: winner.note };
}

/**
 * The binding cap for one exercise this week: the lowest of the level cap
 * (R154), the pain cap scoped to this exercise's attributes (R163), the under
 * 18 cap (R1), the ballistic ceiling, and the week-2 guard.
 */
export function resolveCapPct(
  exercise: Exercise,
  athlete: Athlete,
  weekContext: PrescribeContext,
  painGate: PainGateResult,
): { capPct: number; note: string | undefined } {
  const loadType = weekContext.loadTypeOverride ?? exercise.loadType;
  return resolveCapPctFrom(exercise, athlete, weekContext, painGate.caps, loadType);
}
