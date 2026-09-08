/**
 * The versioned ruleset. Every interpretation of the rule book is a house rule
 * shipped in this file, so the Plan's collapsible rules summary renders from
 * data and never from prose in a screen (brief section 09, section 05 "Plan").
 */
import type {
  BlockType,
  Level,
  LoadType,
  StabilityDemand,
  WeekKind,
} from './core.js';
import type {
  ReadinessAdjustment,
  ReadinessState,
  ReadinessTestConfig,
} from './readiness.js';

/**
 * One line of the Plan rules summary.
 * `house` is an interpretation the brief asserts, `override` one of the four
 * places the rule book is deliberately not followed, `reading` a declared
 * reading of an ambiguous rule.
 */
export interface HouseRule {
  id: string;
  /** Short label, sentence case, no rule number. */
  title: string;
  /** Plain words the athlete reads, second person, no rule number inside. */
  text: string;
  /** Rule-book numbers this touches. Empty when no rule-book rule exists. */
  rules: number[];
  /** The size of the change when there is one, for example "+5 extensive contacts". */
  magnitude?: string;
  kind: 'house' | 'override' | 'reading';
}

/** An inclusive numeric range. */
export interface Range {
  bottom: number;
  top: number;
}

/** Per-set scheme for one load type (Block 6, R148 to R161). */
export interface LoadScheme {
  /** R156: the low end of the working range. */
  startPct: number | null;
  /** R150, R151: +5% or +10% per working set; 0 for straight schemes. */
  stepPct: number;
  /** R150 to R153. */
  mode: 'ascending' | 'straight' | 'none';
  /** R61 to R66 rep band, low then high. */
  reps: Range | null;
  /** R161: reps descend across distinct steps; held sets repeat the low value. */
  repDescent: number[] | null;
  /** R161 advanced variant for heavy strength (5/3/1). */
  repDescentAdvanced?: number[];
  /** R66: prehab isometric hold, constant within a session. */
  holdSecondsRange?: Range;
  /**
   * The loaded half of prehab: a tendon row in `slow_resistance` mode is the
   * load and the tempo, so the tempo is prescribed here rather than left to a
   * cue. Present on prehab; absent on every load type that has no tempo.
   */
  slowResistance?: SlowResistance;
  /** R154 exempts power from the level cap; every other ascending type obeys it. */
  respectsLevelCap: boolean;
}

/** How a heavy slow resistance row is performed: seconds up, seconds down. */
export interface SlowResistance {
  tempoUpS: number;
  tempoDownS: number;
}

/** One span of the layout table, "Strength 1-4" and so on. */
export interface LayoutSpan {
  blockType: BlockType;
  kind: WeekKind;
  weekFrom: number;
  weekTo: number;
}

/** One row of the layout table for a program of W weeks (brief 09 "Blocks and layout"). */
export interface LayoutRow {
  /** Program length in weeks. */
  W: number;
  /** The row verbatim, for the Plan rules summary. */
  text: string;
  spans: LayoutSpan[];
  /** W = 4 only: "beginners: Strength 1-3". */
  beginnerText?: string;
  beginnerSpans?: LayoutSpan[];
}

/**
 * Every number the speed-climbing house rules read (`house.sc.*`). Additive:
 * no other sport touches this block, and nothing here may raise a rule-book
 * cap.
 */
export interface ClimbingConstants {
  /** The readiness gate's shipped defaults; the athlete may swap them. */
  readiness: ReadinessTestConfig;
  /** What each of the four states plus `unknown` does. Downward only. */
  readinessAdjustments: Record<ReadinessState, ReadinessAdjustment>;
  /** House `house.sc.hard_finger_spacing`: hours between hard finger sessions. */
  fingerSpacingHours: number;
  /** House `house.sc.finger_pain_ceiling`: above this, hard finger work goes. */
  fingerPainCeiling: number;
  /** House `house.sc.rnt_valgus_control`: RNT sessions per week. */
  rntSessionsPerWeek: number;
  /** House `house.sc.rnt_valgus_control`: hours the RNT row keeps from the wall. */
  rntWallGapHours: number;
  /** House `house.sc.calf_volume_low`: heavy slow calf raise sets per day. */
  calfSetsCap: number;
  /** House `house.sc.calf_volume_low`: days per week that row may appear. */
  calfDaysPerWeek: number;
  /** House `house.sc.sport_requirements`: jump or reactive sessions per week. */
  jumpOrReactiveSessionsPerWeek: number;
  /** House `house.sc.sport_requirements`: upper-body power sessions per week. */
  upperPowerSessionsPerWeek: number;
  /**
   * House `house.sc.asymmetry_tracking`: a signed difference inside this many
   * percent reads as level, so a weaker side is never named from noise.
   */
  asymmetryBandPct: number;
}

