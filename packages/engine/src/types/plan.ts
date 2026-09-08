/**
 * The plan tree: skeleton (pure, built up front, no exercises and no loads)
 * then the materialized week (exercises, per-set loads, and the snapshot the
 * decision was made from). Brief section 09 "Calendar and generation".
 */
import type {
  BlockType,
  DayType,
  DaysPerWeek,
  ExerciseId,
  ExerciseRole,
  LadderId,
  LiftId,
  LoadMode,
  LoadType,
  SessionBlockName,
  WeekKind,
} from './core.js';
import type { IsoInstant, LocalDate, Weekday } from './calendar.js';
import type { FingerLoad, SessionIntent } from './core.js';
import type { ReadinessOutcome, ReadinessTodayInput } from './readiness.js';
import type { Athlete, WorkingMax } from './athlete.js';
import type { Exercise, ProgressionLadder } from './exercise.js';
import type { Ruleset } from './ruleset.js';
import type { SessionRecord, SetLog, WeekOutcome } from './logs.js';
import type { PainCaps } from './pain.js';

/** Which main-lift slot a day type fills. */
export type MainLiftSlot = 'lower' | 'upper' | 'fullbody';

/** A block of the program. Strength then Power (R108). */
export interface PlanBlock {
  type: BlockType;
  weekFrom: number;
  weekTo: number;
}

/** One scheduled session in the skeleton. No exercises yet. */
export interface SkeletonSession {
  /** 0-based index into `PlanSkeleton.weekdays`, the template order. */
  dayIndex: number;
  weekday: Weekday;
  date: LocalDate;
  dayType: DayType;
  /** The test rides the k-th weekday pick (brief 09 "Weekly templates"). */
  isTestDay: boolean;
}

/** Everything week w needs before exercises are chosen. */
export interface SkeletonTargets {
  /** R82 to R84 range bottom for this level. */
  extensiveBottom: number;
  /** R82 to R84 range top for this level. */
  extensiveTop: number;
  /** H in the R89 trade: planned high-intensity contacts. */
  highIntensityAllowance: number;
  /** Reps, not contacts; each rep is 2 contacts (house convention). */
  depthJumpReps: number;
  /** R156 start percent offset above the scheme's low end, per load type. */
  startOffsetPct: Partial<Record<LoadType, number>>;
  /** R57: main lifts do not rotate inside a block. */
  mainLiftBySlot: Record<MainLiftSlot, ExerciseId>;
  /** R57: rotates after 3 consecutive weeks. */
  accessoryRotationSlot: number;
  /** Current rung per ladder; one per week, two per block, held in reduced weeks. */
  ladderRungs: Record<LadderId, number>;
  /** R100 runway position for this week. */
  tendonMode: 'isometric' | 'slow_resistance' | 'plyometric';
}

/** One week of the skeleton. */
export interface SkeletonWeek {
  /** 1-based week number inside the program. */
  w: number;
  kind: WeekKind;
  blockType: BlockType;
  /** Progressed-week counter. May be fractional: a small outcome adds 0.5. */
  k: number;
  /** Day 0 of the calendar week (the first chosen weekday). */
  windowStart: LocalDate;
  /** Day 6, inclusive. */
  windowEnd: LocalDate;
  sessions: SkeletonSession[];
  targets: SkeletonTargets;
  /** Set when R94 repeats a week; the Plan cell reads "Repeat of week N". */
  repeatOfWeek?: number;
  /** Post-generation lines, only when true (brief section 05 "Plan"). */
  notes: string[];
}

/** The Plan's forward view. Pure, built up front, no loads inside. */
export interface PlanSkeleton {
  programStart: LocalDate;
  targetDate: LocalDate;
  /** W = floor((target - start) / 7) + 1. */
  W: number;
  daysPerWeek: DaysPerWeek;
  /** Chosen weekdays in template order; index 0 is day 0. */
  weekdays: Weekday[];
  /** Index into `weekdays` where the weekly test sits. */
  testWeekdayIndex: number;
  blocks: PlanBlock[];
  weeks: SkeletonWeek[];
}

