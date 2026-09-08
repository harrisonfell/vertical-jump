/**
 * Unit conversion, rounding, and display notation for @vert/engine.
 *
 * Storage units are metric and integral where practical:
 *   heights mm, loads kg, distances m, velocities m/s, durations s.
 * Every string a screen shows comes from a formatter here, never from
 * hand-built template literals, so notation stays identical everywhere.
 */

/** Multiplication sign U+00D7, never the letter x. */
export const TIMES = '\u00d7';
/** Minus sign U+2212, never the hyphen. */
export const MINUS = '\u2212';

const MM_PER_INCH = 25.4;
const KG_PER_LB = 0.45359237;

/* ---------------------------------------------------------------- length */

export function mmToIn(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inToMm(inches: number): number {
  return inches * MM_PER_INCH;
}

/* ------------------------------------------------------------------ mass */

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/* -------------------------------------------------------------- rounding */

/**
 * Half-up rounding to a number of decimals, symmetric about zero so that
 * -0.05 and 0.05 both round away from zero at one decimal.
 */
export function roundHalfUp(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  // Nudge by an epsilon proportional to the magnitude so that binary
  // representations such as 2.675 still land on the intended side.
  const magnitude = Math.abs(scaled);
  const nudged = magnitude + Number.EPSILON * magnitude * 8;
  return (sign * Math.round(nudged)) / factor;
}

/** Round to the nearest multiple of `step`, ties away from zero. */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) throw new RangeError('step must be positive');
  return roundHalfUp(value / step, 0) * step;
}

/** Round down to a multiple of `step`. */
export function floorToStep(value: number, step: number): number {
  if (step <= 0) throw new RangeError('step must be positive');
  return Math.floor(value / step + Number.EPSILON) * step;
}

/** Round to the nearest multiple of `step`, ties toward zero. */
export function roundToStepTiesDown(value: number, step: number): number {
  if (step <= 0) throw new RangeError('step must be positive');
  const quotient = value / step;
  const floor = Math.floor(quotient);
  const remainder = quotient - floor;
  const rounded = remainder > 0.5 + Number.EPSILON ? floor + 1 : floor;
  return rounded * step;
}

/** How a prescribed load is snapped to what the gym actually has. */
export type LoadGrid = 'barbell' | 'dumbbell' | 'ballistic';

/**
 * Snap a load in pounds to the equipment grid.
 * barbell: 5 lb grid, half-up. dumbbell: 5 lb grid, ties down.
 * ballistic: 5 lb grid, always down (never overload a jump).
 */
export function roundLoadLb(lb: number, grid: LoadGrid, step = 5): number {
  switch (grid) {
    case 'barbell':
      return roundToStep(lb, step);
    case 'dumbbell':
      return roundToStepTiesDown(lb, step);
    case 'ballistic':
      return floorToStep(lb, step);
  }
}

/** Snap a load stored in kg to the display grid and return pounds. */
export function displayLoadLb(kg: number, grid: LoadGrid, step = 5): number {
  return roundLoadLb(kgToLb(kg), grid, step);
}

/* ------------------------------------------------------------ formatters */

/** Fixed-decimal formatter that never emits a locale group separator. */
function fixed(value: number, decimals: number): string {
  const rounded = roundHalfUp(value, decimals);
  const text = rounded.toFixed(decimals);
  // toFixed can produce "-0.0"; collapse it to the positive form.
  return text === (0).toFixed(decimals) ? text : text.replace(/^-0(\.0+)?$/, '0$1');
}

/** Whole-number formatter with a real minus sign for negatives. */
export function formatInteger(value: number): string {
  const rounded = roundHalfUp(value, 0);
  return rounded < 0 ? `${MINUS}${Math.abs(rounded)}` : `${rounded}`;
}

/** The height unit the athlete reads, split out for the display composition. */
export const HEIGHT_UNIT = 'in';

/** Jump height stored in mm, shown in inches at one decimal, no unit: "32.5". */
export function formatHeightValueIn(mm: number): string {
  return fixed(mmToIn(mm), 1);
}

/** Jump height stored in mm, shown in inches at one decimal: "32.5 in". */
export function formatHeightIn(mm: number): string {
  return `${formatHeightValueIn(mm)} ${HEIGHT_UNIT}`;
}

/** Ground contact time stored in seconds, shown in whole ms: "212 ms". */
export function formatContactMs(seconds: number): string {
  return `${formatInteger(seconds * 1000)} ms`;
}

/** Mean velocity, two decimals: "0.82 m/s". */
export function formatVelocity(metersPerSecond: number): string {
  return `${fixed(metersPerSecond, 2)} m/s`;
}

/** A velocity target zone: "0.75 to 1.00 m/s". */
export function formatVelocityZone(lowMs: number, highMs: number): string {
  return `${fixed(lowMs, 2)} to ${fixed(highMs, 2)} m/s`;
}

