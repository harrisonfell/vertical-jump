/**
 * Fixture builders for the analytics tests. Nothing here reaches for the clock
 * or for Math.random: every date is passed in and every height is derived from
 * an exact inch value, so the assertions are the same on any machine.
 */
import type { JumpRep, JumpTest } from '../src/types/analytics.js';
import type { Instrument } from '../src/types/core.js';
import { addDays } from '../src/calendar.js';
import { inToMm } from '../src/units.js';

/** The owner-like program window: built 8 Sep 2026, target 29 Nov 2026. */
export const PROGRAM_START = '2026-09-08';
export const TARGET_DATE = '2026-11-29';

export interface TestSpec {
  /** Days after the program start. */
  day: number;
  /** Attempt heights in inches; the best unflagged one is the session best. */
  attemptsIn: number[];
  flagged?: number[];
  instrument?: Instrument;
  mode?: string;
  ovrConnectVersion?: string;
  canonical?: boolean;
  isBaseline?: boolean;
  gctMs?: number[];
  boxHeightIn?: number;
}

/** One jump-test session with everything the analytics need and nothing else. */
export function makeTest(id: string, spec: TestSpec): JumpTest {
  const flagged = new Set(spec.flagged ?? []);
  const reps: JumpRep[] = spec.attemptsIn.map((value, index) => {
    const gct = spec.gctMs?.[index];
    const rep: JumpRep = {
      id: `${id}-r${index + 1}`,
      repNumber: index + 1,
      heightMm: inToMm(value),
      flagged: flagged.has(index),
      entrySource: 'typed',
    };
    if (gct !== undefined) {
      rep.gctMs = gct;
      rep.rsiCalc = inToMm(value) / 1000 / (gct / 1000);
    }
    return rep;
  });

  const test: JumpTest = {
    id,
    date: addDays(PROGRAM_START, spec.day),
    instrument: spec.instrument ?? 'ovr_jump_regular',
    mode: spec.mode ?? 'regular',
    unitPreference: 'in',
    isBaseline: spec.isBaseline ?? false,
    canonical: spec.canonical ?? true,
    scheduled: true,
    reps,
    createdAt: '2026-09-08T00:00:00.000Z',
  };
  if (spec.ovrConnectVersion !== undefined) test.ovrConnectVersion = spec.ovrConnectVersion;
  if (spec.boxHeightIn !== undefined) test.boxHeightIn = spec.boxHeightIn;
  return test;
}

/** A run of sessions: one attempt each, at the given days and heights. */
export function makeSeries(
  days: readonly number[],
  heightsIn: readonly number[],
  extra: Omit<TestSpec, 'day' | 'attemptsIn'> = {},
): JumpTest[] {
  return days.map((day, index) => {
    const height = heightsIn[index];
    if (height === undefined) throw new RangeError(`no height for day ${day}`);
    return makeTest(`t${index + 1}`, { ...extra, day, attemptsIn: [height] });
  });
}
