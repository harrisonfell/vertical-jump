/**
 * Stepper arithmetic, kept pure and free of imports so it can be tested in
 * node and reasoned about on its own.
 *
 * The problem it exists to solve: 0.1 steps. 32.5 + 0.1 in binary floating
 * point is 32.599999999999994, and an attempt field that shows 32.6 but stores
 * 32.599999999999994 will eventually print the wrong height. Every step is
 * therefore taken in integer space at the step's own precision.
 */

export interface StepBounds {
  readonly min?: number;
  readonly max?: number;
}

/** Decimal places implied by a step: 0.1 has one, 5 has none. */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toString();
  const exponent = text.indexOf('e');
  if (exponent !== -1) {
    const tail = Number(text.slice(exponent + 1));
    return tail < 0 ? Math.min(-tail, 6) : 0;
  }
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  return Math.min(text.length - dot - 1, 6);
}

/** Rounds to a fixed number of decimals without binary drift. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const magnitude = Math.abs(scaled);
  const nudged = magnitude + Number.EPSILON * magnitude * 8;
  return (sign * Math.round(nudged)) / factor;
}

/** Clamps into the bounds, leaving an unset bound open. */
export function clampToBounds(value: number, bounds: StepBounds = {}): number {
  const { min, max } = bounds;
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

/**
 * One press of minus or plus. Returns the clamped, precision-correct value.
 */
export function stepValue(
  value: number,
  step: number,
  direction: 1 | -1,
  bounds: StepBounds = {},
): number {
  if (!Number.isFinite(value)) return clampToBounds(bounds.min ?? 0, bounds);
  const decimals = decimalsForStep(step);
  const factor = 10 ** decimals;
  const scaled = Math.round(roundTo(value, decimals) * factor) + direction * Math.round(step * factor);
  return clampToBounds(scaled / factor, bounds);
}

/** True when a press in this direction would change nothing. */
export function stepDisabled(
  value: number,
  step: number,
  direction: 1 | -1,
  bounds: StepBounds = {},
): boolean {
  if (!Number.isFinite(value)) return false;
  return stepValue(value, step, direction, bounds) === roundTo(value, decimalsForStep(step));
}

/**
 * Reads a typed field. Accepts a leading minus and a single decimal point,
 * and returns null for anything the athlete has not finished typing.
 */
export function parseNumeric(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  if (!/^-?\d*\.?\d*$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