/** Rest, always mm:ss with a leading whole minute: "3:00". */
export function formatRest(seconds: number): string {
  const total = Math.max(0, roundHalfUp(seconds, 0));
  const minutes = Math.floor(total / 60);
  const secs = total - minutes * 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

/** A hold in seconds: "30 s hold". */
export function formatHold(seconds: number): string {
  return `${formatInteger(seconds)} s hold`;
}

/**
 * A lifting tempo for a row's second line: "3 s up, 3 s down".
 *
 * Heavy slow resistance is the load and the tempo together, so the tempo is a
 * prescription rather than a cue: a calf raise at the same weight taken at
 * speed is a different exercise.
 */
export function formatTempo(upS: number, downS: number): string {
  return `${formatInteger(upS)} s up, ${formatInteger(downS)} s down`;
}

/** A distance stored in metres: "15 m". */
export function formatDistance(meters: number): string {
  return `${formatInteger(meters)} m`;
}

/**
 * A run counted in repetitions rather than in load: "1 rep", "4 reps".
 * A change-of-direction drill is a run, not a bodyweight lift, so its row
 * never reads "1 × BW".
 */
export function formatRepsOnly(reps: number): string {
  const rounded = roundHalfUp(reps, 0);
  return `${formatInteger(reps)} ${Math.abs(rounded) === 1 ? 'rep' : 'reps'}`;
}

/** The cuts a change-of-direction row contains: "1 cut", "2 cuts". */
export function formatCuts(cuts: number): string {
  const rounded = roundHalfUp(cuts, 0);
  return `${formatInteger(cuts)} ${Math.abs(rounded) === 1 ? 'cut' : 'cuts'}`;
}

/** A load already snapped to the display grid: "205 lb". */
export function formatLoadLb(lb: number): string {
  return `${formatInteger(lb)} lb`;
}

/** A loaded set: "5 × 205 lb". */
export function formatLoadedSet(reps: number, loadLb: number): string {
  return `${formatInteger(reps)} ${TIMES} ${formatLoadLb(loadLb)}`;
}

/**
 * A bodyweight set: "8 × BW", or "8 × BW + 20 lb vest" when an external
 * load rides along.
 */
export function formatBodyweightSet(reps: number, addedLb?: number): string {
  const base = `${formatInteger(reps)} ${TIMES} BW`;
  if (addedLb === undefined || addedLb === 0) return base;
  return `${base} + ${formatLoadLb(addedLb)} vest`;
}

/**
 * A weighted pull-up row: "5 × BW + 45 lb". Only the added load is shown,
 * because only the added load is prescribed (house `house.sc.upper_power_day`).
 */
export function formatAddedLoadSet(reps: number, addedLb: number): string {
  const base = `${formatInteger(reps)} ${TIMES} BW`;
  if (addedLb <= 0) return base;
  return `${base} + ${formatLoadLb(addedLb)}`;
}

/**
 * A bodyweight row that may carry a load the athlete adds if they have one:
 * "8 x BW - RPE 8 - + __ lb".
 *
 * The blank is a plus, not a load: bodyweight alone is a complete set, and the
 * field is there because the same movement becomes heavy slow resistance once
 * a dumbbell is in the hand.
 */
export function formatOptionalAddedLoadRow(reps: number, rpe: number): string {
  const effort = Number.isInteger(rpe) ? `${rpe}` : `${roundHalfUp(rpe, 1)}`;
  return `${formatInteger(reps)} ${TIMES} BW \u00b7 RPE ${effort} \u00b7 + __ lb`;
}

/** A sets-by-reps scheme: "3 × 3". */
export function formatSetsByReps(sets: number, reps: number): string {
  return `${formatInteger(sets)} ${TIMES} ${formatInteger(reps)}`;
}

/** One entry of the "last time" line: what a single logged set was. */
export interface LastTimeSet {
  reps: number;
  /** Absent on a bodyweight set, so the entry is the rep count alone. */
  loadLb?: number;
}

/** Above this many identical sets the line collapses instead of repeating. */
const LAST_TIME_COLLAPSE_ABOVE = 4;

/** "5 × 205" inside the last-time line: the unit rides on the header line. */
function lastTimeEntry(set: LastTimeSet): string {
  if (set.loadLb === undefined) return formatInteger(set.reps);
  return `${formatInteger(set.reps)} ${TIMES} ${formatInteger(set.loadLb)}`;
}

/**
 * What the athlete did last time, as brief section 13 sets it:
 * "last 5 / 5" for a bodyweight row, "last 5 × 205 / 4 × 220" when the sets
 * carried load, and "last 8 × 6 sets" once more than four sets ran identical,
 * because six repeats of the same pair is a wall, not a line.
 *
 * A collapsed loaded row keeps its pair in front of the count:
 * "last 5 × 205 × 6 sets".
 */
export function formatLastTime(sets: readonly LastTimeSet[]): string | undefined {
  if (sets.length === 0) return undefined;
  const entries = sets.map(lastTimeEntry);
  const first = entries[0] ?? '';
  const identical = entries.every((entry) => entry === first);
  if (identical && entries.length > LAST_TIME_COLLAPSE_ABOVE) {
    return `last ${first} ${TIMES} ${formatInteger(entries.length)} sets`;
  }
  return `last ${entries.join(' / ')}`;
}

/** A signed delta as a percentage with a real minus: "−20%". */
export function formatPercentDelta(percent: number): string {
  const rounded = roundHalfUp(percent, 0);
  if (rounded < 0) return `${MINUS}${Math.abs(rounded)}%`;
  if (rounded > 0) return `+${rounded}%`;
  return '0%';
}

/** A signed height delta in inches: "+0.4" or "−0.4". */
export function formatHeightDeltaIn(deltaMm: number): string {
  const inches = roundHalfUp(mmToIn(deltaMm), 1);
  const text = Math.abs(inches).toFixed(1);
  if (inches < 0) return `${MINUS}${text}`;
  if (inches > 0) return `+${text}`;
  return text;
}

/**
 * A velocity-mode prescription:
 * "3 × 3 @ 0.75 to 1.00 m/s, stop at −20%".
 */
export function formatVelocitySet(
  sets: number,
  reps: number,
  lowMs: number,
  highMs: number,
  lossCutoffPercent: number,
): string {
  const scheme = formatSetsByReps(sets, reps);
  const zone = formatVelocityZone(lowMs, highMs);
  const cutoff = formatPercentDelta(-Math.abs(lossCutoffPercent));
  return `${scheme} @ ${zone}, stop at ${cutoff}`;
}
