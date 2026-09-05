/**
 * Per-week targets: the two plyometric budgets, the R89 trade between them,
 * the R107 starting offsets, the accessory rotation slot, the R100 tendon
 * runway, and the ladder rung a week starts at.
 *
 * Everything here is pure and reads its magnitudes out of the ruleset, so the
 * Plan's rules summary and the generator can never disagree.
 */
import type { Inventory } from '../types/athlete.js';
import type { BlockType, EquipmentTag, LadderId, Level, LoadType, TrainingAge, WeekKind } from '../types/core.js';
import type { ProgressionLadder } from '../types/exercise.js';
import type { Range, Ruleset } from '../types/ruleset.js';
import type { SkeletonTargets } from '../types/plan.js';
import { clamp, computeExtensiveTarget } from '../budgets.js';

/** The load types whose start percentage the R156 offset moves. */
export const ASCENDING_LOAD_TYPES: LoadType[] = [
  'heavy_strength',
  'power',
  'hypertrophy',
  'speed_strength',
  'strength_speed',
];

/** R82 to R84, read out of the ruleset. */
export function extensiveRangeFor(ruleset: Ruleset, level: Level): Range {
  return ruleset.constants.extensiveRange[level];
}

/**
 * The bottom of the range's upper half. "Defaulting to the upper half so
 * nobody is under-dosed below the evidence's 50 jumps" (brief section 09),
 * read as the dose a week takes when it plans no high-intensity contacts at
 * all: with H of 0 the R89 trade does not bind, so the floor is the upper
 * half rather than the range bottom.
 */
export function upperHalfBottom(range: Range): number {
  return Math.round(range.bottom + (range.top - range.bottom) / 2);
}

/**
 * E for one week. With planned high-intensity contacts this is R89 exactly,
 * E = clamp(bottom + 10k - 2H, bottom, top), which is what the brief's worked
 * Power day pins (intermediate, k = 1, H = 21, E = 60). With H of 0 the floor
 * rises to the upper half. `factor` carries the reduced-week and in-season
 * cuts, which may undercut the floor by declared reading.
 */
export function extensiveTargetFor(
  range: Range,
  k: number,
  highIntensity: number,
  ruleset: Ruleset,
  factor = 1,
): number {
  const { extensiveStepPerWeek, highIntensityFactor } = ruleset.constants.r89;
  const base =
    highIntensity > 0
      ? computeExtensiveTarget(
          range.bottom,
          range.top,
          k,
          highIntensity,
          extensiveStepPerWeek,
          highIntensityFactor,
        )
      : Math.round(
          clamp(upperHalfBottom(range) + extensiveStepPerWeek * k, range.bottom, range.top),
        );
  return Math.max(0, Math.round(base * factor));
}

/** What one week is allowed to spend on high-intensity work. */
export interface HighIntensityPlan {
  /** H in the R89 trade. */
  highIntensityAllowance: number;
  /** Reps, not contacts: every depth-jump rep is 2 contacts (house). */
  depthJumpReps: number;
  /** The allowance before the in-season halving, which the next week reads. */
  rawAllowance: number;
}

/** Everything the high-intensity schedule keys off. */
export interface HighIntensityInput {
  blockType: BlockType;
  kind: WeekKind;
  level: Level;
  /** 0-based ordinal of this load week inside its block. */
  loadWeekOrdinal: number;
  /** False for beginners, an unpassed readiness checklist, or a first block. */
  depthJumpsAllowed: boolean;
  /** The week before's allowance, before any in-season cut; a deload halves it. */
  previousAllowance: number;
  /** House override: in season, jump contacts halve. */
  inSeason: boolean;
}

/**
 * The high-intensity schedule from brief section 09 "Plyometrics: two
 * budgets". Strength-block load weeks run H = 5 (the test) plus up to 10 from
 * non-drop intensive jumps. Power-block load weeks run H = 5 plus twice the
 * depth-jump reps 6, 8, 10, 10, 10, giving 17, 21, 25, 25, 25. A deload halves
 * H and drops depth jumps; a taper and the peak session cap H at 10. A Power
 * load week that may not carry depth jumps falls back to the Strength-block
 * shape.
 */
export function highIntensityFor(input: HighIntensityInput, ruleset: Ruleset): HighIntensityPlan {
  const { highIntensitySchedule, contactCaps } = ruleset.constants;
  const { testContacts, maxFromIntensiveJumps } = highIntensitySchedule.strengthLoadWeek;
  const plan = ((): Omit<HighIntensityPlan, 'rawAllowance'> => {
    if (input.kind === 'deload') {
      return { highIntensityAllowance: Math.floor(input.previousAllowance / 2), depthJumpReps: 0 };
    }
    if (input.kind === 'taper' || input.kind === 'peak') {
      return {
        highIntensityAllowance: Math.min(
          highIntensitySchedule.taperMaxWithinFourDays,
          ruleset.constants.peak.maxHighIntensityContacts,
        ),
        depthJumpReps: 0,
      };
    }
    if (input.blockType === 'power' && input.depthJumpsAllowed) {
      const schedule = highIntensitySchedule.powerLoadWeekDepthJumpReps;
      const last = schedule[schedule.length - 1] ?? 0;
      const reps = Math.min(
        schedule[Math.min(input.loadWeekOrdinal, schedule.length - 1)] ?? last,
        contactCaps.depthJumpRepCap,
      );
      return {
        highIntensityAllowance: testContacts + reps * contactCaps.depthJumpContactsPerRep,
        depthJumpReps: reps,
      };
    }
    return { highIntensityAllowance: testContacts + maxFromIntensiveJumps, depthJumpReps: 0 };
  })();

  const capped = Math.min(plan.highIntensityAllowance, contactCaps.highIntensityPerSession);
  if (!input.inSeason) return { ...plan, highIntensityAllowance: capped, rawAllowance: capped };
  return {
    highIntensityAllowance: Math.floor(capped / 2),
    depthJumpReps: Math.floor(plan.depthJumpReps / 2),
    rawAllowance: capped,
  };
}

