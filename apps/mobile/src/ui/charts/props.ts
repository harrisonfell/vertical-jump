/**
 * Chart data shapes.
 *
 * Charts know nothing about the store, the engine, or millimetres. Dates are
 * plain 'YYYY-MM-DD' local days and every value arrives in the unit the athlete
 * reads: inches for heights, whole percent for recovery and sleep, whole
 * milliseconds for HRV, m/s for velocity. The caller converts.
 */

/** A local calendar day, 'YYYY-MM-DD'. Never a Date: no timezone can shift it. */
export type IsoDay = string;

/** A point on an instrument's height stream. */
export interface JumpPoint {
  readonly date: IsoDay;
  readonly heightIn: number;
  /**
   * Canonical tests are filled dots and are the only points the trend sees.
   * Flagged attempts and non-canonical tests draw hollow.
   */
  readonly canonical: boolean;
  /** A flagged attempt: hollow, excluded from the trend. */
  readonly flagged?: boolean;
  /** The test that set the current PR on this stream. */
  readonly pr?: boolean;
  /** Shown in the tooltip and the table twin. Two streams never share a chart. */
  readonly instrument: string;
}

/** The program's opening height. `remembered` means it was typed, not measured. */
export interface BaselinePoint {
  readonly date: IsoDay;
  readonly heightIn: number;
  /** A remembered baseline draws hollow, like any non-canonical mark. */
  readonly remembered: boolean;
}

/** One vertex of a line the engine computed (Theil-Sen, projection, band edge). */
export interface SeriesPoint {
  readonly date: IsoDay;
  readonly heightIn: number;
}

/** A projection with its range. Dash is reserved for exactly this. */
export interface ProjectionBand {
  readonly line: readonly SeriesPoint[];
  readonly lower: readonly SeriesPoint[];
  readonly upper: readonly SeriesPoint[];
}

/** A device or app version change, drawn as a small labelled tick. */
export interface StreamBreak {
  readonly date: IsoDay;
  /** Plain words, e.g. "OVR Connect 2.1". */
  readonly label: string;
}

/** Everything one instrument stream's chart needs. */
export interface JumpChartData {
  readonly programStart: IsoDay;
  readonly targetDate: IsoDay;
  readonly today: IsoDay;
  readonly baseline: BaselinePoint;
  readonly goalIn: number;
  readonly tests: readonly JumpPoint[];
  readonly instrument: string;
  /** Theil-Sen segment over the observed range. The engine computes it. */
  readonly trend?: readonly SeriesPoint[];
  /** Present from six tests. */
  readonly projection?: ProjectionBand;
  readonly streamBreaks?: readonly StreamBreak[];
  /** Shown in the empty frame, e.g. "No tests yet. First test: Sat 13 Sep." */
  readonly emptyMessage?: string;
}

/** One calendar week of training load. */
export interface LoadWeek {
  readonly weekStart: IsoDay;
  readonly weekNumber: number;
  readonly sessionsDone: number;
  readonly sessionsScheduled: number;
  /** Session RPE times minutes, summed over the week. */
  readonly srpeLoad: number;
  /** Whoop strain, one entry per matched session. Evidence, never load. */
  readonly strains: readonly number[];
}

/** Which measure the recovery panel draws. */
export type RecoveryMeasure = 'recovery' | 'hrv' | 'sleep';

/**
 * One day of Whoop mirrors. `null` is a pending day: it is drawn as a gap and
 * never as a zero.
 */
export interface RecoveryDay {
  readonly date: IsoDay;
  /** Recovery score, whole percent. */
  readonly recovery: number | null;
  /** HRV, whole milliseconds. */
  readonly hrvMs: number | null;
  /** Sleep performance, whole percent. */
  readonly sleepPerformance: number | null;
}

/** The three recovery bands, in Whoop's own vocabulary. */
export type RecoveryBand = 'low' | 'moderate' | 'high';

/** One velocity session's load and mean velocity. */
export interface LoadVelocityPoint {
  readonly loadLb: number;
  readonly velocityMs: number;
}

/** A fitted load-velocity line with the fit quality the caller computed. */
export interface LoadVelocityFit {
  readonly from: LoadVelocityPoint;
  readonly to: LoadVelocityPoint;
  readonly n: number;
  readonly rSquared: number;
}

/**
 * Linked-crosshair control. Omit `onProbeChange` and a panel keeps its own
 * probe; pass both and the parent drives every panel from one pointer.
 */
export interface ProbeControl {
  readonly probeDay?: IsoDay | null;
  readonly onProbeChange?: (day: IsoDay | null) => void;
}
