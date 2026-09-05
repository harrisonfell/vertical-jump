/**
 * How Block 3 ranks candidates for one slot, and the Block 2 and Block 4
 * budgets that say whether a candidate may be added at all.
 *
 * Split out of `assemble.ts` so both files stay under the 500-line limit. Ties
 * are broken by the seeded PRNG and never by `Math.random`, so a session is
 * reproducible from its context alone.
 */
import type {
  DayType,
  ExerciseId,
  ExerciseRole,
  MovementPattern,
  StressedJoint,
} from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { RoleSlot } from './order.js';
import { matchesSprintClass, sprintClassFor } from './order.js';
import type { SelectContext } from './assemble.js';

const LOWER_PATTERNS: readonly MovementPattern[] = ['squat', 'hinge', 'lunge'];

/**
 * House `house.sc.sport_requirements`: how far an exercise from the athlete's
 * own approved pool outranks an equally good untagged one. Set above three
 * weeks of the freshness decay (R57's rotation threshold) and below the block
 * sequence preference, so the approved pool holds its place without ever
 * outranking a Block 4 volume target or the sequence the house rule names.
 */
export const SPORT_POOL_BONUS = 35;
export const STRENGTH_DAYS = new Set<DayType>(['full_body_strength', 'lower_strength', 'upper_strength']);
export const POWER_DAYS = new Set<DayType>(['power_speed', 'power', 'speed']);

export interface Budget {
  highCns: number;
  heavy: number;
  joint: Record<StressedJoint, number>;
}

export function jointCapFor(joint: StressedJoint, context: SelectContext): number {
  const constants = context.ruleset.constants;
  const last = context.jointHighStressLastWeek[joint];
  if (last >= constants.jointHighStressWeekThreshold) {
    const factor = 1 - constants.jointHighStressWeekReductionPct / 100;
    return Math.max(1, Math.floor(constants.maxJointHighStressPerSession * factor));
  }
  return constants.maxJointHighStressPerSession;
}

export function canAdd(exercise: Exercise, budget: Budget, context: SelectContext): boolean {
  const constants = context.ruleset.constants;
  if (exercise.cnsCost === 'high' && budget.highCns >= constants.maxHighCnsPerSession) return false;
  if (exercise.loadType === 'heavy_strength' && budget.heavy >= constants.heavyLiftsPerSession[context.athlete.level]) {
    return false;
  }
  if (exercise.kneeStress === 'high' && budget.joint.knee >= jointCapFor('knee', context)) return false;
  if (exercise.spineStress === 'high' && budget.joint.spine >= jointCapFor('spine', context)) return false;
  if (exercise.shoulderStress === 'high' && budget.joint.shoulder >= jointCapFor('shoulder', context)) return false;
  // R23 to R25 follow-on constraints.
  if (budget.joint.knee >= 2 && LOWER_PATTERNS.includes(exercise.movementPattern) && exercise.kneeStress !== 'low') {
    return false;
  }
  if (budget.joint.spine >= 2 && exercise.isAxialLoad) return false;
  if (budget.joint.shoulder >= 2 && (exercise.isPressing || exercise.isOverhead)) return false;
  return true;
}

export function spend(exercise: Exercise, budget: Budget): void {
  if (exercise.cnsCost === 'high') budget.highCns += 1;
  if (exercise.loadType === 'heavy_strength') budget.heavy += 1;
  if (exercise.kneeStress === 'high') budget.joint.knee += 1;
  if (exercise.spineStress === 'high') budget.joint.spine += 1;
  if (exercise.shoulderStress === 'high') budget.joint.shoulder += 1;
}

export function consecutive(context: SelectContext, id: ExerciseId): number {
  const weeks = context.rotationHistory[id];
  if (weeks === undefined) return 0;
  const seen = new Set(weeks);
  let run = 0;
  for (let week = context.week.w - 1; week >= 1; week -= 1) {
    if (!seen.has(week)) break;
    run += 1;
  }
  return run;
}

function mainLiftSlotFor(dayType: DayType): 'lower' | 'upper' | 'fullbody' {
  if (dayType === 'upper_strength' || dayType === 'upper_mobility') return 'upper';
  if (dayType === 'full_body_strength') return 'fullbody';
  return 'lower';
}

