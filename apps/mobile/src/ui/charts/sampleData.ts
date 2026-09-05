/**
 * Realistic sample data for the chart gallery at app/dev/charts.tsx.
 *
 * The trend and projection helpers here exist only so the gallery draws honest
 * geometry from its own numbers. In the app the engine owns both: charts take
 * trend and projection as props and never fit anything themselves.
 */

import type {
  JumpChartData,
  JumpPoint,
  LoadVelocityFit,
  LoadVelocityPoint,
  LoadWeek,
  ProjectionBand,
  RecoveryDay,
  SeriesPoint,
} from './props';
import { addDays, daysBetween, parseDay } from './scale';

export const PROGRAM_START = '2026-09-08';
export const TARGET_DATE = '2026-11-29';
export const TODAY = '2026-10-20';
export const BASELINE_IN = 29.4;
export const GOAL_IN = 36;
export const INSTRUMENT = 'OVR Jump';

/** The first six test Saturdays of the program. */
const TEST_DAYS = [
  '2026-09-12',
  '2026-09-19',
  '2026-09-26',
  '2026-10-03',
  '2026-10-10',
  '2026-10-17',
] as const;

const HEIGHTS = [29.6, 30.1, 29.9, 30.8, 31.2, 32.5] as const;

function test(date: string, heightIn: number, extra: Partial<JumpPoint> = {}): JumpPoint {
  return { date, heightIn, canonical: true, instrument: INSTRUMENT, ...extra };
}

/** Median of a numeric list. */
function med(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Theil-Sen over the observed range: the median of all pairwise slopes. */
export function sampleTrend(points: readonly JumpPoint[]): readonly SeriesPoint[] {
  if (points.length < 3) return [];
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      if (a === undefined || b === undefined) continue;
      const dx = parseDay(b.date) - parseDay(a.date);
      if (dx !== 0) slopes.push((b.heightIn - a.heightIn) / dx);
    }
  }
  const slope = med(slopes);
  const intercepts = points.map((point) => point.heightIn - slope * parseDay(point.date));
  const intercept = med(intercepts);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];
  return [
    { date: first.date, heightIn: slope * parseDay(first.date) + intercept },
    { date: last.date, heightIn: slope * parseDay(last.date) + intercept },
  ];
}

/**
 * The projection from six tests: the trend carried to the target date inside a
 * band that widens with distance. The residual SD is floored at 0.6 in, as it
 * is in the engine until eight tests exist.
 */
export function sampleProjection(
  points: readonly JumpPoint[],
  targetDate: string,
): ProjectionBand | undefined {
  if (points.length < 6) return undefined;
  const trend = sampleTrend(points);
  const start = trend[0];
  const end = trend[1];
  if (start === undefined || end === undefined) return undefined;

  const days = parseDay(end.date) - parseDay(start.date);
  const slope = days === 0 ? 0 : (end.heightIn - start.heightIn) / days;
  const sd = Math.max(
    0.6,
    Math.sqrt(
      points.reduce((sum, point) => {
        const fitted = start.heightIn + slope * (parseDay(point.date) - parseDay(start.date));
        return sum + (point.heightIn - fitted) ** 2;
      }, 0) / Math.max(1, points.length - 2),
    ),
  );

  const steps = 6;
  const span = daysBetween(end.date, targetDate);
  const line: SeriesPoint[] = [];
  const upper: SeriesPoint[] = [];
  const lower: SeriesPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const offset = Math.round((span * i) / steps);
    const date = addDays(end.date, offset);
    const value = end.heightIn + slope * offset;
    const width = sd * Math.sqrt(1 + offset / 14);
    line.push({ date, heightIn: value });
    upper.push({ date, heightIn: value + width });
    lower.push({ date, heightIn: value - width });
  }
  return { line, upper, lower };
}