/** One prescribed set. Exactly what the runner renders, row for row (R148). */
export interface SetPrescription {
  /** 1-based; ramp sets carry their own numbering and display as R1, R2. */
  setNumber: number;
  /** Present when `displayMode` is reps. Exact, never a range. */
  reps?: number;
  /** Present when `displayMode` is time, for example a 30 s hold (R66). */
  durationS?: number;
  /** Present when `displayMode` is distance (R102, R103). */
  distanceM?: number;
  /** Percent of working max, absent in RPE mode and on non-loadable rows (R159). */
  loadPercent?: number;
  /** The load actually prescribed, before display conversion. */
  loadKg?: number;
  /** The string the runner shows, from `units.ts`: "5 x 205 lb", "30 s hold". */
  displayLoad: string;
  /**
   * A short qualifier for the row's second line, from `units.ts`: "2 cuts" on
   * a change-of-direction rep. The prescription line stays one measurement.
   */
  detailLine?: string;
  /** R158 per-set RPE; the only per-set display in RPE mode. */
  targetRpe?: number;
  /**
   * The load may be left blank: bodyweight alone completes this set, and
   * anything added rides on top of it. Set on a tendon row, where the same
   * movement is a bodyweight calf raise until a dumbbell is in the hand, so a
   * runner that refused to log without a weight would refuse the set the
   * athlete actually did.
   */
  optionalLoad?: boolean;
  /** One value, the longest applicable rule (R164). */
  restS: number;
  /** Plain words naming the rule the rest came from, for the session detail. */
  restRule: string;
  /** R157: a 60% or 70% ramp set, excluded from the all-reps check. */
  isRamp: boolean;
  /** R155: the top set repeated because the cap was reached. */
  isHeld: boolean;
  /** Velocity mode: the target mean-velocity zone, in m/s. */
  velocityZone?: { lowMs: number; highMs: number };
  /** Velocity mode: stop the set at this percent loss (10 power, 20 strength). */
  velocityLossCutoffPct?: number;
  /** The unreduced prescription when soreness (R27) or a pain tier-down cut it. */
  original?: SetPrescription;
}

/** One exercise row inside a session block. */
export interface SessionExercise {
  exerciseId: ExerciseId;
  name: string;
  block: SessionBlockName;
  role: ExerciseRole;
  loadType: LoadType;
  loadMode: LoadMode;
  /** Implementation checklist: unilateral rows show a "both sides" reminder. */
  bothSides: boolean;
  sets: SetPrescription[];
  /** One displayed rest value for the whole exercise (R164). */
  restS: number;
  restRule: string;
  /** Where the working max came from: "entered 275 lb", "est. 275 lb, Epley". */
  sourceLine: string;
  /** "last 5 x 205 / 4 x 220 / 3 x 235" when a prior log exists. */
  lastTimeLine?: string;
  /** "Rotated from Bulgarian split squat (3 weeks)" (R57). */
  rotationNote?: string;
  /** "Held at the 87% cap" or "Capped at 80%: mild knee pain" (R155, R163). */
  capNote?: string;
  /** The runner asks for a landing rating on the last set of a jump. */
  landingPromptOnLastSet: boolean;
  /** House convention: every landing counts. */
  contactsPerRep: number;
  /**
   * "Weaker side first: left" on a unilateral row once a side is known
   * (house rule `house.sc.weaker_side_first`).
   */
  sideNote?: string;
  /**
   * Why this row's finger load is what it is: "Open hand only", "Hard finger
   * work, 48 h since the last one" (house rules `house.sc.open_hand_grip`,
   * `house.sc.hard_finger_spacing`).
   */
  fingerNote?: string;
  ladderId?: LadderId;
  rung?: number;
  boxHeightIn?: number;
  cues: string[];
}

/** A named block of a session, in its legal placement order (R29 to R39). */
export interface SessionBlock {
  name: SessionBlockName;
  /** Warm-up and cool-down render as one grouped row, not four exercise rows. */
  grouped: boolean;
  exercises: SessionExercise[];
}

/** Counted contacts for one session, with the hard caps beside them. */
export interface SessionContacts {
  extensive: number;
  highIntensity: number;
  highAmplitude: number;
  /** The R89 target E for this session. */
  targetExtensive: number;
  /** R85 hard cap. */
  capHigh: 25;
  /** R52 hard cap. */
  capAmplitude: 20;
}

/** The weekly test's state on this session (brief section 12). */
export type TestStatus = 'planned' | 'done' | 'deferred' | 'missed';

