/**
 * PR threshold, per stream.
 *
 * Default 1.0 in above the stream's prior PR. After the first three OVR
 * sessions the app measures this athlete's test noise; if twice that exceeds
 * 1.0 in, the threshold rises to twice the noise rounded up to 0.5 in, and
 * Progress says why. Test noise is the spread around the trend of session
 * bests, not the raw spread of those bests, so a rising athlete is not
 * punished for improving (house rule read.pr_noise_residual). The green
 * surface fires only on a same-stream PR at or above the threshold, never on a
 * stream change or a device-version change, which are drawn as stream breaks
 * (brief section 08).
 */
import type { Instrument } from '../types/core.js';
import type { JumpTest, MetricPr, PrThresholdResult } from '../types/analytics.js';
import type { Ruleset } from '../types/ruleset.js';
import { mmToIn } from '../units.js';
import type { CalibrationSpread } from './calibration.js';
import { calibrationSpread } from './calibration.js';
import { sessionBestMm, streamKey } from './sessionBest.js';
import {
  DOT,
  PLUS_MINUS,
  formatInDelta,
  formatInValue,
  joinParts,
} from './format.js';

export { sessionBestMm, streamKey } from './sessionBest.js';

/** How a new test reads against its own stream. */
export type PrKind = 'pr' | 'small_pr' | 'regression' | 'calibrating' | 'none';

/** The classified result plus the exact line the test sheet shows. */
export interface TestClassification {
  kind: PrKind;
  /** Best unflagged attempt of this session, in millimetres. */
  heightMm: number;
  /** Change against the previous session on the stream, in inches. */
  vsLastIn: number | null;
  /** Change against the remembered baseline, in inches. */
  vsBaselineIn: number | null;
  /** Change against the stream's prior PR, in inches. */
  vsPrIn: number | null;
  /** Sessions logged since the stream break, this one included. */
  calibrationIndex: number;
  /** Sessions needed before a PR may fire on a new stream. */
  calibrationOf: number;
  /** The threshold in force, in inches. */
  thresholdIn: number;
  /** The line from brief section 13 "Key copy". */
  line: string;
}

/** Everything the display line needs beyond the tests themselves. */
export interface ClassifyContext {
  /** The remembered baseline on this stream, in millimetres. */
  baselineMm?: number | null;
  /** How the stream is labelled in copy; defaults to the instrument name. */
  instrumentLabel?: string;
  /** Sessions on a new stream before a PR may fire; defaults to 3. */
  calibrationSessions?: number;
}

