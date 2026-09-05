/**
 * The exercise database shape. R58, R59 and R60 make stability, joint stress,
 * CNS cost and fatigue cost required attributes: an exercise missing any of
 * them "cannot be selected by the generator", so `validateExercise` throws
 * and a seed test fails (brief section 12).
 */
import type {
  ChartCategory,
  CnsCost,
  DayType,
  DisplayMode,
  EquipmentTag,
  ExerciseId,
  ExerciseIntent,
  ExerciseRole,
  FingerLoad,
  GripMode,
  LadderId,
  Level,
  LoadType,
  MovementPattern,
  Plane,
  Sport,
  StabilityDemand,
  StressLevel,
  TendonMode,
  TendonTarget,
} from './core.js';
import type { ReadinessMetric, ReadinessTestKind } from './readiness.js';

/** Contact classification (R51, R86, R87). */
export interface PlyometricProfile {
  /** R51: fast contacts classify the drill as reactive. */
  contactTime: 'fast' | 'slow';
  /** R52: high amplitude is capped at 20 contacts per session. */
  amplitude: 'low' | 'high';
  /** R85: `high` contacts are capped at 25 per session at every level. */
  intensity: 'low' | 'moderate' | 'high';
  /** R86, R87: extensive prioritizes low amplitude, intensive maximum effort. */
  category: 'extensive' | 'intensive';
  /** House convention: every landing counts, so a depth jump is 2. */
  contactsPerRep: number;
  /** True for the test attempts, maximal bounds, and depth jumps (R88 rest). */
  isMaximalJump: boolean;
  /** Progression ladder this drill belongs to, if any. */
  ladderId?: LadderId;
  /** Box, hurdle or step-off height in inches when the rung fixes one. */
  heightIn?: number;
}

/** One rung of a progression ladder. Rank 0 must be equipment-free. */
export interface LadderRung {
  rank: number;
  label: string;
  heightIn?: number;
  equipment: EquipmentTag[];
}

/**
 * Ladders advance one rung per week and two per block on Good or OK landings
 * and hold in reduced weeks (brief 09 "Plyometrics", house rule).
 */
export interface ProgressionLadder {
  id: LadderId;
  name: string;
  rungs: LadderRung[];
}

