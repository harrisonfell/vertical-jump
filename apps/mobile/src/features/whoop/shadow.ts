/**
 * The shadow modifier and its preview (brief section 11 "Shadow
 * autoregulation and the gate").
 *
 * One modifier, evaluated at session start, returning "insufficient data"
 * whenever recovery is not scored, Whoop says the member is calibrating, the
 * connection is gone, or the baseline holds fewer than 28 samples. The
 * modifications are enumerated and nothing else is possible: it can lower and
 * it can hold, it can never raise a load, and it never contradicts Whoop's own
 * coaching. Until the gate is met this is shown and logged, never applied.
 */
import { analytics } from '@vert/engine';

/** Whoop's own three bands, in Whoop's words. */
export type ShadowBand = 'green' | 'yellow' | 'red';

/** Everything one shadow evaluation may change. Nothing outside this shape. */
export interface ShadowModifier {
  readonly band: ShadowBand;
  /** ×1, ×0.75 or ×0.5 on plyometric volume. */
  readonly plyoVolumeFactor: 1 | 0.75 | 0.5;
  /** 0 or −1 tier or ladder rung. */
  readonly tierDelta: 0 | -1;
  /** 0 or −1 working sets on the strength block. */
  readonly strengthSetsDelta: 0 | -1;
  /** ×1 or ×0.95 on prescribed load. Never above 1. */
  readonly loadFactor: 1 | 0.95;
  /** A Red day may swap the session out entirely. */
  readonly swapTo: 'none' | 'moderate' | 'mobility_only';
  /** A Red day defers the weekly test rather than testing tired. */
  readonly deferTest: boolean;
}

/** Why no modifier could be computed. */
export type ShadowUnavailableReason =
  | 'disconnected'
  | 'not_scored'
  | 'calibrating'
  | 'baseline_short';

export interface ShadowEvaluation {
  readonly available: boolean;
  readonly modifier: ShadowModifier | null;
  readonly reason: ShadowUnavailableReason | null;
  /** The one line Settings shows under "Whoop autoregulation". */
  readonly line: string;
  /** Which band source was used, so the preview can say so. */
  readonly source: 'whoop_bands' | 'own_percentiles' | 'none';
}

/** The minimum scored days before the owner's own percentiles replace Whoop's. */
export const BASELINE_DAYS = 28;

export interface ShadowInput {
  readonly connected: boolean;
  readonly scoreState: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE' | null;
  readonly userCalibrating: boolean;
  readonly recoveryScore: number | null;
  /** Scored, non-calibrating days behind the baseline. */
  readonly baselineDays: number;
  /** The owner's own 33rd and 66th recovery percentiles, once there are 28 days. */
  readonly recoveryP33: number | null;
  readonly recoveryP66: number | null;
  /** True when today's session carries the weekly test. */
  readonly isTestDay?: boolean;
}

const UNAVAILABLE_COPY: Readonly<Record<ShadowUnavailableReason, string>> = {
  disconnected: 'Insufficient data: Whoop is not connected.',
  not_scored: 'Insufficient data: today has no scored recovery yet.',
  calibrating: 'Insufficient data: Whoop is still calibrating.',
  baseline_short: 'Insufficient data: the baseline needs 28 scored days.',
};

function unavailable(reason: ShadowUnavailableReason): ShadowEvaluation {
  return {
    available: false,
    modifier: null,
    reason,
    line: UNAVAILABLE_COPY[reason],
    source: 'none',
  };
}

/**
 * Which band a recovery score falls in. With 28 scored days the owner's own
 * percentiles replace Whoop's fixed thirds, because a person who lives at 55%
 * is not perpetually yellow.
 */
export function bandFor(
  recovery: number,
  p33: number | null,
  p66: number | null,
): { readonly band: ShadowBand; readonly source: 'whoop_bands' | 'own_percentiles' } {
  if (p33 !== null && p66 !== null && p66 > p33) {
    if (recovery >= p66) return { band: 'green', source: 'own_percentiles' };
    if (recovery >= p33) return { band: 'yellow', source: 'own_percentiles' };
    return { band: 'red', source: 'own_percentiles' };
  }
  const whoop = analytics.recoveryBand(recovery);
  const band: ShadowBand = whoop === 'high' ? 'green' : whoop === 'moderate' ? 'yellow' : 'red';
  return { band, source: 'whoop_bands' };
}

