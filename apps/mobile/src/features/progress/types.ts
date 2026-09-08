import type { JumpTest as EngineJumpTest, Instrument, Ruleset } from '@vert/engine';
import type { PaceReadout, RecoveryOutputTable } from '@vert/engine/analytics';
import type {
  Athlete,
  JumpTestWithReps,
  LiftSetRow,
  LocalDate,
  Program,
  ReadinessTestSession,
  SessionWithStatus,
  SingleLegTest,
  Week,
  WhoopConnection,
  WhoopRecovery,
  WhoopSleepDay,
  WhoopWorkout,
} from '@/data';
import type { JumpChartData, LoadWeek, RecoveryDay } from '@/ui/charts';

/**
 * Everything Progress reads, in one bag.
 *
 * The screen loads it with hooks and the selectors are pure over it, so every
 * state in brief section 06 can be produced in a test by handing this shape
 * different rows rather than by mocking a database.
 */
export interface ProgressSources {
  readonly today: LocalDate;
  readonly athlete: Athlete | null;
  readonly program: Program | null;
  readonly weeks: readonly Week[];
  readonly sessions: readonly SessionWithStatus[];
  /** Every test on every stream, oldest first, canonical or not. */
  readonly tests: readonly JumpTestWithReps[];
  readonly recovery: readonly WhoopRecovery[];
  readonly sleep: readonly WhoopSleepDay[];
  readonly workouts: readonly WhoopWorkout[];
  readonly liftSets: readonly LiftSetRow[];
  /**
   * Channel B of the readiness gate, oldest first
   * (`house.sc.readiness_gate`). Empty for an athlete the gate never ran for,
   * and the Readiness section is then absent rather than empty.
   */
  readonly readinessTests: readonly ReadinessTestSession[];
  /**
   * The asymmetry stream (`house.sc.asymmetry_tracking`), oldest first. Its
   * rows are jump tests in their own mode, so they never reach the trend, the
   * pace, the PR threshold or the ledger.
   */
  readonly singleLegTests: readonly SingleLegTest[];
  readonly connection: WhoopConnection | null;
  /** Stamps from kv; a card stays until the athlete acknowledges it. */
  readonly goalAcknowledgedAt: string | null;
  readonly programAcknowledgedAt: string | null;
  readonly ruleset: Ruleset;
}

/** The one big number and the four figures that sit beside it. */
export interface HeadlineModel {
  /** "32.5", already formatted. Null before the first canonical test. */
  readonly valueIn: string | null;
  readonly instrumentLabel: string;
  readonly mode: string;
  readonly isPr: boolean;
  readonly prIn: string | null;
  readonly goalIn: string;
  /** Signed: "+3.5" means the goal is still that far above. */
  readonly gapIn: string;
  readonly weeksLeft: string;
  readonly testedOn: LocalDate | null;
  /** The last six canonical bests on the stream, oldest first, in inches. */
  readonly sparkline: readonly number[];
  readonly sparklineLabel: string;
  /** Why the PR threshold is what it is (brief section 08). */
  readonly thresholdReason: string;
}

/** One row of the Weeks table. */
export interface WeekRow {
  readonly w: number;
  readonly label: string;
  readonly sessions: string;
  readonly percent: string;
  readonly allReps: string;
  readonly outcome: string;
  readonly reviewLine: string;
  readonly isCurrent: boolean;
}

/** One row of the test ledger. */
export interface LedgerRow {
  readonly id: string;
  readonly date: LocalDate;
  readonly dateLabel: string;
  readonly instrumentLabel: string;
  readonly mode: string;
  readonly attempts: number;
  readonly flagged: number;
  readonly bestIn: string;
  readonly spreadIn: string;
  readonly canonical: boolean;
  readonly isBaseline: boolean;
  readonly isPr: boolean;
  readonly bodyweightLb: string | null;
  readonly notes: string | null;
}

