import type { Instrument } from '@vert/engine';
import { formatHeightValueIn, mmToIn } from '@vert/engine/units';
import {
  DOT,
  fittedAt,
  formatInDelta,
  formatInValue,
  formatShortDate,
  instrumentLabel,
  paceReadout,
  prThreshold,
  recoveryOutputTable,
  weeklyReviewLine,
  withinSessionSpreadIn,
  type PaceReadout,
  type RecoverySession,
  type RecoveryTest,
} from '@vert/engine/analytics';
import type { JumpTestWithReps } from '@/data';
import { SINGLE_LEG_MODE } from '@/data';
import { readReadinessConfig } from '@/lib/engineAthlete';
import type { JumpChartData } from '@/ui/charts';
import { daysBetween, median } from '../../ui/charts/scale';
import { buildAsymmetry } from './asymmetry';
import { buildPullUp } from './pullUp';
import { buildReadinessGate } from './readinessGate';
import { buildChart, loadWeeks, recoveryCaption, recoveryDays } from './chartModel';
import { programWeekCount } from './skeleton';
import {
  bodyweightRows,
  ledgerRows,
  liftRows,
  readinessReps,
  readinessRows,
  weekRows,
} from './derive';
import { onStream, primaryStream, streamNotes, toEngineTest } from './streams';
import type {
  HeadlineModel,
  ProgressCard,
  ProgressModel,
  ProgressSources,
  RecoveryDotBand,
} from './types';

const EMPTY_HEADLINE: HeadlineModel = {
  valueIn: null,
  instrumentLabel: 'OVR Jump',
  mode: 'Regular',
  isPr: false,
  prIn: null,
  goalIn: '',
  gapIn: '',
  weeksLeft: '',
  testedOn: null,
  sparkline: [],
  sparklineLabel: 'No tests yet',
  thresholdReason: '',
};

/** Recovery score by local day, so a session can find its own morning. */
export function recoveryByDay(
  recovery: ProgressSources['recovery'],
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const row of recovery) {
    map.set(row.localDate, row.scoreState === 'SCORED' ? row.recoveryScore : null);
  }
  return map;
}

/**
 * Build everything Progress renders. Pure, so a test can drive any state in
 * brief section 06 by handing it a different set of rows.
 */
