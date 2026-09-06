/**
 * Step 2's values and its starting point.
 *
 * Pure, and free of any component, so the defaults and the shape can be read
 * by a test and by the save path without pulling a renderer in behind them.
 */
import type { Inventory } from '@vert/engine';
import type { BestSetsDraft } from './bestSets';
import { DEFAULT_INVENTORY } from './inventory';
import type { ReadinessKey } from './questions';
import { readinessConfigDefaults, type ReadinessConfigValues } from './readinessConfig';
import type { StepTwoDraft } from './stepTwoValidation';

export type ReadinessAnswers = Record<ReadinessKey, boolean>;

export interface StepTwoValues extends StepTwoDraft {
  readonly inventory: Inventory;
  readonly readiness: ReadinessAnswers;
  /** Channel B of the daily gate (`house.sc.readiness_gate`). */
  readonly readinessConfig: ReadinessConfigValues;
  /** One best recent set per main lift, keyed by that lift's 1RM field (R73). */
  readonly bestSets: BestSetsDraft;
}

const BASE_DEFAULTS: Omit<StepTwoValues, 'readinessConfig'> = {
  bestSets: {},
  measure: 'device',
  baselineIn: '',
  reachIn: '',
  touchIn: '',
  canonical: false,
  goalIn: '',
  targetDate: '',
  weekdays: [],
  daysPerWeek: 4,
  gymStart: '',
  gymEnd: '',
  bodyweightLb: '',
  squatLb: '',
  hingeLb: '',
  pressLb: '',
  boxSquatLb: '',
  pullUpAddedLb: '',
  inSeason: false,
  inventory: DEFAULT_INVENTORY,
  readiness: { squat: false, landing: false, training: false, pain: false },
};

/** The starting point, with the gate's shipped configuration. */
export function stepTwoDefaults(): StepTwoValues {
  return { ...BASE_DEFAULTS, readinessConfig: readinessConfigDefaults() };
}

export const STEP_TWO_DEFAULTS: StepTwoValues = stepTwoDefaults();
