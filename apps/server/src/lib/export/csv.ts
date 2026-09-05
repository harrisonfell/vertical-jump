/**
 * CSV writing and the two display conversions the export needs.
 *
 * RFC 4180 to the letter: a field is quoted only when it holds a quote, a
 * comma, or a line break, a quote inside a quoted field is doubled, records
 * end CRLF, and the last record ends CRLF too. That is byte for byte what the
 * phone's exporter writes, so an export taken on a laptop and one taken on the
 * phone are the same file.
 *
 * The unit helpers are the four the display columns need, transcribed from
 * @vert/engine/units rather than imported: the engine is a React Native
 * workspace package the Next build has no reason to bundle, and these are four
 * lines of arithmetic with a test that pins them to the engine's own numbers.
 */

const MM_PER_INCH = 25.4;
const KG_PER_LB = 0.45359237;

export type Cell = string | number | boolean | null | undefined;

/** One CSV field, quoted only when it has to be. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : `${value}`;
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A whole CSV, CRLF-terminated the way RFC 4180 asks. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Half-up rounding, symmetric about zero, nudged so that a value such as 2.675
 * lands where a reader expects rather than where binary floating point does.
 */
export function roundHalfUp(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const magnitude = Math.abs(scaled);
  const nudged = magnitude + Number.EPSILON * magnitude * 8;
  return (sign * Math.round(nudged)) / factor;
}

/** Round to the nearest multiple of `step`, ties away from zero. */
export function roundToStep(value: number, step: number): number {
  return roundHalfUp(value / step, 0) * step;
}

/** Rounded to `decimals`, or null so a gap stays a gap and never a zero. */
export function round(value: number | null, decimals: number): number | null {
  return value === null ? null : roundHalfUp(value, decimals);
}

/** Jump height stored in mm, shown in inches at one decimal: "32.5". */
export function formatHeightValueIn(mm: number): string {
  return roundHalfUp(mm / MM_PER_INCH, 1).toFixed(1);
}

/** A load stored in kg, shown on the barbell's 5 lb grid, half up. */
export function displayLoadLb(kg: number, step = 5): number {
  return roundToStep(kg / KG_PER_LB, step);
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/**
 * "YYYY-MM-DD" in the athlete's own timezone. The server has no local day of
 * its own, so the export is stamped with the day the athlete is living in.
 */
export function localDayIn(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
