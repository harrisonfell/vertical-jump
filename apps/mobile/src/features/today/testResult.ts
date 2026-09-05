import type { JumpTest, JumpRep as EngineRep } from '@vert/engine';
import { RULESET_V1 } from '@vert/engine';
import { classifyTest, instrumentLabel, prThreshold } from '@vert/engine/analytics';
import type { TestClassification } from '@vert/engine/analytics';
import { formatHeightValueIn } from '@vert/engine/units';
import type { JumpTestWithReps } from '@/data';

/**
 * The bridge from a stored test to the engine's own classification.
 *
 * The PR decision is the engine's, not the screen's: same stream, at or above
 * that stream's threshold, past the three calibration sessions. The screen only
 * asks which of the five lines to show and whether the surface commits.
 */

export function toEngineTest(test: JumpTestWithReps): JumpTest {
  const reps: EngineRep[] = test.reps
    .filter((rep) => rep.heightMm !== null)
    .map((rep) => ({
      id: rep.id,
      repNumber: rep.attemptIndex,
      heightMm: rep.heightMm ?? 0,
      ...(rep.gctMs === null ? null : { gctMs: rep.gctMs }),
      ...(rep.rsiCalc === null ? null : { rsiCalc: rep.rsiCalc }),
      ...(rep.rsiDevice === null ? null : { rsiDevice: rep.rsiDevice }),
      flagged: rep.flagged,
      ...(rep.rejectReason === null ? null : { rejectReason: rep.rejectReason }),
      entrySource: rep.entrySource,
    }));

  return {
    id: test.id,
    date: test.localDate,
    instrument: test.instrument,
    mode: test.mode,
    unitPreference: 'in',
    ...(test.boxHeightMm === null ? null : { boxHeightIn: test.boxHeightMm / 25.4 }),
    ...(test.deviceFirmware === null ? null : { deviceFirmware: test.deviceFirmware }),
    ...(test.connectVersion === null ? null : { ovrConnectVersion: test.connectVersion }),
    isBaseline: test.isBaseline,
    canonical: test.canonical,
    scheduled: test.scheduled,
    ...(test.sessionId === null ? null : { sessionId: test.sessionId }),
    ...(test.bodyweightKg === null ? null : { bodyweightKg: test.bodyweightKg }),
    ...(test.notes === null ? null : { notes: test.notes }),
    reps,
    createdAt: test.createdAt,
  };
}

export interface ResultView {
  readonly classification: TestClassification;
  /** The one place the whole surface goes green. */
  readonly committed: boolean;
  /** "32.5", already at one decimal. */
  readonly value: string;
  readonly instrument: string;
  readonly eyebrow: string;
}

/**
 * Classify one stored test against its own stream. Returns null when the test
 * has no unflagged attempt, which is a grid to fix rather than a result.
 */
export function resultView(
  test: JumpTestWithReps,
  stream: readonly JumpTestWithReps[],
  eyebrow: string,
  baselineMm: number | null,
): ResultView | null {
  const engineTest = toEngineTest(test);
  const engineStream = stream.map(toEngineTest);
  if (engineTest.reps.every((rep) => rep.flagged)) return null;

  const threshold = prThreshold(engineStream, test.instrument, RULESET_V1);
  const classification = classifyTest(engineTest, engineStream, threshold, {
    baselineMm,
    instrumentLabel: instrumentLabel(test.instrument),
  });

  return {
    classification,
    committed: classification.kind === 'pr',
    value: formatHeightValueIn(classification.heightMm),
    instrument: instrumentLabel(test.instrument),
    eyebrow,
  };
}
