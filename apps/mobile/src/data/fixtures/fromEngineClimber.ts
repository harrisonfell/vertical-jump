import type { ClimberFixture, OwnerFixture } from '@vert/engine/fixtures';
import { inToMm } from '@vert/engine/units';
import type { Json } from '../types';
import { shiftDay, shiftInstant, shiftJson } from './shift';
import type { FixtureAthlete, FixtureJumpTest, FixtureReadinessTest } from './types';

/**
 * What the climbing owner adds to the fixture the basketball owner already
 * produced: the gate's own test stream, the single-leg pairs behind the
 * weaker-side ordering, and the answers the athlete gave once.
 *
 * Split from `fromEngine.ts` so that file stays the conversion of the shape
 * every fixture has, and so neither file grows past reading length.
 *
 * The narrowing is structural rather than a cast: a fixture that carries a
 * `readinessTests` array is a climber's, and one that does not is the
 * basketball owner's and gets none of this.
 */

/** True when the engine handed us the climbing fixture rather than the older one. */
export function isClimberFixture(owner: OwnerFixture): owner is ClimberFixture {
  const candidate = owner as Partial<ClimberFixture>;
  return (
    Array.isArray(candidate.readinessTests) &&
    Array.isArray(candidate.singleLegTests) &&
    typeof candidate.readinessConfig === 'object' &&
    candidate.readinessConfig !== null
  );
}

/** The gate's neuromuscular stream, moved with the rest of the fixture. */
export function climberReadinessTests(
  owner: ClimberFixture,
  shift: number,
): FixtureReadinessTest[] {
  const metric = owner.readinessConfig.metric;
  return owner.readinessTests.map((test) => ({
    localDate: shiftDay(test.date, shift),
    kind: test.kind,
    metric,
    attempts: test.attempts,
    best: test.best,
    unit: test.unit,
    createdAt: shiftInstant(`${test.date}T17:30:00.000Z`, shift),
  }));
}

/**
 * The single-leg pairs, as jump tests in their own mode.
 *
 * Never canonical and never scheduled: a single-leg jump is not the stream the
 * trend, the pace and the PR threshold are read from
 * (`house.sc.asymmetry_tracking`). One attempt a side, so the store reads the
 * gap back off the reps rather than off a stored percent.
 */
export function climberSingleLegTests(owner: ClimberFixture, shift: number): FixtureJumpTest[] {
  return owner.singleLegTests.map((test) => ({
    localDate: shiftDay(test.date, shift),
    performedAt: shiftInstant(`${test.date}T18:05:00.000Z`, shift),
    instrument: test.instrument,
    mode: 'single_leg',
    canonical: false,
    attempts: [
      { attemptIndex: 1, heightMm: inToMm(test.leftIn), side: 'left' as const },
      { attemptIndex: 2, heightMm: inToMm(test.rightIn), side: 'right' as const },
    ],
  }));
}

/**
 * The answers the climbing house rules read off the athlete row.
 *
 * The wall days go through the same shift the training days do, so the six
 * hours the RNT row keeps from the wall stay six hours after the fixture
 * slides to the athlete's own week (`house.sc.rnt_valgus_control`).
 */
export function climberAthleteFields(
  owner: ClimberFixture,
  shift: number,
): Partial<FixtureAthlete> {
  const { athlete } = owner;
  return {
    ...(athlete.secondaryGoal === undefined ? null : { secondaryGoal: athlete.secondaryGoal }),
    fingerHistory: athlete.fingerHistory === true,
    ...(athlete.gripMode === undefined ? null : { gripMode: athlete.gripMode }),
    ...(athlete.fingerPainCeiling === undefined
      ? null
      : { fingerPainCeiling: athlete.fingerPainCeiling }),
    ...(athlete.wallWork === undefined ? null : { wallWork: shiftJson(athlete.wallWork, shift) }),
    ...(athlete.sessionWindow === undefined
      ? null
      : { sessionWindow: athlete.sessionWindow as unknown as Json }),
    ...(athlete.valgusControl === undefined
      ? null
      : { valgusControl: athlete.valgusControl as unknown as Json }),
    // R73's own source, typed in setup step two. The dates inside it move with
    // the fixture so a best set never lands in the athlete's future.
    ...(athlete.bestSets === undefined
      ? null
      : { bestSets: shiftJson(athlete.bestSets, shift) }),
    weakerSide: owner.weakerSide,
    readinessConfig: owner.readinessConfig as unknown as Json,
  };
}