/** One materialized session. */
export interface SessionPlan {
  id: string;
  date: LocalDate;
  weekday: Weekday;
  dayType: DayType;
  isTestDay: boolean;
  /**
   * House definition: a heavy-strength top set at or above 85% or RPE 8.5, or
   * 10 or more high-intensity contacts, or any depth-jump session. The test
   * day always qualifies (R90 to R93 key off this).
   */
  isMaximalCns: boolean;
  estimatedMinutes: number;
  /** Appended to the header: "deload", "test day", "repeat of week 6". */
  headerSuffixes: string[];
  /** Plain-words notices shown above the blocks, no rule numbers. */
  notices: string[];
  blocks: SessionBlock[];
  contacts: SessionContacts;
  /** Rows removed to hold the 8-exercise cap or a joint budget, with why. */
  trimmed: { exerciseId: ExerciseId; reason: string }[];
  testStatus?: TestStatus;
  /**
   * The hardest finger load in this session, `none` when nothing here loads
   * the fingers. The 48 h spacing rule reads this
   * (house rule `house.sc.hard_finger_spacing`).
   */
  fingerLoad: FingerLoad;
  /**
   * True when this session carries the RNT knee-alignment row
   * (house rule `house.sc.rnt_valgus_control`).
   */
  rntScheduled: boolean;
  /**
   * What this session is for beside its day type. Absent means the day type's
   * own intent (house rule `house.sc.upper_power_day`).
   */
  sessionIntent?: SessionIntent;
  /**
   * Today's readiness gate, when both channels or the neuromuscular one alone
   * had data. Applies to this session only
   * (house rule `house.sc.readiness_gate`).
   */
  readiness?: ReadinessOutcome;
}

/** What the engine decided from, stored so a week is reproducible. */
export interface GenerationSnapshot {
  /** Week w-1 adherence as a fraction, 0 to 1. */
  adherenceUsed: number;
  outcome: WeekOutcome;
  workingMaxes: WorkingMax[];
  targets: SkeletonTargets;
  /** The progressed-week counter this week ran at (R89, R66). */
  k: number;
  seed: number;
  rulesetVersion: string;
  generatedAt: IsoInstant;
}

/** One materialized week. */
export interface WeekPlan {
  w: number;
  kind: WeekKind;
  blockType: BlockType;
  windowStart: LocalDate;
  windowEnd: LocalDate;
  sessions: SessionPlan[];
  snapshot: GenerationSnapshot;
  /** Absent in week 1: there is no prior week to judge. */
  outcome?: { kind: WeekOutcome; line: string };
  /** Post-generation lines, only when true (brief section 05 "Plan"). */
  lines: string[];
  repeatOfWeek?: number;
  /**
   * The `houseRules` ids this week actually applied, in ruleset order, so the
   * Plan's rules summary can show which entries are live for this athlete.
   * Every id resolves through `findHouseRule`.
   */
  houseRuleIds?: string[];
}

/** Prior-week material `materializeWeek` reads to apply R94 to R98. */
export interface PreviousWeekContext {
  plan: WeekPlan;
  logs: SetLog[];
  sessions: SessionRecord[];
}

/** Rolling state the generator carries between weeks. */
export interface MaterializeHistory {
  /** False for a chained or regenerated program: R76 and R92 apply only to a first one. */
  firstProgram?: boolean;
  /** How many percent weeks each lift has already run; 0 means its first one. */
  percentWeekIndexByLift?: Record<LiftId, number>;
  /** R111 house: the working max each lift carried at this block's first week. */
  blockStartWorkingMaxKg?: Record<LiftId, number>;
  /** Consecutive prior failed weeks per lift, which turn the R97 drop into 10 percent. */
  failStreaks?: Record<LiftId, number>;
  /** The last completed session date, for the 14-day re-entry card. */
  lastCompletedDate?: LocalDate;
  /** Weeks (1-based) each exercise has appeared in, ascending. Drives R57. */
  rotationHistory: Record<ExerciseId, number[]>;
  /** Current rung and how many rungs were spent this block, per ladder. */
  ladderState: Record<LadderId, { rung: number; advancesThisBlock: number }>;
  /** R26: high-stress exercise counts per joint in week w-1. */
  jointHighStressLastWeek: Record<'knee' | 'spine' | 'shoulder', number>;
  /** Adherence fractions for the weeks before w, oldest first (R130, R131). */
  consecutiveAdherence: number[];
  /** R110 house: five canonical tests inside the noise band. */
  testPlateau: boolean;
  /** R110 house: a main lift whose working max has not risen across a block. */
  liftPlateau: Record<LiftId, boolean>;
  /** R111 house: working max up 10% or more since block start. */
  liftRaisedSinceBlockStart: Record<LiftId, boolean>;
  /** R27: today's answer, when the athlete gave one. */
  sorenessToday?: number | null;
  /**
   * House `house.sc.finger_pain_ceiling`: today's 0 to 10 finger-pain answer,
   * asked before a session with hard finger work. Above the athlete's ceiling
   * the hard finger rows leave today's session and a notice says so. Absent
   * or null means the question was not asked or was skipped.
   */
  fingerPainToday?: number | null;
  /**
   * House `house.sc.readiness_gate`: today's two channels. Absent means the
   * gate does not run, so no session changes and no line is written.
   */
  readinessToday?: ReadinessTodayInput;
}

