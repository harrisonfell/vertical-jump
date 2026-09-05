import type { Instrument } from '@vert/engine';
import { mmToIn } from '@vert/engine/units';
import {
  DOT,
  brokenSegments,
  instrumentLabel,
  projectionLine,
  trendLine,
  type ChartPoint,
  type PaceReadout,
} from '@vert/engine/analytics';
import type { JumpTestWithReps, SessionWithStatus, Week } from '@/data';
import type { JumpChartData, JumpPoint, LoadWeek, RecoveryDay, SeriesPoint } from '@/ui/charts';
import { addDays, daysBetween, formatDayLong } from '../../ui/charts/scale';
import { sessionsByWeek, weekSrpe } from './derive';
import { nextSkeletonTestDate } from './skeleton';
import { streamBreaks } from './streams';
import type { ProgressSources } from './types';

/**
 * The chart's own inputs: the three panels' data and the primary stream's
 * frame.
 *
 * The charts know nothing about the store, the engine, or millimetres, so the
 * conversion happens once here and every panel below reads inches, whole
 * percent, and plain local days.
 */

/** Every calendar day of the program so far, with gaps left as gaps. */
export function recoveryDays(
  sources: ProgressSources,
  from: string,
  to: string,
): RecoveryDay[] {
  const scores = new Map<string, ProgressSources['recovery'][number]>();
  for (const row of sources.recovery) scores.set(row.localDate, row);
  const sleep = new Map<string, number | null>();
  for (const row of sources.sleep) {
    sleep.set(row.localDate, row.scoreState === 'SCORED' ? row.sleepPerformancePercentage : null);
  }

  const days: RecoveryDay[] = [];
  const span = Math.max(0, daysBetween(from, to));
  for (let offset = 0; offset <= span; offset += 1) {
    const date = addDays(from, offset);
    const row = scores.get(date);
    const scored = row !== undefined && row.scoreState === 'SCORED';
    days.push({
      date,
      recovery: scored ? row.recoveryScore : null,
      hrvMs: scored && row.hrvRmssdMilli !== null ? Math.round(row.hrvRmssdMilli) : null,
      sleepPerformance: sleep.get(date) ?? null,
    });
  }
  return days;
}

/** One column a week: done of scheduled, sRPE load, and the strain marks. */
export function loadWeeks(
  weeks: readonly Week[],
  sessions: readonly SessionWithStatus[],
  workouts: ProgressSources['workouts'],
): LoadWeek[] {
  const grouped = sessionsByWeek(sessions);
  return weeks.map((week): LoadWeek => {
    const inWeek = grouped.get(week.id) ?? [];
    const strains: number[] = [];
    for (const workout of workouts) {
      if (workout.localDate < week.windowStart || workout.localDate > week.windowEnd) continue;
      if (workout.strain !== null) strains.push(workout.strain);
    }
    return {
      weekStart: week.windowStart,
      weekNumber: week.w,
      sessionsDone: inWeek.filter((session) => session.status === 'done').length,
      sessionsScheduled: inWeek.length > 0 ? inWeek.length : week.prescribedCount,
      srpeLoad: weekSrpe(inWeek) ?? 0,
      strains,
    };
  });
}

/** The Whoop backfill caption, or null once the history is in. */
export function recoveryCaption(connection: ProgressSources['connection']): string | null {
  if (connection === null) return null;
  const { backfillDaysDone: done, backfillDaysTotal: total } = connection;
  if (connection.status === 'connecting') {
    return total > 0
      ? `Importing Whoop history ${DOT} ${done}/${total} days`
      : 'Finishing connection';
  }
  if (connection.status === 'connected' && total > 0 && done < total) {
    return `Importing Whoop history ${DOT} ${done}/${total} days`;
  }
  return null;
}

/**
 * "No tests yet. First test: Sat 13 Sep."
 *
 * A built session that carries the test is the first source; before the week
 * that holds it is materialized there is no such row, so the date comes from
 * the skeleton's own test weekday rather than from silence.
 */
function emptyMessage(sources: ProgressSources): string {
  const next = sources.sessions.find(
    (session) =>
      session.testStatus !== null &&
      session.testStatus !== 'missed' &&
      session.scheduledDate >= sources.today,
  );
  const date = next?.scheduledDate ?? nextSkeletonTestDate(sources.program, sources.today);
  if (date === null || date === undefined) return 'No tests yet.';
  return `No tests yet. First test: ${formatDayLong(date)}.`;
}

export function toSeries(points: readonly ChartPoint[]): SeriesPoint[] {
  return points.map((point) => ({ date: point.date, heightIn: point.valueIn }));
}

export interface ChartInput {
  readonly sources: ProgressSources;
  readonly instrument: Instrument;
  readonly canonical: readonly JumpTestWithReps[];
  readonly baseline: JumpTestWithReps;
  readonly baselineMm: number;
  readonly goalMm: number;
  readonly programStart: string;
  readonly targetDate: string;
  readonly pace: PaceReadout | null;
}

export function buildChart(input: ChartInput): JumpChartData {
  const { pace } = input;
  const label = instrumentLabel(input.instrument);

  const tests: JumpPoint[] = input.canonical
    .filter((test) => !test.isBaseline)
    .map((test) => ({
      date: test.localDate,
      heightIn: mmToIn(test.bestHeightMm ?? 0),
      canonical: test.canonical,
      flagged: test.reps.every((rep) => rep.flagged),
      pr: test.isPr,
      instrument: label,
    }));

  const data: {
    programStart: string;
    targetDate: string;
    today: string;
    baseline: { date: string; heightIn: number; remembered: boolean };
    goalIn: number;
    tests: JumpPoint[];
    instrument: string;
    trend?: SeriesPoint[];
    projection?: { line: SeriesPoint[]; lower: SeriesPoint[]; upper: SeriesPoint[] };
    streamBreaks?: { date: string; label: string }[];
    emptyMessage?: string;
  } = {
    programStart: input.programStart,
    targetDate: input.targetDate,
    today: input.sources.today,
    baseline: {
      date: input.baseline.localDate,
      heightIn: mmToIn(input.baselineMm),
      remembered: !input.baseline.canonical,
    },
    goalIn: mmToIn(input.goalMm),
    tests,
    instrument: label,
  };

  const breaks = streamBreaks(input.canonical);
  if (breaks.length > 0) data.streamBreaks = breaks;
  if (tests.length === 0) data.emptyMessage = emptyMessage(input.sources);

  if (pace !== null && pace.trend !== null && pace.points.length >= 2) {
    // Broken segments keep a month away from reading as a straight line.
    const segments = brokenSegments(
      pace.points.map((point) => ({ weeks: point.weeks, valueIn: point.valueIn, date: point.date })),
      input.sources.ruleset.constants.trend.brokenGapDays,
    );
    const longest = segments.reduce<ChartPoint[]>(
      (best, segment) => (segment.points.length > best.length ? segment.points : best),
      [],
    );
    if (longest.length >= 2) {
      data.trend = toSeries(trendLine(longest, pace.trend));
    }
    if (pace.projection !== null && pace.state.kind !== 'goal_met') {
      const line = projectionLine(pace.points, pace.trend, pace.projection, input.programStart);
      const start = line.points[0];
      const end = line.points[1];
      if (start !== undefined && end !== undefined) {
        data.projection = {
          line: toSeries(line.points),
          lower: [
            { date: start.date, heightIn: start.valueIn },
            { date: end.date, heightIn: line.lowIn },
          ],
          upper: [
            { date: start.date, heightIn: start.valueIn },
            { date: end.date, heightIn: line.highIn },
          ],
        };
      }
    }
  }

  return data;
}