/**
 * Structural preference inside a block, so the shape of a Power day is fixed
 * by the rule book and not by the tie-break stream: depth jumps first when
 * they are allowed (R120 within the budgets), then the laddered extensive
 * drills, then other intensive jumps (R86, R87).
 */
export function blockPreference(exercise: Exercise, slot: RoleSlot): number {
  const plyo = exercise.plyometric;
  if (slot.block === 'jump_test') return exercise.rotationGroup === 'jump_test' ? 500 : 0;
  if (slot.block === 'power') {
    if (exercise.rotationGroup === 'jump_test') return -500;
    // The readiness gate's test is a measurement protocol the athlete
    // configures in Settings, not a training drill (house `house.sc.readiness_gate`).
    if (exercise.rotationGroup === 'readiness_test') return -500;
    // House `house.sc.upper_power_day`: an explosive pull outranks a throw in
    // the slot they share, and drops out of it when the 48 h finger spacing
    // takes the hard rows off this session.
    if (exercise.isPulling && exercise.intent === 'velocity') return 20;
    if (exercise.readinessRequired) return 200;
    if (plyo === undefined) return 0;
    if (plyo.category === 'extensive' && plyo.ladderId !== undefined) return 150;
    if (plyo.category === 'intensive') return 90;
    return 60;
  }
  if (slot.block === 'primer') {
    if (exercise.rotationGroup === 'jump_test') return -500;
    if (plyo === undefined) return 0;
    return (
      80 +
      (plyo.amplitude === 'low' ? 40 : 0) +
      (plyo.intensity === 'low' ? 20 : 0) +
      (plyo.contactTime === 'fast' ? 10 : 0)
    );
  }
  if (slot.block === 'cod') return 10 * (exercise.codCutsPerRep ?? 0);
  if (slot.block === 'cool_down') return exercise.rotationGroup === 'hip_mobility' ? 50 : 0;
  return 0;
}

const POWER_LIKE = new Set<DayType>(['power_speed', 'power', 'speed']);

/**
 * R99 read with the brief's tendon line ("heavy slow calf raise Mon, calf iso
 * Sat"): the jump day carries the isometric calf work that survives a
 * depth-jump session, the strength day carries the slow-resistance load.
 */
export function tendonPreference(exercise: Exercise, dayType: DayType): number {
  if (exercise.tendonTarget === undefined) return 0;
  const isJumpDay = POWER_LIKE.has(dayType);
  let value = exercise.tendonTarget === 'calf' ? 40 : exercise.tendonTarget === 'achilles' ? 20 : 10;
  if (isJumpDay && exercise.tendonMode === 'isometric') value += 20;
  if (!isJumpDay && exercise.tendonMode === 'slow_resistance') value += 20;
  return value;
}

/**
 * House `house.sc.sequence_strength_rfd_reactive`: max strength, then rate of
 * force, then reactive. The Strength block prefers the concentric-biased
 * intensive jumps (seated jump, depth pause jump: a slow contact, no useful
 * stretch-shortening, all of the effort upward); the Power block prefers the
 * fast-contact drills and the loaded ballistic jumps (approach jump,
 * quick-contact jump, jump squat, barbell jump). Speed climbing only, so no
 * other sport's power day changes.
 */
export function sequencePreference(exercise: Exercise, context: SelectContext): number {
  if (context.athlete.sport !== 'speed_climbing') return 0;
  const plyo = exercise.plyometric;
  if (plyo === undefined) return 0;
  // R86 read for a sport whose jump day carries four rows: an extensive drill
  // is prioritized low-amplitude, so R52's budget is left for the intensive
  // work and R84's contact target stays reachable. Rule 0: that Block 4 target
  // outranks the block sequence below, so an extensive drill is never
  // reordered against the intensive family.
  if (plyo.category !== 'intensive' && !exercise.loadable) {
    return plyo.amplitude === 'low' ? 15 : -15;
  }
  // The house rule names the drills each block carries and a drop-off depth
  // jump is in neither list: the climber's approved pool has the depth PAUSE
  // jump in the Strength block and the approach jump in the Power block. A
  // preference, not an exclusion: it still fills a slot nothing else can.
  if (exercise.readinessRequired && plyo.contactTime === 'fast') return -200;
  const concentric = plyo.contactTime === 'slow' && !exercise.loadable;
  const strengthBlock = context.week.blockType === 'strength';
  // Asymmetric on purpose. The bonus is small, so a preferred drill never
  // displaces a laddered extensive row; the penalty is large enough to
  // outweigh the readiness bonus, so the other block's drill drops below the
  // whole jump pool instead of leading it.
  return concentric === strengthBlock ? 40 : -120;
}