/** One loadable lift, with its working max and everything behind it. */
export interface LiftRow {
  readonly exerciseId: string;
  readonly name: string;
  readonly workingMaxLb: string | null;
  readonly sourceLine: string;
  /** "Loads −5% after missed reps · 19 Oct", when a drop is in the history. */
  readonly dropLine: string | null;
  readonly topSets: readonly TopSetRow[];
  readonly velocityPoints: readonly { readonly loadLb: number; readonly velocityMs: number }[];
}

export interface TopSetRow {
  readonly date: LocalDate;
  readonly dateLabel: string;
  readonly setLabel: string;
  readonly rpe: string;
}

/** One RSI-mode session reduced to the numbers the readiness section shows. */
export interface ReadinessRow {
  readonly id: string;
  readonly date: LocalDate;
  readonly dateLabel: string;
  readonly reactive: number;
  readonly nonReactive: number;
  readonly meanRsi: string;
  readonly bestRsi: string;
  readonly meanGct: string;
  readonly bestHeight: string;
}

/** One attempt inside the latest RSI session, greyed when non-reactive. */
export interface ReadinessRep {
  readonly repNumber: number;
  readonly heightIn: string;
  readonly gctMs: string;
  readonly rsi: string;
  readonly reactive: boolean;
}

/** The card that sits above everything until it is acknowledged. */
export interface ProgressCard {
  readonly kind: 'goal_reached' | 'program_complete';
  readonly eyebrow: string;
  readonly value: string | null;
  readonly line: string;
  readonly instrument: string;
  readonly primaryLabel: string;
  readonly secondaryLabel: string | null;
}

/** Everything the screen renders, already formatted. */
export interface ProgressModel {
  readonly hasProgram: boolean;
  readonly hasTests: boolean;
  readonly instrument: Instrument;
  readonly mode: string;
  readonly reviewLine: string;
  readonly headline: HeadlineModel;
  readonly pace: PaceReadout | null;
  readonly paceLine: string;
  readonly noiseNote: string | null;
  /** "Early trend · 4 tests." while the fit is still short (3 to 5 tests). */
  readonly trendCaption: string | null;
  readonly targetPassed: boolean;
  readonly card: ProgressCard | null;
  /**
   * One display number a screen. While a card is up it owns that size, so the
   * headline below drops to title and the rule cannot be broken by a screen
   * that forgets to ask.
   */
  readonly compactHeadline: boolean;
  readonly streamNotes: readonly string[];
  readonly chart: JumpChartData | null;
  readonly loadWeeks: readonly LoadWeek[];
  readonly recoveryDays: readonly RecoveryDay[];
  readonly recoveryMedian: number | null;
  readonly recoveryCaption: string | null;
  readonly weekRows: readonly WeekRow[];
  readonly earlierRows: readonly WeekRow[];
  readonly ledger: readonly LedgerRow[];
  readonly lifts: readonly LiftRow[];
  /** Null until a weighted pull-up set is on file. */
  readonly pullUp: PullUpModel | null;
  /** Null until one single-leg test exists, and the section is then absent. */
  readonly asymmetry: AsymmetryModel | null;
  /** Null for an athlete the gate never ran for. */
  readonly readinessGate: ReadinessGateModel | null;
  readonly readiness: readonly ReadinessRow[];
  readonly readinessReps: readonly ReadinessRep[];
  readonly recoveryOutput: RecoveryOutputTable;
  readonly recoveryDots: readonly RecoveryDotBand[];
  readonly bodyweight: readonly { readonly date: string; readonly lb: string }[];
}

/* ----------------------------------------------- pull-up strength */

/** One week's estimated added-load max, for the small trend line. */
export interface PullUpPoint {
  readonly w: number;
  readonly weekLabel: string;
  readonly date: LocalDate;
  readonly dateLabel: string;
  /** Added load in pounds, on the 5 lb grid. Bodyweight is never in it. */
  readonly addedLb: number;
  /** "40 lb", already formatted. */
  readonly label: string;
  /** The set the estimate came from: "5 × BW + 35 lb". */
  readonly fromLabel: string;
}

/**
 * The strongest single correlate in the owner's spec (pull-up strength against
 * wall time, r = −0.74), so it gets a section of its own beside the jump
 * number rather than a row inside Lifts.
 */