/** Every number the engine reads, so no magic constants live in code. */
export interface RulesetConstants {
  /** R154 top-set cap by level. */
  levelTopSetCapPct: Record<Level, number>;
  /** The same caps snapped to the 5% display grid: 80, 85, 90. */
  levelTopSetCapDisplayPct: Record<Level, number>;
  /** R158 RPE ceiling by level. */
  rpeCap: Record<Level, number>;
  /** R158 ladder: set 1 RPE 6, set 2 RPE 7, set 3 RPE 8. */
  rpeLadder: number[];
  /** R76: week 1 of a first program is 6, 6.5, 7 for every level. */
  week1RpeLadder: number[];
  week1RpeCap: number;
  /** R67: heavy strength lifts per session. */
  heavyLiftsPerSession: Record<Level, number>;
  /** R53 to R55 stability ceiling. */
  stabilityCeiling: Record<Level, StabilityDemand>;
  /** R82 to R84 extensive contact range on the Power day. */
  extensiveRange: Record<Level, Range>;
  /** Safety override: loaded-jump ceiling as a percent of squat max. */
  loadedJumpCeilingPct: Record<Level, number>;
  /** Never for beginners (house safety). */
  depthJumpEligible: Record<Level, boolean>;
  contactCaps: {
    /** R85 hard cap, every level. */
    highIntensityPerSession: number;
    /** R52 hard cap across all high-amplitude drills together. */
    highAmplitudePerSession: number;
    /** House convention: every landing counts. */
    depthJumpContactsPerRep: number;
    /** The binding cap that follows: 25 minus 5 test attempts, over 2. */
    depthJumpRepCap: number;
    /** The weekly test's attempts, high-intensity but not high-amplitude. */
    testAttemptContacts: number;
    /** Strength-day primer jumps sit outside the R82 to R84 range. */
    primerJumpCapStrengthDay: number;
    upperMobilityRange: Range;
    recovery: number;
  };
  highIntensitySchedule: {
    strengthLoadWeek: { testContacts: number; maxFromIntensiveJumps: number };
    /** Depth-jump reps per Power-block load week, in order. */
    powerLoadWeekDepthJumpReps: number[];
    deloadHalvesAndRemovesDepthJumps: boolean;
    taperMaxWithinFourDays: number;
  };
  /** R89 trade: E = clamp(bottom + 10k - 2H, bottom, top). Factor is house. */
  r89: { extensiveStepPerWeek: number; highIntensityFactor: number };
  schemes: Record<LoadType, LoadScheme>;
  /** R157: the first 1 to 2 sets of a 6 to 7 set heavy protocol. */
  rampSetPct: number[];
  /** R69 to R71, R77, R88, R104 under the R164 longest-value tiebreaker. */
  restBoundsS: {
    sets2to3: Range;
    sets4to5: Range;
    sets6to7: Range;
    sprint: number;
    maximalJump: number;
    extensiveDrill: number;
    accessory: number;
    prehabMobility: number;
  };
  /** R105 with the house reading: reps and contacts cut, loads held. */
  deload: { volumeFactorMin: number; volumeFactorMax: number; holdLoads: boolean };
  taper: {
    minProgramWeeks: number;
    volumeFactor: number;
    holdLoads: boolean;
    noDepthJumpsWithinDays: number;
  };
  peak: {
    sessionOffsetDays: number;
    mobilityOffsetDays: number;
    restOffsetDays: number;
    testOffsetDays: number;
    mainLiftSets: number;
    maxHighIntensityContacts: number;
  };
  /** R57: blocks run 4 to 6 weeks. */
  blockLengthWeeks: Range;
  /** R57: an accessory repeated for 3 consecutive weeks rotates. */
  accessoryRotationWeeks: number;
  ladderPolicy: {
    rungsPerWeek: number;
    rungsPerBlock: number;
    holdInReducedWeeks: boolean;
    rank0EquipmentFree: boolean;
  };
  dropHeight: {
    maxIn: number;
    maxInWhenHeavyOrUnknownIn: number;
    heavyBodyweightLb: number;
  };
  /** R94 to R96 plus the added hold outcome. */
  adherenceThresholds: { repeatBelow: number; smallFrom: number; progressFrom: number };
  outcomeMagnitudes: {
    smallExtensiveAdd: number;
    progressExtensiveAdd: number;
    progressStartStepPct: number;
    /** The start only steps while cap minus start is at least this. */
    capMinusStartMinimum: number;
    holdWorkingMaxDropPct: number;
    secondFailureDropPct: number;
    consecutiveHighAdd: number;
    consecutiveLowVolumeCutPct: number;
    kSmall: number;
    kProgress: number;
  };
  /** R27, read as "that workout only" (brief 09 "Outcomes at generation"). */
  soreness: {
    threshold: number;
    repsAdd: number;
    percentDrop: number;
    highIntensityFactor: number;
    noDepthJumps: boolean;
    deferTest: boolean;
  };
  painCaps: {
    /** R5, R12, R15, R163 scoped to the attribute the rule names. */
    mildIntensityCapPct: number;
    /** R1. */
    under18CapPct: number;
    /** The day-14 reassessment. */
    reassessDays: number;
    /** ICD-11 acute boundary. */
    acuteMaxWeeks: number;
    /** R6: mild acute is treated as moderate for this long. */
    moderateAsMildWeeks: number;
    /** R4: moderate knee pain halves high-intensity contacts. */
    moderateKneeHighIntensityFactor: number;
    /** R8, R9: shin splint pogo and sprint cuts. */
    shinModeratePct: number;
    shinMildPct: number;
  };
  workingMax: {
    epleyConfidence: number;
    maxRaisePctPerWeek: number;
    week2GuardPct: number;
    epleyLookbackWeeks: number;
    epleyMaxReps: number;
    rpeQualifyMin: number;
    rpeQualifyMaxReps: number;
  };
  /** R162 plus the brief's ballistic-always-down reading. */
  loadGrid: { barbellStepLb: number; ballisticRounding: 'down'; dumbbellTies: 'down' };
  prThreshold: {
    defaultIn: number;
    sessionsBeforeRecalibrate: number;
    sdMultiplier: number;
    roundUpToIn: number;
  };
  noise: { residualSdFloorIn: number; testsBeforeUnfloored: number };
  trend: {
    minTestsForTrend: number;
    minTestsForStatedTrend: number;
    minTestsForProjection: number;
    method: 'theil_sen';
    /** Gaps longer than this many days are drawn broken. */
    brokenGapDays: number;
  };
  /** R110 house: five canonical tests inside the noise band. */
  plateau: { tests: number; bandIn: number };
  /** Implementation checklist, page 11. */
  maxDisplayedExercises: number;
  /** R44. */
  maxHighCnsPerSession: number;
  /** R23 to R25. */
  maxJointHighStressPerSession: number;
  /** R26. */
  jointHighStressWeekThreshold: number;
  jointHighStressWeekReductionPct: number;
  /** R29 as corrected in v5: 2 to 4 movements, 5 to 10 minutes. */
  warmUp: {
    movementsMin: number;
    movementsMax: number;
    minutesMin: number;
    minutesMax: number;
  };
  /** The test-day primer is constant: pogo 2 x 5, submax CMJ 2 x 3. */
  fixedTestPrimer: {
    pogoSets: number;
    pogoReps: number;
    submaxCmjSets: number;
    submaxCmjReps: number;
    extensiveContacts: number;
  };
  /** House: maximal CNS sessions sit at least this many calendar days apart. */
  maximalSessionSpacingDays: number;
  /** R111 house trigger: working max up this much since block start. */
  r111RaisePct: number;
  /** Over this many weeks the program chains from the last test. */
  chainProgramWeeks: number;
  maxLayoutWeeks: number;
  minProgramWeeks: number;
  /** Additive: only the `speed_climbing` house rules read this block. */
  climbing: ClimbingConstants;
  layout: LayoutRow[];
}

/** The whole versioned file. */
export interface Ruleset {
  version: string;
  houseRules: HouseRule[];
  constants: RulesetConstants;
}
