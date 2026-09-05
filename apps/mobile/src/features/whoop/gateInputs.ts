/**
 * Turning what the store holds into the autoregulation gate's input.
 *
 * The gate is the engine's (`analytics.evaluateAutoregulationGate`); this file
 * only counts. Every counter is keyed to the athlete rather than the program,
 * so a regeneration or a second macro never resets progress toward the gate.
 */
import { analytics } from '@vert/engine';
import type { LocalDate } from '@/data';
import type { ShadowBand } from './shadow';

/** One day's recovery, flattened to the three fields the counters read. */
export interface GateRecoveryDay {
  readonly localDate: LocalDate;
  readonly scoreState: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  readonly userCalibrating: boolean;
  readonly recoveryScore: number | null;
}

/** One canonical test, reduced to a date and a height. */
export interface GateTest {
  readonly localDate: LocalDate;
  readonly bestHeightMm: number | null;
  readonly canonical: boolean;
}

export interface GateSource {
  readonly recoveries: readonly GateRecoveryDay[];
  /** Local days that carry at least one logged set. */
  readonly sessionDays: readonly LocalDate[];
  readonly tests: readonly GateTest[];
  /** The shadow band recorded for a day, from the readiness signal log. */
  readonly shadowBands: readonly { readonly localDate: LocalDate; readonly band: ShadowBand }[];
}

/** Monday-start week bucket, so two paired days in one week count once. */
export function weekKey(date: LocalDate): string {
  const at = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;
  const weekday = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - weekday);
  return at.toISOString().slice(0, 10);
}

/** Every counter the gate needs, from what the store already holds. */
export function buildGateInput(source: GateSource): analytics.GateInput {
  const scored = source.recoveries.filter(
    (day) => day.scoreState === 'SCORED' && !day.userCalibrating && day.recoveryScore !== null,
  );
  const recoveryByDate = new Map(scored.map((day) => [day.localDate, day.recoveryScore ?? 0]));

  const sessionDays = new Set(source.sessionDays);
  const pairedDates = [...recoveryByDate.keys()].filter((date) => sessionDays.has(date));
  const pairedWeeks = new Set(pairedDates.map(weekKey));

  const canonical = source.tests.filter(
    (test) => test.canonical && test.bestHeightMm !== null,
  );

  const bandByDate = new Map(source.shadowBands.map((entry) => [entry.localDate, entry.band]));

  const pairs: analytics.RecoveryOutputPair[] = [];
  const redBandTestsIn: number[] = [];
  const greenBandTestsIn: number[] = [];

  for (const test of canonical) {
    const inches = (test.bestHeightMm ?? 0) / 25.4;
    const recovery = recoveryByDate.get(test.localDate);
    if (recovery !== undefined) pairs.push({ recovery, output: inches });
    const band = bandByDate.get(test.localDate);
    if (band === 'red') redBandTestsIn.push(inches);
    if (band === 'green') greenBandTestsIn.push(inches);
  }

  return {
    scoredNonCalibratingDays: scored.length,
    pairedDays: pairedDates.length,
    pairedWeeks: pairedWeeks.size,
    canonicalTests: canonical.length,
    pairs,
    redBandTestsIn,
    greenBandTestsIn,
  };
}

/** The gate, ready for the Settings list. */
export function evaluateGate(source: GateSource): analytics.GateResult {
  return analytics.evaluateAutoregulationGate(buildGateInput(source));
}