export function buildProgressModel(sources: ProgressSources): ProgressModel {
  const { athlete, program, ruleset } = sources;
  // A single-leg pair is a jump test row in its own mode, and it belongs to
  // the Asymmetry section alone: it is never canonical, never a PR, and never
  // a ledger line on the jump stream (`house.sc.asymmetry_tracking`). Dropped
  // once here so no selector below has to remember it.
  const jumpTests = sources.tests.filter((test) => test.mode !== SINGLE_LEG_MODE);
  const { instrument, mode } = primaryStream(jumpTests);
  const byDay = recoveryByDay(sources.recovery);
  const rsiTests = jumpTests.filter((test) => test.instrument === 'ovr_jump_rsi');

  const stream = onStream(jumpTests, instrument, mode);
  const canonical = stream.filter((test) => test.canonical && test.bestHeightMm !== null);
  const scored = canonical.filter((test) => !test.isBaseline);
  const baseline =
    jumpTests.find((test) => test.isBaseline && test.bestHeightMm !== null) ?? canonical[0];

  const goalMm = athlete?.goalHeightMm ?? null;
  const targetDate = athlete?.targetDate ?? program?.endDate ?? null;
  const programStart = program?.startDate ?? null;
  const baselineMm = baseline?.bestHeightMm ?? null;

  let pace: PaceReadout | null = null;
  if (goalMm !== null && targetDate !== null && programStart !== null && baselineMm !== null) {
    pace = paceReadout({
      tests: scored.map(toEngineTest),
      baselineMm,
      goalMm,
      programStart,
      targetDate,
      today: sources.today,
      ruleset,
    });
  }

  const threshold = prThreshold(stream.map(toEngineTest), instrument, ruleset);
  const latest = scored[scored.length - 1];
  const bestMm = scored.reduce<number | null>(
    (best, test) =>
      test.bestHeightMm !== null && (best === null || test.bestHeightMm > best)
        ? test.bestHeightMm
        : best,
    null,
  );

  const headline = buildHeadline({
    latest,
    bestMm,
    goalMm,
    pace,
    instrument,
    mode,
    thresholdReason: threshold.reason,
    sparkline: scored.slice(-6).map((test) => mmToIn(test.bestHeightMm ?? 0)),
  });

  let chart: JumpChartData | null = null;
  if (
    goalMm !== null &&
    targetDate !== null &&
    programStart !== null &&
    baselineMm !== null &&
    baseline !== undefined
  ) {
    chart = buildChart({
      sources,
      instrument,
      canonical,
      baseline,
      baselineMm,
      goalMm,
      programStart,
      targetDate,
      pace,
    });
  }

  const currentWeek = sources.weeks.find(
    (week) => week.windowStart <= sources.today && sources.today <= week.windowEnd,
  );
  // The program is as long as the skeleton says. Materialized weeks are only
  // the ones built so far, so counting those printed "Week 7 of 7" on a
  // twelve-week program (defect D-16).
  const programWeeks =
    programWeekCount(program) ??
    (sources.weeks.length > 0 ? sources.weeks.length : (pace?.programWeeks ?? 0));
  const trendInPerWk = pace?.trend?.slopeInPerWk ?? null;
  const requiredInPerWk = pace === null ? null : pace.requiredInPerWk;

  const rows = weekRows({
    weeks: sources.weeks,
    sessions: sources.sessions,
    programWeeks,
    currentW: currentWeek?.w ?? null,
    tests: canonical,
    recoveryByDay: byDay,
    trendInPerWk,
    requiredInPerWk,
  });
  const currentRow = rows.find((row) => row.isCurrent);

  const recoveryPairs = buildRecoveryPairs(sources, canonical, pace, byDay, programStart);
  const table = recoveryOutputTable(recoveryPairs.sessions, recoveryPairs.tests);

  const from = programStart ?? sources.today;
  const to = sources.today;
  const card = buildCard(sources, pace, latest, baselineMm);

  return {
    hasProgram: program !== null,
    hasTests: scored.length > 0,
    instrument,
    mode,
    reviewLine:
      currentRow?.reviewLine ??
      weeklyReviewLine({
        weekNumber: currentWeek?.w ?? 1,
        programWeeks: programWeeks === 0 ? 1 : programWeeks,
        completed: 0,
        scheduled: 0,
      }),
    headline,
    pace,
    paceLine: pace === null ? '' : pace.state.line,
    noiseNote: buildNoiseNote(scored, pace),
    trendCaption:
      scored.length >= ruleset.constants.trend.minTestsForTrend &&
      scored.length < ruleset.constants.trend.minTestsForProjection
        ? `Early trend ${DOT} ${scored.length} tests.`
        : null,
    targetPassed: pace !== null && pace.state.kind === 'target_passed',
    card,
    compactHeadline: card !== null,
    streamNotes: streamNotes(jumpTests, instrument, mode),
    chart,
    loadWeeks: loadWeeks(sources.weeks, sources.sessions, sources.workouts),
    recoveryDays: recoveryDays(sources, from, to),
    recoveryMedian: median(sources.recovery.slice(-90).map((row) => row.recoveryScore)),
    recoveryCaption: recoveryCaption(sources.connection),
    weekRows: rows.filter((row) => currentWeek === undefined || row.w >= currentWeek.w - 3),
    earlierRows: rows.filter((row) => currentWeek !== undefined && row.w < currentWeek.w - 3),
    ledger: ledgerRows(jumpTests),
    lifts: liftRows({ liftSets: sources.liftSets, workingMax: athlete?.workingMax ?? {} }),
    pullUp: buildPullUp({
      liftSets: sources.liftSets,
      weeks: sources.weeks,
      workingMax: athlete?.workingMax ?? {},
      ruleset,
    }),
    asymmetry: buildAsymmetry({
      tests: sources.singleLegTests,
      answer: athlete?.weakerSide ?? null,
      bandPct: ruleset.constants.climbing.asymmetryBandPct,
    }),
    readinessGate: buildReadinessGate({
      today: sources.today,
      config: readReadinessConfig(athlete?.readinessConfig),
      tests: sources.readinessTests,
      recovery: sources.recovery,
      ruleset,
    }),
    readiness: readinessRows(rsiTests),
    readinessReps: readinessReps(rsiTests),
    recoveryOutput: table,
    recoveryDots: buildDots(recoveryPairs.sessions),
    bodyweight: bodyweightRows(jumpTests),
  };
}