/** The enumerated modification for one band. This table is the whole rule. */
export function modifierFor(band: ShadowBand, isTestDay: boolean): ShadowModifier {
  switch (band) {
    case 'green':
      return {
        band,
        plyoVolumeFactor: 1,
        tierDelta: 0,
        strengthSetsDelta: 0,
        loadFactor: 1,
        swapTo: 'none',
        deferTest: false,
      };
    case 'yellow':
      return {
        band,
        plyoVolumeFactor: 0.75,
        tierDelta: 0,
        strengthSetsDelta: -1,
        loadFactor: 1,
        swapTo: 'none',
        deferTest: false,
      };
    case 'red':
      return {
        band,
        plyoVolumeFactor: 0.5,
        tierDelta: -1,
        strengthSetsDelta: -1,
        loadFactor: 0.95,
        swapTo: 'moderate',
        deferTest: isTestDay,
      };
  }
}

/** Evaluate the shadow modifier. Nothing is applied; this is what would happen. */
export function evaluateShadow(input: ShadowInput): ShadowEvaluation {
  if (!input.connected) return unavailable('disconnected');
  if (input.userCalibrating) return unavailable('calibrating');
  if (input.scoreState !== 'SCORED' || input.recoveryScore === null) {
    return unavailable('not_scored');
  }
  if (input.baselineDays < BASELINE_DAYS) return unavailable('baseline_short');

  const { band, source } = bandFor(input.recoveryScore, input.recoveryP33, input.recoveryP66);
  const modifier = modifierFor(band, input.isTestDay === true);

  return {
    available: true,
    modifier,
    reason: null,
    line: shadowLine(input.recoveryScore, modifier),
    source,
  };
}

/**
 * Whoop's own band words, which are the only ones the product prints. The
 * internal enum stays green/yellow/red because that is what the rule table is
 * written in; the displayed word is Whoop's, so Today and Settings never name
 * one recovery band two ways.
 */
const BAND_WORD: Readonly<Record<ShadowBand, string>> = {
  green: 'High',
  yellow: 'Moderate',
  red: 'Low',
};

/** The band word the athlete reads, so a caller never re-maps it. */
export function bandWord(band: ShadowBand): string {
  return BAND_WORD[band];
}

/**
 * "Recovery 41% Low · would cut plyometric volume to half, one rung down, one
 * strength set off, loads ×0.95, test deferred. Not applied."
 */
export function shadowLine(recovery: number, modifier: ShadowModifier): string {
  const changes = describeModifier(modifier);
  const head = `Recovery ${analytics.formatPercentWhole(recovery / 100)} ${BAND_WORD[modifier.band]}`;
  if (changes.length === 0) return `${head} · would change nothing. Not applied.`;
  return `${head} · would ${changes.join(', ')}. Not applied.`;
}

/** Each enumerated change in plain words, in the order the session reads. */
export function describeModifier(modifier: ShadowModifier): string[] {
  const parts: string[] = [];
  if (modifier.plyoVolumeFactor === 0.5) parts.push('cut plyometric volume to half');
  else if (modifier.plyoVolumeFactor === 0.75) parts.push('cut plyometric volume by a quarter');
  if (modifier.tierDelta === -1) parts.push('drop one tier or rung');
  if (modifier.strengthSetsDelta === -1) parts.push('take one strength set off');
  if (modifier.loadFactor === 0.95) parts.push('hold loads at 95%');
  if (modifier.swapTo === 'moderate') parts.push('swap to a moderate session');
  if (modifier.swapTo === 'mobility_only') parts.push('swap to mobility only');
  if (modifier.deferTest) parts.push('defer the test');
  return parts;
}

/** The sentence that is always true, on the session and in Settings. */
export const RULEBOOK_ALWAYS_ON =
  'Rule-book adjustments (soreness, pain) are always on and shown on the session.';