/** Everything `materializeWeek` is allowed to read. Pure: no clock, no random. */
export interface MaterializeContext {
  athlete: Athlete;
  ruleset: Ruleset;
  exercises: Exercise[];
  ladders: ProgressionLadder[];
  skeleton: PlanSkeleton;
  /** 1-based week to materialize. */
  w: number;
  prevWeek?: PreviousWeekContext;
  workingMaxes: WorkingMax[];
  history: MaterializeHistory;
  today: LocalDate;
  /** Every choice among equals goes through `mulberry32(seed)`. */
  seed: number;
  /**
   * Logs from the weeks before w, for the four-week Epley lookback (R73).
   * `prevWeek.logs` alone only reaches back one week.
   */
  recentLogs?: SetLog[];
  /** The instant the snapshot is frozen at. Pure: never `Date.now()`. */
  generatedAt?: IsoInstant;
}

/** The per-set prescription function's whole view of the week (Block 6). */
export interface WeekContext {
  w: number;
  kind: WeekKind;
  blockType: BlockType;
  /** Progressed-week counter, possibly fractional. */
  k: number;
  targets: SkeletonTargets;
  /** True only in week 1 of a first program (R76). */
  isFirstProgramWeek1: boolean;
  /** R107 house guard: this lift's first percent week caps the top set at 80%. */
  isFirstPercentWeekForLift: boolean;
  /** R27: today's soreness answer drives the one-tier reduction. */
  sorenessToday?: number | null;
  /** Block 1 caps scoped to the attributes the pain rule names (R163). */
  painCapPct?: number;
  /** The frozen working max for this lift, absent in RPE mode. */
  workingMax?: WorkingMax;
  /** Set count after Block 4 has adjusted the exercise default. */
  sets: number;
  ruleset: Ruleset;
  /**
   * R109: the Power block retags the secondary lift `strength_speed` without
   * cloning the seeded exercise. Wins over `exercise.loadType`.
   */
  loadTypeOverride?: LoadType;
  /** Which slot this exercise fills, for the R164 rest category. */
  role?: ExerciseRole;
  /** R161: advanced may run 5/3/1 instead of 5/4/3 on heavy strength. */
  useFiveThreeOne?: boolean;
  /**
   * R163 read as scoped: the Block 1 cap binds only the attributes the pain
   * rule names. Richer than `painCapPct`, which is unscoped.
   */
  painCaps?: PainCaps;
  /** Plain words for the cap note: "Capped at 80%: mild knee pain". */
  painCapReason?: string;
  /**
   * A cap the DAY imposes rather than the athlete or the lift: the upper-power
   * day holds its top set one step below the maximal-CNS threshold so R90 and
   * R93 still hold across a four-day week
   * (house rule `house.sc.upper_power_day`). Lowest cap wins, as always.
   */
  dayCapPct?: number;
  /** Plain words for that cap: "Held at 80%: the day before your jump day". */
  dayCapNote?: string;
  /** The same day cap in RPE mode, so an RPE row cannot reach RPE 8.5 there. */
  dayRpeCap?: number;
  /**
   * How many percent weeks this lift has already run, 0 in its first one. The
   * week-2 guard starts at 80 percent and rises one 5 percent step from here.
   */
  percentWeekIndexForLift?: number;
  /**
   * Ballistic loads are a percent of the SQUAT max, not of the jump's own max.
   * When absent, `workingMax` is taken to be the squat max already.
   */
  squatWorkingMax?: WorkingMax;
  /** Reps for non-loadable and mobility rows, which carry no rep tag. */
  repsPerSet?: number;
  /**
   * R66: how many consecutive weeks this prehab hold has already run, so a
   * newly introduced isometric starts at the range bottom rather than at the
   * program's progressed-week counter. Falls back to `k` when absent.
   */
  holdWeekIndex?: number;
  /**
   * R105: the most reps a set may carry in a deload or taper, so the week
   * lands at 40 to 50 percent of the prior week even when the scheme's low rep
   * value alone would not get it there. Never raises a rep count.
   */
  reducedRepsCap?: number;
  /**
   * R105 read as "loads held": how many working sets the preceding load week
   * ran for this lift, so a deload or taper rebuilds that week's ladder and
   * takes its tail instead of climbing to the level cap. Absent outside a
   * reduced week.
   */
  priorLoadWeekSets?: number;
}