/** A seeded exercise. Every non-optional field is required by R58 to R60. */
export interface Exercise {
  id: ExerciseId;
  name: string;
  /** R149: the per-set scheme is chosen by this field alone. */
  loadType: LoadType;
  /** R159: false means reps or time only, never a percent or a load. */
  loadable: boolean;
  /** Implementation checklist: distance rows never display as time. */
  displayMode: DisplayMode;
  /** R58, ceiling by level per R53 to R55. */
  stabilityDemand: StabilityDemand;
  /** R59. `high` is reserved for depth jumps, maximal bounds, heavy bilateral squats (house). */
  kneeStress: StressLevel;
  /** R59. Drives R21, R24, R26. */
  spineStress: StressLevel;
  /** R59. Drives R22, R25, R26. */
  shoulderStress: StressLevel;
  /** R60. Drives R42 and the two-high-CNS cap (R44). */
  cnsCost: CnsCost;
  /** R60. `high` forces rest at or above 120 s (R77). */
  fatigueCost: StressLevel;
  /** R19: excluded when any tag is not in the inventory. */
  equipment: EquipmentTag[];
  /** R46: excluded without weight-room access. */
  requiresBarbell: boolean;
  plyometric?: PlyometricProfile;
  movementPattern: MovementPattern;
  /** R50 pairing. */
  plane: Plane;
  /** R49, R121: a bilateral exercise needs a unilateral one. */
  unilateral: boolean;
  /** R11, R24: axial loading is removed on moderate back pain. */
  isAxialLoad: boolean;
  /** R13, R14: overhead work is removed on shoulder pain. */
  isOverhead: boolean;
  /** R13, R14, R15: pressing is removed or capped on shoulder pain. */
  isPressing: boolean;
  /** R48, R123: a push needs a pull. */
  isPush: boolean;
  /** R48, R123: satisfies the pull requirement. */
  isPull: boolean;
  /**
   * True when the movement loads the hands and forearms by pulling, whether
   * or not it satisfies R48. House rule `house.sc.open_hand_grip` reads this
   * to decide which rows need a grip tag; house rule
   * `house.sc.hard_finger_spacing` reads it with `fingerLoad`.
   */
  isPulling: boolean;
  /**
   * Reactive neuromuscular training: a band pulls the joint out of line and
   * the athlete resists it. House rule `house.sc.rnt_valgus_control`.
   */
  isRnt: boolean;
  /**
   * True when only the load ADDED to bodyweight is prescribed: a weighted
   * pull-up puts plates on a belt, so the number on the row is the plate
   * weight and the display reads "5 x BW + 45 lb" (house rule
   * `house.sc.upper_power_day`). Absent reads as false, and the shape is
   * inferred from the movement's own tags when it is, so every exercise
   * seeded before this field keeps the display it had.
   */
  addedLoad?: boolean;
  /**
   * The grip this row is performed in. Every pulling exercise carries one;
   * `any` means the athlete picks, and an `open_hand` variant exists beside it
   * for a finger-pulley history (house rule `house.sc.open_hand_grip`).
   */
  gripMode?: GripMode;
  /**
   * How hard this row loads the finger flexors. `hard` rows are spaced 48 h
   * apart and are removed on a finger-pain answer at or above the ceiling
   * (house rules `house.sc.hard_finger_spacing`, `house.sc.finger_pain_ceiling`).
   */
  fingerLoad?: FingerLoad;
  /**
   * Present on RNT rows: the set ends when knee alignment goes, not at a rep
   * count (house rule `house.sc.rnt_valgus_control`).
   */
  valgusProtocol?: { repTermination: 'alignment' };
  /**
   * Present on unilateral rows that must start on the weaker leg
   * (house rule `house.sc.weaker_side_first`).
   */
  sideOrder?: 'weaker_first';
  /**
   * Present when this row doubles as the readiness gate's neuromuscular test
   * (house rule `house.sc.readiness_gate`).
   */
  readinessTest?: { kind: ReadinessTestKind; metric: ReadinessMetric };
  /**
   * Sports this exercise may be selected for. Absent means every sport, which
   * is what every exercise seeded before speed climbing carries, so the pool
   * for basketball, football, soccer and track is unchanged.
   */
  sports?: Sport[];
  /** R7, R8, R9: pogo and sprint volume is cut or excluded on shin splints. */
  repetitiveImpact: boolean;
  /** Safety override: level caps, never an Epley estimate. */
  isOlympicLift: boolean;
  /** R43: placed early in the session. */
  technicalSkillHigh: boolean;
  tendonTarget?: TendonTarget;
  tendonMode?: TendonMode;
  /** R116 to R119 count exercises by intent. */
  intent: ExerciseIntent;
  /** R56: below this level the exercise is excluded. */
  levelMin: Level;
  /** Slots this exercise may fill (R35 to R40). */
  roleCandidates: ExerciseRole[];
  /** R57: main lifts do not rotate inside a block. */
  isMainLift: boolean;
  /** R57: accessories rotate within their group after 3 consecutive weeks. */
  rotationGroup?: string;
  /** Set count before Block 4 and Block 5 adjust it. */
  defaultSets: number;
  /** R66: prehab isometric holds, 30 to 45 s, constant within a session. */
  holdSecondsRange?: { minS: number; maxS: number };
  /** R102, R103: classification of the sprint. */
  sprintDistanceM?: number;
  /** House convention: each change-of-direction cut is one extensive contact. */
  codCutsPerRep?: number;
  /** Non-binding stepper hint only; never a load source (brief 09). */
  oneRmHintRatio?: number;
  /** Safety override: hard ceiling on ballistic load as a fraction of squat max. */
  ballisticCapPct?: number;
  /** R146: the Strength block prefers loadable exercises. */
  prefersLoadableInStrengthBlock: boolean;
  /** Depth jumps and other gated drills need the readiness checklist passed. */
  readinessRequired: boolean;
  /** House safety: at most 24 in, 18 in over 220 lb or unknown bodyweight. */
  dropHeightCapIn?: number;
  videoUrl?: string;
  cues: string[];
  /** Day types this exercise may appear on. */
  dayTypes: DayType[];
  /** Fixed categorical slot for charts and chips (DESIGN.md data palette). */
  categoryForCharts: ChartCategory;
}
