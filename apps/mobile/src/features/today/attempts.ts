import { computeRsi } from '@vert/engine/analytics';
import { formatHeightValueIn, formatInteger, inToMm, mmToIn } from '@vert/engine/units';

/**
 * The jump-test attempt grid: bounds, best, spread, and the derived RSI.
 *
 * Everything the athlete types is read straight off the OVR Jump display, so
 * the bounds are the device's, not ours: it cannot read under 6 in, and a
 * number over 60 in is a typo rather than a jump. A large jump against the last
 * test is only a warning, because a real one does happen.
 */

/** The device's own floor and a sane ceiling, in inches. */
export const HEIGHT_BOUNDS_IN = { min: 6, max: 60 } as const;
/** Outside this a contact time is a mis-read, not a jump (RSI mode). */
export const GCT_BOUNDS_MS = { min: 100, max: 1000 } as const;
/** A change larger than this against the last test asks for a second look. */
export const SOFT_WARN_IN = 6;

export interface Attempt {
  /** 1-based, in the order they were jumped. */
  readonly index: number;
  /** Inches, at 0.1. Null while the field is empty. */
  readonly heightIn: number | null;
  /** Whole milliseconds, RSI mode only. */
  readonly gctMs: number | null;
  /** Landed outside the field, or the device misread it. */
  readonly flagged: boolean;
}

export function emptyAttempts(count: number): Attempt[] {
  return Array.from({ length: count }, (_value, i) => ({
    index: i + 1,
    heightIn: null,
    gctMs: null,
    flagged: false,
  }));
}

/* ------------------------------------------------------------ validation */

export interface AttemptError {
  readonly index: number;
  readonly field: 'height' | 'gct';
  /** Names the cause and the fix. The typed value is never cleared. */
  readonly message: string;
  /** A warning lets the save through; an error does not. */
  readonly blocking: boolean;
}

export function heightError(heightIn: number | null): string | null {
  if (heightIn === null) return null;
  if (!Number.isFinite(heightIn)) return 'Enter the height the device showed.';
  if (heightIn < HEIGHT_BOUNDS_IN.min) {
    return `The OVR Jump reads from ${formatInteger(HEIGHT_BOUNDS_IN.min)} in. Check the number.`;
  }
  if (heightIn > HEIGHT_BOUNDS_IN.max) {
    return `Heights stop at ${formatInteger(HEIGHT_BOUNDS_IN.max)} in. Check the number.`;
  }
  return null;
}

export function gctError(gctMs: number | null, rsiMode: boolean): string | null {
  if (!rsiMode || gctMs === null) return null;
  if (!Number.isFinite(gctMs)) return 'Enter the contact time the device showed.';
  if (gctMs < GCT_BOUNDS_MS.min || gctMs > GCT_BOUNDS_MS.max) {
    return `Contact time runs ${formatInteger(GCT_BOUNDS_MS.min)} to ${formatInteger(
      GCT_BOUNDS_MS.max,
    )} ms. Check the number.`;
  }
  return null;
}

export interface ValidateInput {
  readonly attempts: readonly Attempt[];
  readonly rsiMode: boolean;
  /** The previous session's best, in millimetres, for the soft warning. */
  readonly lastBestMm?: number | null;
}

/** Every problem in the grid, blocking ones first. */
export function validateAttempts({
  attempts,
  rsiMode,
  lastBestMm = null,
}: ValidateInput): AttemptError[] {
  const errors: AttemptError[] = [];

  for (const attempt of attempts) {
    const height = heightError(attempt.heightIn);
    if (height !== null) {
      errors.push({ index: attempt.index, field: 'height', message: height, blocking: true });
    }
    const gct = gctError(attempt.gctMs, rsiMode);
    if (gct !== null) {
      errors.push({ index: attempt.index, field: 'gct', message: gct, blocking: true });
    }
  }

  const best = bestIn(attempts);
  if (best !== null && lastBestMm !== null) {
    const change = best - mmToIn(lastBestMm);
    if (Math.abs(change) > SOFT_WARN_IN) {
      errors.push({
        index: 0,
        field: 'height',
        message: `That is ${formatHeightValueIn(
          inToMm(Math.abs(change)),
        )} in from your last test. Check the number, or save it as it stands.`,
        blocking: false,
      });
    }
  }

  return [...errors].sort((a, b) => Number(b.blocking) - Number(a.blocking));
}

/** True when the grid holds at least one usable attempt and nothing blocking. */
export function canSave(input: ValidateInput): boolean {
  if (usableAttempts(input.attempts).length === 0) return false;
  return !validateAttempts(input).some((error) => error.blocking);
}

/* --------------------------------------------------------------- reading */

/** Attempts with a height that counts: typed, in range, and not flagged. */
export function usableAttempts(attempts: readonly Attempt[]): Attempt[] {
  return attempts.filter(
    (attempt) =>
      !attempt.flagged && attempt.heightIn !== null && heightError(attempt.heightIn) === null,
  );
}

/** Best unflagged attempt, in inches. Null when nothing counts yet. */
export function bestIn(attempts: readonly Attempt[]): number | null {
  const usable = usableAttempts(attempts);
  if (usable.length === 0) return null;
  return Math.max(...usable.map((attempt) => attempt.heightIn ?? 0));
}

/** Best minus worst, in inches. Null with fewer than two counted attempts. */
export function spreadIn(attempts: readonly Attempt[]): number | null {
  const usable = usableAttempts(attempts);
  if (usable.length < 2) return null;
  const values = usable.map((attempt) => attempt.heightIn ?? 0);
  return Math.max(...values) - Math.min(...values);
}

/** The app's own RSI for one attempt, shown beside the device's as a check. */
export function attemptRsi(attempt: Attempt): number | null {
  if (attempt.heightIn === null || attempt.gctMs === null) return null;
  if (attempt.gctMs <= 0) return null;
  return computeRsi({
    id: `attempt-${attempt.index}`,
    repNumber: attempt.index,
    heightMm: inToMm(attempt.heightIn),
    gctMs: attempt.gctMs,
    flagged: attempt.flagged,
    entrySource: 'typed',
  });
}

/** "31.8 · 32.5 · 32.1 · best of 3", the attempts line under the result. */
export function attemptsLine(attempts: readonly Attempt[]): string {
  const usable = usableAttempts(attempts);
  if (usable.length === 0) return 'No attempts yet';
  const values = usable.map((attempt) => formatHeightValueIn(inToMm(attempt.heightIn ?? 0)));
  return `${values.join(' · ')} · best of ${formatInteger(usable.length)}`;
}

/** "Best 32.5 in · spread 0.7 in", the live readout above the save control. */
export function liveReadout(attempts: readonly Attempt[]): string {
  const best = bestIn(attempts);
  if (best === null) return 'Best and spread appear once an attempt is entered';
  const spread = spreadIn(attempts);
  const bestPart = `Best ${formatHeightValueIn(inToMm(best))} in`;
  if (spread === null) return bestPart;
  return `${bestPart} · spread ${formatHeightValueIn(inToMm(spread))} in`;
}
