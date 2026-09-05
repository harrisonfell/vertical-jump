/**
 * The `house.sc.*` constants block: the readiness gate's swappable test, the
 * five states' adjustments, and the finger, RNT and calf numbers.
 *
 * Additive: no sport but `speed_climbing` reads any of it, and a ruleset file
 * without the block is refused at load the same way any other missing constant
 * is. Every adjustment is checked for the downward-only invariant here, so no
 * later code has to trust the file.
 */
import type { ClimbingConstants } from '../types/ruleset.js';
import type {
  ReadinessAdjustment,
  ReadinessMetric,
  ReadinessState,
  ReadinessTestConfig,
  ReadinessTestKind,
} from '../types/readiness.js';
import { RulesetValidationError, bool, num, obj, oneOf } from './validate.js';

const READINESS_KINDS: readonly ReadinessTestKind[] = ['seated_mb_throw', 'cmj', 'rsi'];
const READINESS_METRICS: readonly ReadinessMetric[] = ['distance_m', 'height_in', 'rsi'];

/** The four states plus `unknown`, which is a day with neither channel. */
export const READINESS_STATES: readonly ReadinessState[] = [
  'both_high',
  'autonomic_low',
  'neuromuscular_low',
  'both_low',
  'unknown',
];

/** The readiness gate's swappable test config (house `house.sc.readiness_gate`). */
function readReadinessConfig(value: unknown, path: string): ReadinessTestConfig {
  const record = obj(value, path);
  return {
    kind: oneOf(record['kind'], `${path}.kind`, READINESS_KINDS),
    metric: oneOf(record['metric'], `${path}.metric`, READINESS_METRICS),
    attempts: num(record['attempts'], `${path}.attempts`),
    baselineWindow: num(record['baselineWindow'], `${path}.baselineWindow`),
    lowThresholdPct: num(record['lowThresholdPct'], `${path}.lowThresholdPct`),
    whoopLowScore: num(record['whoopLowScore'], `${path}.whoopLowScore`),
  };
}

/**
 * One state's adjustment. Downward only: a factor above 1 or a negative rep
 * addition would let the gate raise something, so the file is refused.
 */
function readReadinessAdjustment(value: unknown, path: string): ReadinessAdjustment {
  const record = obj(value, path);
  const jumpVolumeFactor = num(record['jumpVolumeFactor'], `${path}.jumpVolumeFactor`);
  const loadFactor = num(record['loadFactor'], `${path}.loadFactor`);
  const extraReps = num(record['extraReps'], `${path}.extraReps`);
  if (jumpVolumeFactor > 1 || loadFactor > 1 || extraReps < 0) {
    throw new RulesetValidationError(path, 'a readiness adjustment may only reduce');
  }
  return {
    tierDown: bool(record['tierDown'], `${path}.tierDown`),
    holdVolume: bool(record['holdVolume'], `${path}.holdVolume`),
    removeMaximalJumps: bool(record['removeMaximalJumps'], `${path}.removeMaximalJumps`),
    jumpVolumeFactor,
    loadFactor,
    extraReps,
    offerRecoverySwap: bool(record['offerRecoverySwap'], `${path}.offerRecoverySwap`),
  };
}

/** Read and validate `constants.climbing`. */
export function readClimbing(value: unknown, path: string): ClimbingConstants {
  const record = obj(value, path);
  const adjustmentsRaw = obj(record['readinessAdjustments'], `${path}.readinessAdjustments`);
  const readinessAdjustments = {} as Record<ReadinessState, ReadinessAdjustment>;
  for (const state of READINESS_STATES) {
    readinessAdjustments[state] = readReadinessAdjustment(
      adjustmentsRaw[state],
      `${path}.readinessAdjustments.${state}`,
    );
  }
  return {
    readiness: readReadinessConfig(record['readiness'], `${path}.readiness`),
    readinessAdjustments,
    fingerSpacingHours: num(record['fingerSpacingHours'], `${path}.fingerSpacingHours`),
    fingerPainCeiling: num(record['fingerPainCeiling'], `${path}.fingerPainCeiling`),
    rntSessionsPerWeek: num(record['rntSessionsPerWeek'], `${path}.rntSessionsPerWeek`),
    rntWallGapHours: num(record['rntWallGapHours'], `${path}.rntWallGapHours`),
    calfSetsCap: num(record['calfSetsCap'], `${path}.calfSetsCap`),
    calfDaysPerWeek: num(record['calfDaysPerWeek'], `${path}.calfDaysPerWeek`),
    jumpOrReactiveSessionsPerWeek: num(
      record['jumpOrReactiveSessionsPerWeek'],
      `${path}.jumpOrReactiveSessionsPerWeek`,
    ),
    upperPowerSessionsPerWeek: num(
      record['upperPowerSessionsPerWeek'],
      `${path}.upperPowerSessionsPerWeek`,
    ),
    asymmetryBandPct: num(record['asymmetryBandPct'], `${path}.asymmetryBandPct`),
  };
}
