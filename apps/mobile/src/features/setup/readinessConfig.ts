/**
 * The readiness gate's configuration, as setup and Settings collect it
 * (house `house.sc.readiness_gate`).
 *
 * The gate is two channels and the test is swappable, so the kind decides the
 * metric and nothing else has to be picked: a distance test is metres, a CMJ
 * is inches, an RSI is a ratio. Everything else is a number with a floor and
 * a ceiling, and the shipped defaults come from the ruleset so the file is the
 * only place they are written down.
 */
import type { ReadinessMetric, ReadinessTestConfig, ReadinessTestKind } from '@vert/engine';
import type { Json } from '@/data';
import { defaultReadinessConfig, readReadinessConfig } from '@/lib/engineAthlete';

/** The metric each test kind reports. Never asked; it follows the kind. */
export const METRIC_FOR_KIND: Readonly<Record<ReadinessTestKind, ReadinessMetric>> = {
  seated_mb_throw: 'distance_m',
  cmj: 'height_in',
  rsi: 'rsi',
};

export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_MAX = 5;
export const WINDOW_MIN = 3;
export const WINDOW_MAX = 14;
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 25;

export interface ReadinessConfigValues {
  readonly kind: ReadinessTestKind;
  readonly attempts: number;
  readonly baselineWindow: number;
  readonly lowThresholdPct: number;
}

/** Seated med ball throw, 3 attempts, 7-test window, 5 percent. */
export function readinessConfigDefaults(): ReadinessConfigValues {
  const config = defaultReadinessConfig();
  return {
    kind: config.kind,
    attempts: config.attempts,
    baselineWindow: config.baselineWindow,
    lowThresholdPct: config.lowThresholdPct,
  };
}

/** The stored JSON read back as the four answers the athlete can change. */
export function readinessConfigValuesFrom(stored: Json | undefined): ReadinessConfigValues {
  const config = readReadinessConfig(stored ?? null);
  return {
    kind: config.kind,
    attempts: config.attempts,
    baselineWindow: config.baselineWindow,
    lowThresholdPct: config.lowThresholdPct,
  };
}

/**
 * The engine's config from the four answers. `whoopLowScore` is not asked:
 * it is Whoop's own Moderate boundary and belongs to the ruleset.
 */
export function toReadinessTestConfig(values: ReadinessConfigValues): ReadinessTestConfig {
  return {
    kind: values.kind,
    metric: METRIC_FOR_KIND[values.kind],
    attempts: values.attempts,
    baselineWindow: values.baselineWindow,
    lowThresholdPct: values.lowThresholdPct,
    whoopLowScore: defaultReadinessConfig().whoopLowScore,
  };
}
