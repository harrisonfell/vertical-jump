/**
 * Rest, one displayed value, the longest applicable rule (R164).
 *
 * Reading (brief section 09 "Load prescription"): main and secondary lifts and
 * maximal jumps take the upper bound of their set-count band (4-5 sets 180 s,
 * 2-3 sets 150 s, 6-7 sets 240 s), sprints and change-of-direction reps 180 s
 * (R104), accessories and hypertrophy the lower bound (120 s), extensive
 * plyometric drills 120 s, prehab and mobility 60 s. Fatigue cost high forces
 * at least 120 s (R77). The winner is the longest, and the runner shows one
 * number formatted by `formatRest`.
 */
import type { Exercise } from '../types/exercise.js';
import type { ExerciseRole } from '../types/core.js';
import type { Ruleset } from '../types/ruleset.js';
import { defaultRole } from './context.js';
import { roundHalfUp } from '../units.js';

/** The winning rest value and the rule it came from, in plain words. */
export interface RestDecision {
  restS: number;
  /** "4 sets of a main lift" or "maximal jumps": no rule number in the runner. */
  restRule: string;
  /** The rule-book ids behind it, "R70+R164", for the Plan rules summary. */
  ruleIds: string;
  /** Every rule that applied, longest first, for the session detail. */
  considered: { restS: number; rule: string }[];
}

interface Contribution {
  restS: number;
  rule: string;
  id: string;
}

function setBand(sets: number, ruleset: Ruleset): { bottom: number; top: number; id: string } {
  const bounds = ruleset.constants.restBoundsS;
  if (sets >= 6) return { ...bounds.sets6to7, id: 'R71' };
  if (sets >= 4) return { ...bounds.sets4to5, id: 'R70' };
  return { ...bounds.sets2to3, id: 'R69' };
}

function isMainish(role: ExerciseRole): boolean {
  return role === 'main_lift' || role === 'secondary';
}

function isAccessoryish(exercise: Exercise, role: ExerciseRole): boolean {
  if (exercise.loadType === 'hypertrophy') return true;
  return (
    role === 'accessory' ||
    role === 'core' ||
    role === 'conditioning' ||
    role === 'primer' ||
    role === 'activation'
  );
}

function isPrehabOrMobility(exercise: Exercise, role: ExerciseRole): boolean {
  if (exercise.loadType === 'prehab' || exercise.loadType === 'mobility') return true;
  return (
    role === 'mobility' ||
    role === 'injury_prevention' ||
    role === 'tendon' ||
    role === 'warm_up' ||
    role === 'cool_down' ||
    role === 'soft_tissue'
  );
}

/**
 * Resolve one exercise's rest. Never returns a range: the runner shows one
 * number, formatted by `formatRest`.
 */
export function resolveRest(
  exercise: Exercise,
  role: ExerciseRole,
  sets: number,
  ruleset: Ruleset,
): RestDecision {
  const bounds = ruleset.constants.restBoundsS;
  const contributions: Contribution[] = [];
  const plyometric = exercise.plyometric;
  const maximalJump = plyometric?.isMaximalJump === true;
  const prehabOrMobility = isPrehabOrMobility(exercise, role);

  if (prehabOrMobility) {
    contributions.push({
      restS: bounds.prehabMobility,
      rule: 'prehab and mobility',
      id: 'R153',
    });
  } else if (isMainish(role) || maximalJump) {
    const band = setBand(sets, ruleset);
    contributions.push({
      restS: band.top,
      rule: `${sets} sets of a main or secondary lift`,
      id: band.id,
    });
  } else if (isAccessoryish(exercise, role)) {
    contributions.push({
      restS: bounds.accessory,
      rule: 'accessory and hypertrophy work',
      id: setBand(sets, ruleset).id,
    });
  } else {
    const band = setBand(sets, ruleset);
    contributions.push({ restS: band.bottom, rule: `${sets} sets`, id: band.id });
  }

  if (maximalJump) {
    contributions.push({ restS: bounds.maximalJump, rule: 'maximal jumps', id: 'R88' });
  }
  if (plyometric?.category === 'extensive') {
    contributions.push({ restS: bounds.extensiveDrill, rule: 'extensive drills', id: 'R86' });
  }
  if (exercise.sprintDistanceM !== undefined || exercise.codCutsPerRep !== undefined) {
    contributions.push({
      restS: bounds.sprint,
      rule: 'sprint and change of direction reps',
      id: 'R104',
    });
  }
  if (exercise.fatigueCost === 'high') {
    contributions.push({ restS: bounds.accessory, rule: 'high fatigue cost', id: 'R77' });
  }

  const sorted = [...contributions].sort((a, b) => b.restS - a.restS);
  const winner = sorted[0];
  if (winner === undefined) {
    return {
      restS: bounds.accessory,
      restRule: 'default rest',
      ruleIds: 'R164',
      considered: [],
    };
  }
  const ruleIds = sorted.length > 1 ? `${winner.id}+R164` : winner.id;
  return {
    restS: winner.restS,
    restRule: winner.rule,
    ruleIds,
    considered: sorted.map((entry) => ({ restS: entry.restS, rule: entry.rule })),
  };
}

/**
 * The rule-book-facing shape: `restFor(exercise, setCount, context)` returning
 * the winning seconds and the rule ids that produced it ("R70+R164").
 */
export function restFor(
  exercise: Exercise,
  setCount: number,
  context: { role?: ExerciseRole; ruleset: Ruleset },
): { restS: number; restRule: string } {
  const decision = resolveRest(
    exercise,
    context.role ?? defaultRole(exercise),
    setCount,
    context.ruleset,
  );
  return { restS: decision.restS, restRule: decision.ruleIds };
}

/**
 * Estimated session minutes from the resolved rests and set counts, used for
 * the Today header ("about 70 min"). Rest sits between sets, so the last set of
 * an exercise carries none. A strength day runs 65 to 80 minutes.
 */
export function estimateSessionMinutes(
  entries: { sets: number; restS: number; workSecondsPerSet: number }[],
): number {
  let seconds = 0;
  for (const entry of entries) {
    const sets = Math.max(0, Math.trunc(entry.sets));
    seconds += sets * entry.workSecondsPerSet + Math.max(0, sets - 1) * entry.restS;
  }
  return roundHalfUp(seconds / 60, 0);
}