interface HeadlineInput {
  readonly latest: JumpTestWithReps | undefined;
  readonly bestMm: number | null;
  readonly goalMm: number | null;
  readonly pace: PaceReadout | null;
  readonly instrument: Instrument;
  readonly mode: string;
  readonly thresholdReason: string;
  readonly sparkline: readonly number[];
}

function buildHeadline(input: HeadlineInput): HeadlineModel {
  const { latest, goalMm, pace } = input;
  if (latest === undefined || latest.bestHeightMm === null) {
    return {
      ...EMPTY_HEADLINE,
      instrumentLabel: instrumentLabel(input.instrument),
      mode: input.mode,
      goalIn: goalMm === null ? '' : formatHeightValueIn(goalMm),
      thresholdReason: input.thresholdReason,
    };
  }
  const currentIn = mmToIn(latest.bestHeightMm);
  const goalIn = goalMm === null ? null : mmToIn(goalMm);
  const weeksLeft = pace === null ? null : pace.weeksLeft;

  return {
    valueIn: formatInValue(currentIn),
    instrumentLabel: instrumentLabel(input.instrument),
    mode: input.mode,
    isPr: latest.isPr,
    prIn: input.bestMm === null ? null : formatInValue(mmToIn(input.bestMm)),
    goalIn: goalIn === null ? '' : formatInValue(goalIn),
    gapIn: goalIn === null ? '' : formatInDelta(goalIn - currentIn),
    weeksLeft:
      weeksLeft === null ? '' : weeksLeft < 0 ? 'passed' : `${Math.max(0, Math.round(weeksLeft))}`,
    testedOn: latest.localDate,
    sparkline: input.sparkline,
    sparklineLabel:
      input.sparkline.length < 2
        ? 'Not enough tests to draw a shape'
        : `${input.sparkline.length} tests, ${formatInValue(Math.min(...input.sparkline))} to ${formatInValue(Math.max(...input.sparkline))} inches`,
    thresholdReason: input.thresholdReason,
  };
}

/** "Last test spread 0.7 in across attempts." plus the noise floor's note. */
function buildNoiseNote(
  scored: readonly JumpTestWithReps[],
  pace: PaceReadout | null,
): string | null {
  const newest = scored[scored.length - 1];
  if (scored.length > 0 && scored.length <= 2 && newest !== undefined) {
    const spread = withinSessionSpreadIn(toEngineTest(newest));
    if (spread === null) return 'Single tests vary about ±1 in; the trend matters.';
    return `Last test spread ${formatInValue(spread)} in across attempts. Single tests vary about ±1 in; the trend matters.`;
  }
  if (pace?.trend?.sdFloored === true) {
    return `Spread held at the ${formatInValue(pace.trend.residualSdIn)} in floor until 8 tests exist.`;
  }
  return null;
}

/** The instrument of the newest test that is not a single-leg pair. */
function newestInstrument(tests: readonly JumpTestWithReps[]): Instrument {
  for (let index = tests.length - 1; index >= 0; index -= 1) {
    const test = tests[index];
    if (test !== undefined && test.mode !== SINGLE_LEG_MODE) return test.instrument;
  }
  return 'manual';
}