function frame(tests: readonly JumpPoint[], overrides: Partial<JumpChartData> = {}): JumpChartData {
  const trend = sampleTrend(tests);
  return {
    programStart: PROGRAM_START,
    targetDate: TARGET_DATE,
    today: TODAY,
    baseline: { date: PROGRAM_START, heightIn: BASELINE_IN, remembered: true },
    goalIn: GOAL_IN,
    tests,
    instrument: INSTRUMENT,
    ...(trend.length > 0 ? { trend } : {}),
    ...overrides,
  };
}

/** No tests yet: the frame, the baseline, the goal, and the required pace. */
export const noTests: JumpChartData = frame([], {
  emptyMessage: 'No tests yet. First test: Sat 12 Sep.',
});

/** Two tests: dots, no line. */
export const twoTests: JumpChartData = frame(
  TEST_DAYS.slice(0, 2).map((day, i) => test(day, HEIGHTS[i] ?? 0)),
);

/** Four tests: the early trend segment. */
export const earlyTrend: JumpChartData = frame(
  TEST_DAYS.slice(0, 4).map((day, i) => test(day, HEIGHTS[i] ?? 0)),
);

const sixTests: readonly JumpPoint[] = TEST_DAYS.map((day, i) =>
  test(day, HEIGHTS[i] ?? 0, i === TEST_DAYS.length - 1 ? { pr: true } : {}),
);

/** Six tests: the projection band reaches the target date. */
export const withProjection: JumpChartData = frame(sixTests, {
  projection: sampleProjection(sixTests, TARGET_DATE),
});

/** A flagged attempt and a non-canonical test, both hollow and both off the trend. */
export const withHollowMarks: JumpChartData = frame([
  ...sixTests,
  test('2026-10-06', 33.8, { canonical: true, flagged: true }),
  test('2026-09-29', 28.9, { canonical: false }),
]);

/** Goal met: two tests at or above the goal, no projection. */
const metTests: readonly JumpPoint[] = [
  ...TEST_DAYS.slice(0, 4).map((day, i) => test(day, HEIGHTS[i] ?? 0)),
  test('2026-10-10', 34.9),
  test('2026-10-17', 36.5, { pr: true }),
];
export const goalMet: JumpChartData = frame(metTests);

/** Plateau: five tests inside half an inch of each other. */
const plateauTests: readonly JumpPoint[] = [
  test('2026-09-12', 31.9),
  test('2026-09-19', 32.2),
  test('2026-09-26', 31.8),
  test('2026-10-03', 32.1),
  test('2026-10-10', 32.0),
  test('2026-10-17', 32.2),
];
export const plateau: JumpChartData = frame(plateauTests, {
  projection: sampleProjection(plateauTests, TARGET_DATE),
});

/** A 35-day gap: the observed path is drawn broken, never bridged. */
export const withGap: JumpChartData = frame([
  test('2026-09-12', 29.6),
  test('2026-09-19', 30.1),
  test('2026-09-26', 29.9),
  test('2026-10-31', 31.6),
  test('2026-11-07', 32.4),
  test('2026-11-14', 32.9, { pr: true }),
]);

/** A device version change: a labelled tick, and never a PR across it. */
export const withStreamBreak: JumpChartData = frame(sixTests, {
  streamBreaks: [{ date: '2026-10-06', label: 'OVR Connect 2.1' }],
  projection: sampleProjection(sixTests, TARGET_DATE),
});

