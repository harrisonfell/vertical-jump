/** First run, end to end. Routes compose these; nothing else reaches inside. */

export { SETUP_COPY, formatDayDate, lockoutLine, programBuiltLine, reassessmentLine } from './copy';
export {
  ADULT_QUESTION,
  AVAILABILITY_OPTIONS,
  GATE_QUESTIONS,
  PAIN_DURATION_OPTIONS,
  PAIN_LOCATION_OPTIONS,
  PAIN_SEVERITY_OPTIONS,
  GRIP_MODE_OPTIONS,
  READINESS_ITEMS,
  READINESS_KIND_OPTIONS,
  RED_FLAG_KEYS,
  SECONDARY_GOAL_OPTIONS,
  SPORT_OPTIONS,
  TRAINING_AGE_OPTIONS,
  WEAKER_SIDE_OPTIONS,
  WEEKDAY_CHIPS,
  YES_NO,
  type GateQuestion,
  type GripModeValue,
  type PainLocationValue,
  type ReadinessKey,
  type RedFlagKey,
  type SecondaryGoalValue,
  type SportValue,
  type TrainingAgeValue,
  type WeakerSideValue,
} from './questions';

export {
  CEILING_MAX,
  CEILING_MIN,
  WALL_GAP_MAX,
  WALL_GAP_MIN,
  climbingAnswersFrom,
  climbingDefaults,
  climbingPatchFrom,
  showsClimbingLifts,
  showsGripBlock,
  validateClimbing,
  wallWorkFrom,
  type ClimbingAnswers,
  type ClimbingField,
  type ClimbingPatch,
  type ClimbingResult,
} from './climbing';
export { ClimbingBlock, type ClimbingBlockProps } from './climbingBlock';
export {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  METRIC_FOR_KIND,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  WINDOW_MAX,
  WINDOW_MIN,
  readinessConfigDefaults,
  readinessConfigValuesFrom,
  toReadinessTestConfig,
  type ReadinessConfigValues,
} from './readinessConfig';
export { ReadinessBlock, type ReadinessBlockProps } from './readinessBlock';
export { MaxesBlock, type MaxesBlockProps } from './maxesBlock';
export {
  maxRowsFor,
  maxesCaptionFor,
  type MaxLiftRow,
  type MaxesValues,
} from './maxLifts';
export {
  MAX_LIFT_IDS,
  PULL_UP_ENTRY_REPS,
  baselineFrom,
  workingMaxesFrom,
} from './enteredMaxes';
export {
  BEST_SET_LIFT_IDS,
  BEST_SET_REPS_MAX,
  BEST_SET_REPS_MIN,
  NEAR_MAX_REPS,
  NEAR_MAX_RPE,
  RPE_CHIPS,
  bestSetSummary,
  bestSetValuesFrom,
  bestSetsDraftFrom,
  bestSetsFrom,
  bestSetsHaveErrors,
  emptyBestSet,
  isAddedLoadField,
  isBlankBestSet,
  isNearMaxSet,
  validateBestSet,
  type BestSetErrorField,
  type BestSetErrors,
  type BestSetField,
  type BestSetValues,
  type BestSetsDraft,
} from './bestSets';
export { BestSetBlock, type BestSetBlockProps } from './bestSetBlock';
export {
  STEP_TWO_DEFAULTS,
  stepTwoDefaults,
  type ReadinessAnswers,
  type StepTwoValues,
} from './stepTwoValues';

export {
  OWNER_BOX_SQUAT_SET_DATE,
  OWNER_INVENTORY,
  OWNER_STEP_ONE,
  OWNER_STEP_TWO,
  ownerAthletePatch,
} from './ownerPrefill';
export {
  stepTwoInitial,
  type StepTwoInitial,
  type StepTwoInitialInput,
  type StepTwoStart,
} from './stepTwoInitial';
export {
  DEFAULT_PROGRAM_WEEKS,
  defaultTargetDate,
  defaultTargetLabel,
  programStart,
  startAndTargetLine,
  type StartLineInput,
} from './startLine';

export { CheckRow, Question, StepFrame } from './parts';

export {
  DEFAULT_INVENTORY,
  inventorySummary,
  readInventory,
  weightRoomAccess,
} from './inventory';
export { InventorySheet, type InventorySheetProps } from './inventorySheet';

export {
  IncompleteProfileError,
  TRAINING_AGE_YEARS,
  readClearanceAnswers,
  severityRawFrom,
  toEngineAthlete,
  toEnginePain,
  trainingAgeFromYears,
  type BaselineReading,
  type EngineAthleteInput,
} from './engineAthlete';

export {
  REASSESS_DAYS,
  clearanceScreenFor,
  hasLowerLimbPain,
  hasSeverePain,
  nextSetupRoute,
  painGateFor,
  reassessDueAt,
  type PainGateInput,
} from './clearanceModel';

export {
  ADDED_LOAD_MAX_LB,
  ADDED_LOAD_MIN_LB,
  HEIGHT_MAX_IN,
  HEIGHT_MIN_IN,
  MIN_TARGET_DAYS,
  THREE_DAY_LINE,
  feasibilityLine,
  inchesToMm,
  mmToInches,
  orderWeekdays,
  parseNumber,
  reachTouchIn,
  validateStepTwo,
  type FeasibilityInput,
  type MeasureMode,
  type StepTwoDraft,
  type StepTwoField,
  type StepTwoResult,
} from './stepTwoValidation';

export {
  LOCKOUT_AFTER,
  LOCKOUT_SECONDS,
  attemptMessage,
  isSixDigits,
  lockoutRemaining,
  type AttemptOutcome,
} from './pairing';
export { forcedClearance, type ForcedClearanceKind } from './states';

export { SetupStepOne, STEP_ONE_DEFAULTS, stepOneDefaults, type StepOneValues } from './stepOne';
export { SetupStepTwo } from './stepTwo';
export { useSaveStepOne, type StepOneSaveResult } from './saveStepOne';
export { useSaveStepTwo } from './saveStepTwo';
export { baselineReading, useBaselineTest } from './useBaseline';
export {
  buildFailureLines,
  buildProgramPlan,
  emptyHistory,
  seedFor,
  type BuildInput,
  type BuildPlan,
} from './buildProgram';
export { writeProgramPlan } from './writeProgram';

export { GateScreen } from './gateScreen';
export { StepOneScreen } from './stepOneScreen';
export { StepTwoScreen } from './stepTwoScreen';
export { StepThreeScreen } from './stepThreeScreen';
export { BuildScreen } from './buildScreen';
export { ClearanceScreen } from './clearanceScreen';
export { PairScreen, type PairScreenProps } from './pairScreen';
export { PrivacyScreen } from './privacyScreen';