/**
 * R113 with a second goal of speed: on a power-family day the acceleration
 * work and the loaded ballistic jumps outrank the rest of the jump pool, which
 * is what "prioritize velocity and acceleration exercises" asks for.
 *
 * Two magnitudes, on purpose. The sprint bonus clears the laddered extensive
 * drills (the highest-scoring rows in the block), because a sprint that never
 * outranks them inside its own slot is a sprint the week never carries. It
 * does not reorder the goals: the acceleration has its own slot, placed after
 * the jump slot so R112's maximal jump takes the second high-CNS row (R44)
 * before R113's speed work fills in. The loaded-jump bonus is small and
 * deliberately sits BELOW the sport's own approach jump, so the house sequence
 * rule keeps the reactive row it names wherever the CNS budget has room.
 *
 * Everything downstream still binds: R84 and R85's contact budgets are counted
 * after selection, R104's 180 s rest comes off the sprint's own distance tag,
 * and R125 pulls hip mobility into the cool-down behind it.
 */
export function speedGoalPreference(
  exercise: Exercise,
  slot: RoleSlot,
  context: SelectContext,
): number {
  if (context.athlete.secondaryGoal !== 'speed') return 0;
  if (!POWER_DAYS.has(context.session.dayType)) return 0;
  if (slot.block !== 'power' && slot.block !== 'conditioning') return 0;
  const sprintClass = sprintClassFor(context.athlete.sport);
  if (matchesSprintClass(exercise, sprintClass)) {
    // One acceleration row, not two. The bonus falls away from the middle of
    // the class's band (R102's 10 m, R103's 40 m), so the drill the class is
    // really about leads the block and its longer sibling drops back below the
    // sport's own intensive jump, which then takes the second high-CNS slot.
    const ideal = sprintClass === 'acceleration' ? 10 : 40;
    return 200 - Math.abs((exercise.sprintDistanceM ?? ideal) - ideal);
  }
  if (exercise.loadable && exercise.plyometric?.isMaximalJump === true) return 10;
  return 0;
}

export function score(exercise: Exercise, slot: RoleSlot, context: SelectContext): number {
  const { athlete, week, session } = context;
  let value = blockPreference(exercise, slot);
  if (slot.block === 'power') value += sequencePreference(exercise, context);
  value += speedGoalPreference(exercise, slot, context);
  // House `house.sc.readiness_gate`: the upper-power day's primer is the
  // seated med-ball throw, which doubles as the gate's neuromuscular test.
  if (slot.role === 'primer' && exercise.readinessTest !== undefined && session.dayType === 'upper_strength') {
    value += 50;
  }
  if (slot.role === 'main_lift') {
    const wanted = week.targets.mainLiftBySlot[mainLiftSlotFor(session.dayType)];
    if (wanted === exercise.id) value += 1000;
    if (exercise.isMainLift) value += 200;
    if (week.blockType === 'strength' && exercise.prefersLoadableInStrengthBlock) value += 50;
  }
  if (STRENGTH_DAYS.has(session.dayType) && exercise.intent === 'strength') value += 30;
  if (POWER_DAYS.has(session.dayType) && (exercise.intent === 'velocity' || exercise.intent === 'elastic')) {
    value += 30;
  }
  if (session.dayType === 'recovery_mobility' && (exercise.intent === 'mobility' || exercise.intent === 'low_fatigue')) {
    value += 30;
  }
  if (athlete.primaryGoal === 'vertical_jump' && (exercise.intent === 'elastic' || exercise.intent === 'strength')) {
    value += 20;
  }
  if (athlete.primaryGoal === 'sprint_speed' && exercise.intent === 'velocity') value += 20;
  if (athlete.primaryGoal === 'strength' && exercise.loadable) value += 20;
  if (athlete.primaryGoal === 'return_from_injury' && (exercise.intent === 'mobility' || exercise.unilateral)) {
    value += 20;
  }
  if (exercise.tendonMode !== undefined && exercise.tendonMode === week.targets.tendonMode) value += 25;
  if (slot.role === 'tendon') value += tendonPreference(exercise, session.dayType);
  // A row tagged for this athlete's sport is that sport's own approved pool,
  // so it outranks an equally good untagged one. The bonus clears three weeks
  // of the freshness decay below, which is R57's own rotation threshold: an
  // approved drill is not displaced by an untagged one after a single week,
  // and R57 still rotates it out at three. No exercise carried a sports tag
  // before speed climbing, so no other sport's ranking moves.
  if (exercise.sports?.includes(athlete.sport) === true) value += SPORT_POOL_BONUS;
  // House `house.sc.open_hand_grip` with R99: the finger tendon work belongs
  // to the upper power day, the calf work to the lower and jump days.
  if (slot.role === 'tendon' && exercise.tendonTarget === 'finger') {
    value += session.dayType === 'upper_strength' ? 60 : -20;
  }
  // R99 with R116 and R117: the injury-prevention slot carries the week's
  // tendon work where it can, so the tendon repair does not have to add an
  // extra prehab row and tip a strength day below its intent majority.
  if (slot.role === 'injury_prevention' && exercise.tendonTarget !== undefined) value += 15;
  if (requiredWeeklyMatch(exercise, context)) value += 40;
  // The test-day Primer is constant (pogo 2 x 5, submax CMJ 2 x 3), so it
  // never goes stale and the weekly test never rotates.
  if (!isFixedSlot(slot, context)) value -= 10 * consecutive(context, exercise.id);
  return value;
}