/** The volume a reduced week keeps, as a fraction of a load week. */
export function volumeFactorFor(kind: WeekKind, ruleset: Ruleset): number {
  if (kind === 'deload') return ruleset.constants.deload.volumeFactorMax;
  if (kind === 'taper') return ruleset.constants.taper.volumeFactor;
  if (kind === 'peak') return ruleset.constants.taper.volumeFactor;
  return 1;
}

/**
 * R100's runway, which raw training age "None" adds: isometric weeks 1 and 2,
 * slow resistance weeks 3 and 4, plyometric emphasis from the second block.
 * Everyone else runs slow resistance through the Strength block and
 * plyometric through the Power block, which is the same progression without
 * the runway's two isometric weeks.
 */
export function tendonModeFor(
  trainingAge: TrainingAge,
  w: number,
  blockOrdinal: number,
  blockType: BlockType,
): SkeletonTargets['tendonMode'] {
  if (trainingAge !== 'none') return blockType === 'strength' ? 'slow_resistance' : 'plyometric';
  if (blockOrdinal >= 1) return 'plyometric';
  if (w <= 2) return 'isometric';
  return 'slow_resistance';
}

/** R57: an accessory repeated for 3 consecutive weeks rotates. */
export function accessoryRotationSlotFor(
  w: number,
  blockStartWeek: number,
  ruleset: Ruleset,
): number {
  const span = Math.max(1, ruleset.constants.accessoryRotationWeeks);
  return Math.floor((w - blockStartWeek) / span);
}

/** Every ascending load type starts at its scheme's low end (R107, R156). */
export function zeroStartOffsets(): Partial<Record<LoadType, number>> {
  const offsets: Partial<Record<LoadType, number>> = {};
  for (const loadType of ASCENDING_LOAD_TYPES) offsets[loadType] = 0;
  return offsets;
}

/** Add `stepPct` to every ascending load type's offset. */
export function raiseStartOffsets(
  offsets: Partial<Record<LoadType, number>>,
  stepPct: number,
): Partial<Record<LoadType, number>> {
  const next: Partial<Record<LoadType, number>> = { ...offsets };
  for (const loadType of ASCENDING_LOAD_TYPES) next[loadType] = (next[loadType] ?? 0) + stepPct;
  return next;
}

function inventoryHasTag(inventory: Inventory, tag: EquipmentTag): boolean {
  switch (tag) {
    case 'none':
      return true;
    case 'barbell':
      return inventory.barbell;
    case 'rack':
      return inventory.rack;
    case 'trap_bar':
      return inventory.trapBar;
    case 'dumbbell':
      return inventory.dumbbells !== null;
    case 'kettlebell':
      return inventory.kettlebells;
    case 'box':
      return inventory.boxHeightsIn.length > 0;
    case 'hangboard':
      return inventory.hangboard === true;
    case 'box_squat_box':
      return inventory.boxSquatBox === true;
    case 'hurdle':
      return inventory.hurdleHeightsIn.length > 0;
    case 'band':
      return inventory.bands;
    case 'med_ball':
      return inventory.medBall;
    case 'vest':
      return inventory.vestLb !== undefined;
    case 'bench':
      return inventory.bench;
    case 'pullup_bar':
      return inventory.pullupBar;
    case 'cable':
      return inventory.cable;
    case 'sled':
      return inventory.sled;
  }
}

/**
 * The rung a ladder starts at: the highest rank whose equipment the athlete
 * owns and whose height, when it fixes one, is on hand. Rank 0 is always
 * reachable because every ladder has an equipment-free rank 0.
 */
export function startingRungFor(ladder: ProgressionLadder, inventory: Inventory): number {
  let best = 0;
  const heights = new Set([...inventory.boxHeightsIn, ...inventory.hurdleHeightsIn]);
  for (const rung of ladder.rungs) {
    if (rung.rank <= best) continue;
    if (!rung.equipment.every((tag) => inventoryHasTag(inventory, tag))) continue;
    if (rung.heightIn !== undefined && !heights.has(rung.heightIn)) continue;
    best = rung.rank;
  }
  return best;
}

/** Every ladder's starting rung, keyed by ladder id. */
export function startingRungs(
  ladders: readonly ProgressionLadder[],
  inventory: Inventory,
): Record<LadderId, number> {
  const rungs: Record<LadderId, number> = {};
  for (const ladder of ladders) rungs[ladder.id] = startingRungFor(ladder, inventory);
  return rungs;
}

/**
 * Ladders advance one rung per week and two per block on Good or OK landings
 * and hold in reduced weeks (house). `advancesThisBlock` is the count already
 * spent inside the current block.
 */
export function advanceRungs(
  rungs: Record<LadderId, number>,
  kind: WeekKind,
  allowAdvance: boolean,
  advancesThisBlock: number,
  ruleset: Ruleset,
): Record<LadderId, number> {
  const policy = ruleset.constants.ladderPolicy;
  const reduced = kind !== 'load';
  if ((reduced && policy.holdInReducedWeeks) || !allowAdvance) return { ...rungs };
  if (advancesThisBlock >= policy.rungsPerBlock) return { ...rungs };
  const next: Record<LadderId, number> = {};
  for (const [id, rung] of Object.entries(rungs)) next[id] = rung + policy.rungsPerWeek;
  return next;
}