export interface PullUpModel {
  readonly exerciseId: string;
  readonly name: string;
  /** Added load only. Null before a working max exists. */
  readonly workingMaxLb: string | null;
  readonly sourceLine: string;
  /** "Loads −5% after missed reps · 19 Oct", when a drop is in the history. */
  readonly dropLine: string | null;
  readonly trend: readonly PullUpPoint[];
  readonly trendCaption: string;
  readonly topSets: readonly TopSetRow[];
  /** The one correlate sentence, said once on the screen. */
  readonly correlateLine: string;
}

/* ------------------------------------------------------- asymmetry */

/** One single-leg test, read into the words the section shows. */
export interface AsymmetryRow {
  readonly id: string;
  readonly date: LocalDate;
  readonly dateLabel: string;
  readonly leftIn: string;
  readonly rightIn: string;
  /** Signed and whole: "−9%" means the right leg is the weaker one. */
  readonly pct: string;
  /** "Left", "Right", or "Level" inside the band. */
  readonly weakerSide: string;
  readonly band: 'balanced' | 'watch' | 'flag';
}

/** The Asymmetry section. Null until one single-leg test exists. */
export interface AsymmetryModel {
  readonly rows: readonly AsymmetryRow[];
  /** The latest test in the engine's own words. */
  readonly latestLine: string;
  /** The band this athlete is in, in plain words. */
  readonly note: string;
  /** The three bands as one sentence, so the note has its scale beside it. */
  readonly legend: string;
  /** The direction across tests, from two tests up. */
  readonly trendLine: string | null;
  /**
   * What the two legs reported on unilateral work logged per side, or null when
   * nothing has been logged that way. Not a test and not a measurement: the
   * effort the athlete gave each leg at the same load.
   */
  readonly effortLine: string | null;
  /** Which leg goes first on unilateral work, or null when none is named. */
  readonly weakerSide: 'left' | 'right' | null;
  readonly orderLine: string;
}

/* -------------------------------------------------------- readiness gate */

/** One day of the gate, both channels kept apart. */
export interface ReadinessGateDay {
  readonly date: LocalDate;
  readonly dateLabel: string;
  readonly autonomic: 'high' | 'low' | 'unknown';
  readonly neuromuscular: 'high' | 'low' | 'unknown';
  readonly state: ReadinessStateName;
  /** The two channels disagree, which is the signal the gate is built on. */
  readonly diverged: boolean;
  /** Whoop's own band word, for the dot's colour and its label. */
  readonly recoveryBand: 'low' | 'moderate' | 'high' | null;
  readonly recoveryScore: number | null;
  /** "7.2 m", or null on a day with no output test. */
  readonly testValue: string | null;
  /** Read aloud in place of the two dots. */
  readonly label: string;
}

/** The five states the gate can be in. Mirrors the engine's own union. */
export type ReadinessStateName =
  | 'both_high'
  | 'autonomic_low'
  | 'neuromuscular_low'
  | 'both_low'
  | 'unknown';

/** One state spelled out: what each channel read, and what it does. */
export interface ReadinessLegendItem {
  readonly state: ReadinessStateName;
  readonly title: string;
  readonly line: string;
  readonly diverged: boolean;
}

/** The Readiness section: the last 30 days, both channels, never averaged. */
export interface ReadinessGateModel {
  readonly days: readonly ReadinessGateDay[];
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly divergenceCount: number;
  readonly divergenceLine: string;
  readonly legend: readonly ReadinessLegendItem[];
  /** Today's line from the gate itself, or null when it did not run. */
  readonly todayLine: string | null;
  /** "throw", "jump", "RSI": what the neuromuscular row is measuring. */
  readonly testNoun: string;
}

/** One band's session RPEs, for the jittered dot strip. */
export interface RecoveryDotBand {
  readonly band: 'low' | 'moderate' | 'high';
  readonly label: string;
  readonly values: readonly number[];
}

/** The store's test shape, converted once for the engine's analytics. */
export type BridgedTest = EngineJumpTest;
