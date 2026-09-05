/**
 * Display helpers the analytics copy needs and `src/units.ts` does not yet
 * carry: a signed two-decimal rate, a signed one-decimal inch value, a whole
 * inch, a grouped count, and a short calendar date. Reported to the
 * orchestrator as INTERFACE_GAP so they can move into `units.ts` later; the
 * strings they build are the ones brief sections 08 and 13 quote verbatim.
 *
 * Real signs only: U+00D7 for multiplication, U+2212 for a negative delta,
 * U+00B1 for a symmetric range, U+00B7 as the dot separator.
 */
import type { LocalDate } from '../types/calendar.js';
import { parseLocalDate } from '../calendar.js';
import { MINUS, roundHalfUp } from '../units.js';

/** Plus-minus sign U+00B1, used by "range +/-1 SE" and the plateau band. */
export const PLUS_MINUS = '±';

/** Middle dot U+00B7. The one separator every analytics line uses. */
export const DOT = '·';

/** The dot separator with its spaces, so no caller hand-builds it. */
export const SEP = ` ${DOT} `;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * A signed fixed-decimal number: "+0.31", "0.00", "−0.12".
 * Zero carries no sign, matching `formatHeightDeltaIn` in units.ts.
 */
export function formatSigned(value: number, decimals: number): string {
  const rounded = roundHalfUp(value, decimals);
  const text = Math.abs(rounded).toFixed(decimals);
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `${MINUS}${text}`;
  return text;
}

/** A trend or pace rate with its unit: "+0.31 in/wk". */
export function formatRateInPerWk(value: number): string {
  return `${formatSigned(value, 2)} in/wk`;
}

/** The bare rate value used inside a range: "+0.05". */
export function formatRateValue(value: number): string {
  return formatSigned(value, 2);
}

/** An unsigned height in inches at one decimal, no unit: "32.5". */
export function formatInValue(inches: number): string {
  const rounded = roundHalfUp(inches, 1);
  return rounded < 0 ? `${MINUS}${Math.abs(rounded).toFixed(1)}` : rounded.toFixed(1);
}

/** A signed height delta in inches at one decimal: "+1.2", "−1.5". */
export function formatInDelta(inches: number): string {
  return formatSigned(inches, 1);
}

/** A whole inch for the coarse projection band and the goal label: "36". */
export function formatWholeIn(inches: number): string {
  const rounded = roundHalfUp(inches, 0);
  return rounded < 0 ? `${MINUS}${Math.abs(rounded)}` : `${rounded}`;
}

/** A fraction as a whole percent: 1 becomes "100%". */
export function formatPercentWhole(fraction: number): string {
  return `${roundHalfUp(fraction * 100, 0)}%`;
}

/** A count with thousands separators: 1840 becomes "1,840". */
export function formatCount(value: number): string {
  const rounded = roundHalfUp(value, 0);
  const digits = Math.abs(rounded).toFixed(0);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rounded < 0 ? `${MINUS}${grouped}` : grouped;
}

/** A short calendar date the way Progress writes it: "29 Nov". */
export function formatShortDate(date: LocalDate): string {
  const when = new Date(parseLocalDate(date));
  const month = MONTHS[when.getUTCMonth()];
  if (month === undefined) throw new RangeError(`bad month in ${date}`);
  return `${when.getUTCDate()} ${month}`;
}

/** Join the parts of a readout with the dot separator, dropping empty parts. */
export function joinParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(SEP);
}

/** Indexed read that throws instead of widening to `undefined`. */
export function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`index ${index} is out of range`);
  return value;
}