/** Round up to the next multiple of `step`, tolerant of binary noise. */
function ceilToStep(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

/** The label every jump number carries (brief section 13 "Vocabulary"). */
export function instrumentLabel(instrument: Instrument): string {
  switch (instrument) {
    case 'ovr_jump_regular':
      return 'OVR Jump';
    case 'ovr_jump_rsi':
      return 'OVR Jump RSI';
    case 'vertec_reach_touch':
      return 'Vertec';
    case 'manual':
      return 'Manual';
  }
}

/**
 * The tests that share the newest stream identity, oldest first. A device or
 * app version change starts a new stream, which restarts the calibration
 * counter and never carries a PR across.
 */
export function sinceStreamBreak(streamTests: JumpTest[]): JumpTest[] {
  if (streamTests.length === 0) return [];
  const newest = streamTests[streamTests.length - 1];
  if (newest === undefined) return [];
  const key = streamKey(newest);
  let start = streamTests.length - 1;
  while (start > 0) {
    const previous = streamTests[start - 1];
    if (previous === undefined || streamKey(previous) !== key) break;
    start -= 1;
  }
  return streamTests.slice(start);
}

/** The live threshold for one stream, with the sentence that explains it. */
export function prThreshold(
  streamTests: JumpTest[],
  instrument: Instrument,
  ruleset: Ruleset,
): PrThresholdResult {
  const config = ruleset.constants.prThreshold;
  const onStream = sinceStreamBreak(
    streamTests.filter((test) => test.instrument === instrument),
  ).filter((test) => sessionBestMm(test) !== null);
  const sessions = onStream.length;
  const defaultIn = config.defaultIn;

  if (sessions < config.sessionsBeforeRecalibrate) {
    return {
      instrument,
      thresholdIn: defaultIn,
      recalibrated: false,
      spreadIn: null,
      method: 'default',
      sessions,
      reason: `Threshold ${formatInValue(defaultIn)} in: the default until ${config.sessionsBeforeRecalibrate} sessions on this stream (${sessions} so far).`,
    };
  }

  const spread = calibrationSpread(onStream);
  if (spread === null) {
    return {
      instrument,
      thresholdIn: defaultIn,
      recalibrated: false,
      spreadIn: null,
      method: 'default',
      sessions,
      reason: `Threshold ${formatInValue(defaultIn)} in: the default until there is enough to measure your test noise.`,
    };
  }

  const noiseIn = formatInValue(spread.spreadIn);
  const twiceSpread = config.sdMultiplier * spread.spreadIn;
  if (twiceSpread <= defaultIn) {
    return {
      instrument,
      thresholdIn: defaultIn,
      recalibrated: false,
      spreadIn: spread.spreadIn,
      method: spread.method,
      sessions,
      reason: `Threshold ${formatInValue(defaultIn)} in: your test noise is ${noiseIn} in (${spreadPhrase(spread)}), so the default holds.`,
    };
  }

  const raised = ceilToStep(twiceSpread, config.roundUpToIn);
  return {
    instrument,
    thresholdIn: raised,
    recalibrated: true,
    spreadIn: spread.spreadIn,
    method: spread.method,
    sessions,
    reason: `Threshold ${formatInValue(raised)} in: twice your test noise of ${noiseIn} in (${spreadPhrase(spread)}), rounded up to ${formatInValue(config.roundUpToIn)} in.`,
  };
}

/** How the spread was measured, in the words Progress puts in brackets. */
function spreadPhrase(spread: CalibrationSpread): string {
  const sessions = `${spread.sessions} session${spread.sessions === 1 ? '' : 's'}`;
  switch (spread.basis) {
    case 'trend':
      return `spread around your trend over ${sessions}`;
    case 'mean':
      return `spread around your average over ${sessions}`;
    case 'attempts':
      return `spread inside your attempts over ${sessions}`;
  }
}

/**
 * Does this test set a PR on its own stream? Returns the new PR row, or null.
 * Never fires across streams or across a device-version break, and never
 * during the first three calibration sessions. A small PR (an improvement
 * inside the noise) still updates the stored PR row; only `classifyTest`
 * decides whether the committed green surface fires.
 */
export function evaluatePr(
  test: JumpTest,
  streamTests: JumpTest[],
  threshold: PrThresholdResult,
): MetricPr | null {
  const result = classifyTest(test, streamTests, threshold);
  if (result.kind !== 'pr' && result.kind !== 'small_pr') return null;
  return {
    instrument: test.instrument,
    mode: test.mode,
    heightMm: result.heightMm,
    sessionId: test.id,
    thresholdUsedIn: threshold.thresholdIn,
  };
}

/**
 * Classify a new test against its own stream and build the display line
 * (brief section 13 "Key copy", section 06 "Test and instruments").
 * `streamTests` is every test on the instrument, oldest first, including this
 * one; a test that is not in the list is treated as the newest.
 */
export function classifyTest(
  test: JumpTest,
  streamTests: JumpTest[],
  threshold: PrThresholdResult,
  context: ClassifyContext = {},
): TestClassification {
  const heightMm = sessionBestMm(test);
  if (heightMm === null) {
    throw new RangeError(`test ${test.id} has no unflagged attempt`);
  }

  const ordered = streamTests.some((other) => other.id === test.id)
    ? streamTests
    : [...streamTests, test];
  const index = ordered.findIndex((other) => other.id === test.id);
  const upTo = ordered.slice(0, index + 1).filter((t) => sessionBestMm(t) !== null);
  const window = sinceStreamBreak(upTo);
  const calibrationIndex = window.length;
  const calibrationOf = context.calibrationSessions ?? 3;

  const priorOnStream = window.slice(0, -1);
  const previous = priorOnStream[priorOnStream.length - 1];
  const lastMm = previous === undefined ? null : sessionBestMm(previous);
  let priorPrMm: number | null = null;
  for (const earlier of priorOnStream) {
    const best = sessionBestMm(earlier);
    if (best === null) continue;
    if (priorPrMm === null || best > priorPrMm) priorPrMm = best;
  }

  const heightIn = mmToIn(heightMm);
  const vsLastIn = lastMm === null ? null : heightIn - mmToIn(lastMm);
  const vsPrIn = priorPrMm === null ? null : heightIn - mmToIn(priorPrMm);
  const baselineMm = context.baselineMm ?? null;
  const vsBaselineIn = baselineMm === null ? null : heightIn - mmToIn(baselineMm);
  const label = context.instrumentLabel ?? instrumentLabel(test.instrument);

  const base = {
    heightMm,
    vsLastIn,
    vsBaselineIn,
    vsPrIn,
    calibrationIndex,
    calibrationOf,
    thresholdIn: threshold.thresholdIn,
  };

  if (calibrationIndex <= calibrationOf) {
    return {
      ...base,
      kind: 'calibrating',
      line: `${formatInValue(heightIn)} in ${DOT} calibrating (${calibrationIndex} of ${calibrationOf})`,
    };
  }

  if (vsPrIn !== null && vsPrIn > 0) {
    if (vsPrIn >= threshold.thresholdIn) {
      return { ...base, kind: 'pr', line: resultLine(heightIn, label, vsLastIn, vsBaselineIn) };
    }
    return {
      ...base,
      kind: 'small_pr',
      line: `${formatInValue(heightIn)} in ${DOT} ${formatInDelta(vsPrIn)} (within test noise, PR updated)`,
    };
  }

  if (vsLastIn !== null && vsLastIn < 0) {
    return {
      ...base,
      kind: 'regression',
      line: `${formatInValue(heightIn)} in ${DOT} ${formatInDelta(vsLastIn)} vs last. Single tests vary about ${PLUS_MINUS}1 in; the trend matters.`,
    };
  }

  return { ...base, kind: 'none', line: resultLine(heightIn, label, vsLastIn, vsBaselineIn) };
}

/** "32.5 in - OVR Jump - +1.2 vs last - +3.1 vs baseline", dots real. */
function resultLine(
  heightIn: number,
  label: string,
  vsLastIn: number | null,
  vsBaselineIn: number | null,
): string {
  return joinParts([
    `${formatInValue(heightIn)} in`,
    label,
    vsLastIn === null ? null : `${formatInDelta(vsLastIn)} vs last`,
    vsBaselineIn === null ? null : `${formatInDelta(vsBaselineIn)} vs baseline`,
  ]);
}
