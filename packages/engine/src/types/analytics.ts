/**
 * Jump-test records and the five honest readouts built from them.
 * Every jump number belongs to an instrument stream; streams never share a
 * trend line, a PR, or an axis (brief section 08 "Analytics").
 */
import type { Instrument } from './core.js';
import type { IsoInstant, LocalDate } from './calendar.js';

/** How a number got into the app (brief section 12). */
export type EntrySource = 'typed' | 'imported' | 'estimated';

/** One attempt inside a test session. */
export interface JumpRep {
  id: string;
  /** 1-based attempt number inside the session. */
  repNumber: number;
  /** Stored in millimetres, shown at 0.1 in. */
  heightMm: number;
  /** Ground contact time in whole milliseconds, RSI mode only. */
  gctMs?: number;
  /** Reactive strength index the app computes: height over contact time. */
  rsiCalc?: number;
  /** RSI as the device displayed it, kept for the discrepancy check. */
  rsiDevice?: number;
  /** Landed outside the 18 in field, or read under 6 in. */
  flagged: boolean;
  rejectReason?: string;
  entrySource: EntrySource;
  importBatchId?: string;
}

/** One jump-test session. The unit of the trend and the PR. */
export interface JumpTest {
  id: string;
  date: LocalDate;
  instrument: Instrument;
  /** Device mode: Regular, RSI, GCT, or the manual method used. */
  mode: string;
  /** The unit the device was set to when the number was read. */
  unitPreference: 'in' | 'cm';
  /** Step-off height for a drop-jump test. */
  boxHeightIn?: number;
  deviceFirmware?: string;
  ovrConnectVersion?: string;
  /** Week-one numbers are baseline, not PRs. */
  isBaseline: boolean;
  /** Only canonical tests feed the trend, the PR, and the chart's filled dots. */
  canonical: boolean;
  /** True when the test was the week's scheduled one. */
  scheduled: boolean;
  sessionId?: string;
  bodyweightKg?: number;
  /** Recovery, HRV and sleep as they stood that morning. */
  whoopSnapshot?: Record<string, number | null>;
  notes?: string;
  reps: JumpRep[];
  createdAt: IsoInstant;
}

/** A PR row per stream (brief section 12 MetricPR). */
export interface MetricPr {
  instrument: Instrument;
  mode: string;
  heightMm: number;
  sessionId: string;
  /** The threshold in inches that was in force when the PR fired. */
  thresholdUsedIn: number;
}

/** How the calibration spread behind a PR threshold was measured. */
export type PrThresholdMethod = 'residual' | 'within_session' | 'default';

/** The per-stream PR threshold and why it is what it is. */
export interface PrThresholdResult {
  instrument: Instrument;
  /** Default 1.0 in above the stream's prior PR. */
  thresholdIn: number;
  /** True once the athlete's own test noise raised it. */
  recalibrated: boolean;
  /**
   * The athlete's test noise in inches: the spread around the trend of session
   * bests, floored at the device's 0.1 in. Null before it can be measured.
   */
  spreadIn: number | null;
  /** Residual around the trend, the attempts inside sessions, or no measure. */
  method: PrThresholdMethod;
  /** Sessions since the stream break that the spread was measured from. */
  sessions: number;
  /** Plain words for Progress: why the threshold is what it is. */
  reason: string;
}

/** A Theil-Sen fit over canonical tests. */
export interface TrendResult {
  /** Median pairwise slope, inches per week. */
  slopeInPerWk: number;
  /** Low end of the range shown beside the slope. */
  low: number;
  /** High end of the range shown beside the slope. */
  high: number;
  /** Canonical tests the fit used. */
  n: number;
  method: 'theil_sen';
  /** Residual SD in inches, floored at 0.6 until eight tests exist. */
  residualSdIn: number;
  /** True while the floor is doing the work. */
  sdFloored: boolean;
  /** Intercept in inches at the fit's own x origin, for drawing the line. */
  interceptIn: number;
}

/** A dashed projection band from six tests (brief section 08 "Primary chart"). */
export interface ProjectionResult {
  /** Projected height at the target date, in inches. */
  atTargetIn: number;
  /** Band low and high in inches at the target date. */
  lowIn: number;
  highIn: number;
  n: number;
  targetDate: LocalDate;
}

/**
 * The five honest pace states. `line` is the exact sentence Progress shows,
 * built with the units formatters, never a colored pill.
 */
export type PaceState =
  | {
      kind: 'needs_tests';
      /** Canonical tests logged so far. */
      logged: number;
      /** Tests needed before a trend is stated. */
      needed: number;
      /** "Trend needs 4 tests (2 logged)" */
      line: string;
    }
  | {
      kind: 'too_early';
      trend: TrendResult;
      requiredInPerWk: number;
      /** "Trend +0.31 in/wk (range 1 SE: +0.05 to +0.57) vs required +0.29. Too early to call." */
      line: string;
    }
  | {
      kind: 'tracking';
      trend: TrendResult;
      requiredInPerWk: number;
      verdict: 'ahead' | 'on_pace' | 'behind';
      projection: ProjectionResult;
      /** "Trend +0.12 in/wk (range +0.03 to +0.21) vs required +0.29. Behind pace: ..." */
      line: string;
    }
  | {
      kind: 'goal_met';
      latestIn: number;
      goalIn: number;
      /** Tests at or above the goal. */
      testsAtOrAbove: number;
      /** "Goal met - latest 36.5 vs goal 36.0 - 2 tests at or above." */
      line: string;
    }
  | {
      kind: 'plateau';
      tests: number;
      bandIn: number;
      trend: TrendResult;
      /** "Plateau: 5 tests within 0.5 in (trend +0.02 in/wk). Next block varies exercise selection." */
      line: string;
    };

/** One (x, y) point for the trend fit: weeks since program start, inches. */
export interface TrendPoint {
  weeks: number;
  valueIn: number;
  date: LocalDate;
}