/** Slots the rule book fixes: the weekly test and the test-day Primer. */
export function isFixedSlot(slot: RoleSlot, context: SelectContext): boolean {
  if (slot.block === 'jump_test') return true;
  return slot.block === 'primer' && context.session.isTestDay;
}

export function requiredWeeklyMatch(exercise: Exercise, context: SelectContext): boolean {
  for (const requirement of context.painGate.requiredWeekly) {
    if (requirement === 'knee_prehab' && exercise.tendonTarget === 'knee') return true;
    if (requirement === 'calf_tendon' && (exercise.tendonTarget === 'calf' || exercise.tendonTarget === 'achilles')) {
      return true;
    }
    if (requirement === 'core_stability' && exercise.roleCandidates.includes('core')) return true;
    if (requirement === 'scapular_stability' && exercise.rotationGroup === 'scapular') return true;
    if (requirement === 'hip_mobility' && exercise.rotationGroup === 'hip_mobility') return true;
    if (requirement === 'hamstring_eccentric' && exercise.rotationGroup === 'posterior_chain') return true;
  }
  return false;
}

/** Sort by score, then break exact ties with the seeded stream. */
export function rank(candidates: readonly Exercise[], slot: RoleSlot, context: SelectContext, label: string): Exercise[] {
  const scored = candidates.map((exercise) => ({ exercise, value: score(exercise, slot, context) }));
  const buckets = new Map<number, Exercise[]>();
  for (const entry of scored) {
    const bucket = buckets.get(entry.value);
    if (bucket === undefined) buckets.set(entry.value, [entry.exercise]);
    else bucket.push(entry.exercise);
  }
  const values = [...buckets.keys()].sort((a, b) => b - a);
  const out: Exercise[] = [];
  for (const value of values) {
    const bucket = (buckets.get(value) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.push(...context.prng.fork(`${label}:${value}`).shuffle(bucket));
  }
  return out;
}

/**
 * A pairing repair picks the best candidate by the same score the slots use,
 * so the tendon repair lands on the isometric on a jump day and on the slow
 * resistance work on a strength day (brief section 13 tendon line). The PRNG
 * only breaks exact ties.
 */
export function chooseByScore(
  candidates: readonly Exercise[],
  label: string,
  context: SelectContext,
): Exercise | undefined {
  if (candidates.length === 0) return undefined;
  const role: ExerciseRole = label.includes('tendon') ? 'tendon' : 'accessory';
  const slot: RoleSlot = {
    block: label.includes('hip_mobility') ? 'cool_down' : 'accessory',
    role,
    count: 1,
    min: 1,
    grouped: false,
    precedence: 65,
  };
  return rank(candidates, slot, context, label)[0];
}