/** Twelve weeks of load: two deloads, one missed session, one week not started. */
export const loadWeeks: readonly LoadWeek[] = [
  { weekStart: '2026-09-08', weekNumber: 1, sessionsDone: 4, sessionsScheduled: 4, srpeLoad: 1420, strains: [11.2, 13.8, 9.6, 14.1] },
  { weekStart: '2026-09-15', weekNumber: 2, sessionsDone: 4, sessionsScheduled: 4, srpeLoad: 1610, strains: [12.4, 14.2, 10.1, 15.0] },
  { weekStart: '2026-09-22', weekNumber: 3, sessionsDone: 3, sessionsScheduled: 4, srpeLoad: 1240, strains: [11.9, 13.1, 9.8] },
  { weekStart: '2026-09-29', weekNumber: 4, sessionsDone: 4, sessionsScheduled: 4, srpeLoad: 1780, strains: [13.0, 15.4, 11.2, 14.8] },
  { weekStart: '2026-10-06', weekNumber: 5, sessionsDone: 4, sessionsScheduled: 4, srpeLoad: 890, strains: [8.1, 9.4, 7.6, 8.8] },
  { weekStart: '2026-10-13', weekNumber: 6, sessionsDone: 4, sessionsScheduled: 4, srpeLoad: 1840, strains: [13.6, 16.0, 11.9, 15.2] },
  { weekStart: '2026-10-20', weekNumber: 7, sessionsDone: 2, sessionsScheduled: 4, srpeLoad: 720, strains: [12.8, 14.4] },
  { weekStart: '2026-10-27', weekNumber: 8, sessionsDone: 0, sessionsScheduled: 4, srpeLoad: 0, strains: [] },
  { weekStart: '2026-11-03', weekNumber: 9, sessionsDone: 0, sessionsScheduled: 4, srpeLoad: 0, strains: [] },
  { weekStart: '2026-11-10', weekNumber: 10, sessionsDone: 0, sessionsScheduled: 4, srpeLoad: 0, strains: [] },
  { weekStart: '2026-11-17', weekNumber: 11, sessionsDone: 0, sessionsScheduled: 3, srpeLoad: 0, strains: [] },
  { weekStart: '2026-11-24', weekNumber: 12, sessionsDone: 0, sessionsScheduled: 3, srpeLoad: 0, strains: [] },
];

/**
 * A deterministic pseudo-random series, so the gallery renders identically on
 * every machine and every reload.
 */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/**
 * Whoop mirrors across `count` days from `from`. Every seventh day and a short
 * mid-series run are pending, so the gaps the panel must draw are real.
 */
export function recoverySeries(from: string, count: number): readonly RecoveryDay[] {
  const random = noise(20_260_908);
  return Array.from({ length: count }, (_, index): RecoveryDay => {
    const date = addDays(from, index);
    const pending = index % 17 === 5 || (index >= 24 && index <= 28);
    if (pending) return { date, recovery: null, hrvMs: null, sleepPerformance: null };
    const wave = Math.sin(index / 6) * 14;
    const recovery = Math.round(Math.min(96, Math.max(12, 58 + wave + (random() - 0.5) * 26)));
    return {
      date,
      recovery,
      hrvMs: Math.round(46 + wave * 1.4 + (random() - 0.5) * 18),
      sleepPerformance: Math.round(Math.min(99, Math.max(40, 82 + wave * 0.5 + (random() - 0.5) * 18))),
    };
  });
}

/** The program window, day by day: what the three-panel view draws. */
export const programRecovery: readonly RecoveryDay[] = recoverySeries(
  PROGRAM_START,
  daysBetween(PROGRAM_START, TARGET_DATE) + 1,
);

/** Ninety days ending today, for the standalone recovery panel. */
export const NINETY_START = addDays(TODAY, -89);
export const ninetyDayRecovery: readonly RecoveryDay[] = recoverySeries(NINETY_START, 90);

export const velocityPoints: readonly LoadVelocityPoint[] = [
  { loadLb: 185, velocityMs: 0.96 },
  { loadLb: 205, velocityMs: 0.87 },
  { loadLb: 225, velocityMs: 0.79 },
  { loadLb: 245, velocityMs: 0.71 },
  { loadLb: 265, velocityMs: 0.62 },
];

export const velocityFit: LoadVelocityFit = {
  from: { loadLb: 185, velocityMs: 0.965 },
  to: { loadLb: 265, velocityMs: 0.618 },
  n: 5,
  rSquared: 0.97,
};

/** The six-test sparkline that rides the one big number on Progress. */
export const sparklineValues: readonly number[] = [...HEIGHTS];