function buildCard(
  sources: ProgressSources,
  pace: PaceReadout | null,
  latest: JumpTestWithReps | undefined,
  baselineMm: number | null,
): ProgressCard | null {
  const { program } = sources;
  if (
    program !== null &&
    sources.today > program.endDate &&
    sources.programAcknowledgedAt === null
  ) {
    const index = program.macroIndex;
    const snapshot = program.snapshot;
    const count =
      typeof snapshot === 'object' && snapshot !== null && 'macroCount' in snapshot
        ? (snapshot as { macroCount?: unknown }).macroCount
        : undefined;
    const name =
      typeof count === 'number'
        ? `Program ${index} of ${count} complete`
        : `Program ${index} complete`;
    const height = latest?.bestHeightMm ?? null;
    const from =
      height === null
        ? `the ${formatShortDate(program.endDate)} test`
        : `the ${formatShortDate(latest?.localDate ?? program.endDate)} test (${formatInValue(mmToIn(height))} in)`;
    return {
      kind: 'program_complete',
      eyebrow: name,
      value: null,
      line: `Build program ${index + 1} from ${from}.`,
      instrument: instrumentLabel(newestInstrument(sources.tests)),
      primaryLabel: `Build program ${index + 1}`,
      secondaryLabel: null,
    };
  }

  if (
    pace !== null &&
    pace.state.kind === 'goal_met' &&
    sources.goalAcknowledgedAt === null &&
    latest !== undefined
  ) {
    const start = sources.program?.startDate ?? null;
    const since =
      baselineMm === null
        ? null
        : `${formatInDelta(pace.state.latestIn - mmToIn(baselineMm))} since ${start === null ? 'the baseline' : formatShortDate(start)}`;
    return {
      kind: 'goal_reached',
      eyebrow: 'Goal reached',
      value: formatInValue(pace.state.latestIn),
      line: since ?? `Goal ${formatInValue(pace.state.goalIn)} in`,
      instrument: instrumentLabel(latest.instrument),
      primaryLabel: 'Keep training',
      secondaryLabel: 'Set new goal',
    };
  }
  return null;
}

function buildRecoveryPairs(
  sources: ProgressSources,
  canonical: readonly JumpTestWithReps[],
  pace: PaceReadout | null,
  byDay: ReadonlyMap<string, number | null>,
  programStart: string | null,
): { readonly sessions: RecoverySession[]; readonly tests: RecoveryTest[] } {
  const sessions: RecoverySession[] = [];
  for (const session of sources.sessions) {
    if (session.status !== 'done') continue;
    const recovery = byDay.get(session.scheduledDate) ?? null;
    if (recovery === null) continue;
    sessions.push({
      recovery,
      rpe: session.rpe,
      legsFeel:
        session.legsFeel === 'fresh' || session.legsFeel === 'normal' || session.legsFeel === 'heavy'
          ? session.legsFeel
          : null,
    });
  }

  const tests: RecoveryTest[] = [];
  if (pace !== null && pace.trend !== null && programStart !== null) {
    for (const test of canonical) {
      if (test.isBaseline || test.bestHeightMm === null) continue;
      const recovery = byDay.get(test.localDate) ?? null;
      if (recovery === null) continue;
      const weeks = daysBetween(programStart, test.localDate) / 7;
      tests.push({
        recovery,
        residualIn: mmToIn(test.bestHeightMm) - fittedAt(pace.trend, weeks),
      });
    }
  }
  return { sessions, tests };
}

const BAND_LABEL = { low: 'Low', moderate: 'Moderate', high: 'High' } as const;

/** Session RPEs split into their bands, for the jittered dot strips. */
function buildDots(sessions: readonly RecoverySession[]): RecoveryDotBand[] {
  const bands: RecoveryDotBand['band'][] = ['low', 'moderate', 'high'];
  return bands.map((band) => ({
    band,
    label: BAND_LABEL[band],
    values: sessions
      .filter((session) => {
        const score = session.recovery;
        if (band === 'low') return score <= 33;
        if (band === 'moderate') return score > 33 && score <= 66;
        return score > 66;
      })
      .map((session) => session.rpe)
      .filter((rpe): rpe is number => typeof rpe === 'number'),
  }));
}
