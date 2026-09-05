/**
 * Pure scale, domain, and label geometry. No React, no react-native, no SVG:
 * every rule a chart makes about where a mark lands is testable here.
 */

import type { IsoDay } from './props';

const MS_PER_DAY = 86_400_000;
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
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Gaps longer than this are drawn broken rather than bridged with a line. */
export const MAX_GAP_DAYS = 21;

/** Data-mark geometry, fixed across every chart in the app. */
export const MARK = {
  /** An 8px dot: r = 4. */
  dotRadius: 4,
  /** Every mark's touch and pointer target, whatever the mark's own size. */
  hitSize: 24,
  /** Series lines and the rolling median. */
  lineWidth: 2,
  /** The surface gap and ring that separate touching marks. */
  gap: 2,
  /** Columns never fill their band. */
  maxColumnWidth: 24,
} as const;

/**
 * Plot padding, shared by every stacked panel so their x axes line up.
 *
 * The right pad is not decoration: the goal label sits outside the plot, 6px
 * past the right edge, so the pad has to hold the widest right-side label plus
 * a margin or "36.0 goal" runs out of the chart's own box and into whatever is
 * beside it. 6 offset + 64 label + 6 margin.
 */
export const PLOT_PAD = { top: 14, right: 76, bottom: 20, left: 30 } as const;

/**
 * Days since 1970-01-01 for a 'YYYY-MM-DD' day. Parsed by hand rather than
 * through `new Date(string)` so no runtime's timezone can move a training day.
 */
export function parseDay(day: IsoDay): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) {
    throw new Error(`Not a YYYY-MM-DD day: ${day}`);
  }
  return Math.round(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

/** The inverse of `parseDay`. */
export function toDay(dayNumber: number): IsoDay {
  const d = new Date(dayNumber * MS_PER_DAY);
  const year = `${d.getUTCFullYear()}`.padStart(4, '0');
  const month = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const date = `${d.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${date}`;
}

/** Whole days from `a` to `b`, negative when `b` is earlier. */
export function daysBetween(a: IsoDay, b: IsoDay): number {
  return parseDay(b) - parseDay(a);
}

/** `n` days after `day`, `n` may be negative. */
export function addDays(day: IsoDay, n: number): IsoDay {
  return toDay(parseDay(day) + n);
}

/** Axis and label form: "13 Sep". */
export function formatDayShort(day: IsoDay): string {
  const date = Number(day.slice(8, 10));
  const month = MONTHS[Number(day.slice(5, 7)) - 1] ?? '';
  return `${date} ${month}`;
}

/** Tooltip and table form: "Sat 13 Sep". */
export function formatDayLong(day: IsoDay): string {
  const weekday = WEEKDAYS[(((parseDay(day) + 4) % 7) + 7) % 7] ?? '';
  return `${weekday} ${formatDayShort(day)}`;
}

/**
 * The fixed y domain for a height chart: [min(baseline, tests) − 2,
 * max(goal, tests) + 2], snapped out to whole inches. It is computed once from
 * the program's own numbers and never rescales as tests arrive, so the slope
 * the athlete sees in week 2 is the slope they see in week 12.
 */
export function fixedHeightDomain(input: {
  readonly baselineIn: number;
  readonly goalIn: number;
  readonly testsIn: readonly number[];
}): readonly [number, number] {
  const { baselineIn, goalIn, testsIn } = input;
  let lo = baselineIn;
  let hi = goalIn;
  for (const value of testsIn) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  return [Math.floor(lo - 2), Math.ceil(hi + 2)];
}

/**
 * Whole-inch ticks inside a domain, at a 1, 2, 5, or 10 inch step: the first
 * step that keeps the count at or under `maxTicks`. Never a fractional inch.
 */
export function wholeInchTicks(
  domain: readonly [number, number],
  maxTicks = 6,
): readonly number[] {
  const [lo, hi] = domain;
  if (!(hi > lo) || maxTicks < 2) return [lo];
  for (const step of [1, 2, 5, 10, 20, 50]) {
    const first = Math.ceil(lo / step) * step;
    const count = Math.floor((hi - first) / step) + 1;
    if (count <= maxTicks) {
      const ticks: number[] = [];
      for (let v = first; v <= hi + 1e-9; v += step) ticks.push(Math.round(v));
      return ticks;
    }
  }
  return [Math.ceil(lo), Math.floor(hi)];
}

/**
 * Splits a dated series wherever the gap between neighbours exceeds
 * `maxGapDays`, so a line is never drawn across a month the athlete did not
 * test. Sorts defensively; drops empty runs.
 */
export function segmentByGap<T>(
  points: readonly T[],
  dayOf: (point: T) => IsoDay,
  maxGapDays: number = MAX_GAP_DAYS,
): readonly (readonly T[])[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => parseDay(dayOf(a)) - parseDay(dayOf(b)));
  const segments: T[][] = [];
  let run: T[] = [];
  let previous: number | null = null;
  for (const point of sorted) {
    const day = parseDay(dayOf(point));
    if (previous !== null && day - previous > maxGapDays) {
      segments.push(run);
      run = [];
    }
    run.push(point);
    previous = day;
  }
  segments.push(run);
  return segments.filter((segment) => segment.length > 0);
}

/** One direct label asking to sit at `y`. */
export interface LabelSlot {
  readonly key: string;
  /** The y the label wants: its mark's own y. */
  readonly y: number;
}

/**
 * Nudges direct labels apart vertically so none overlaps its neighbour, then
 * clamps the whole stack inside `bounds`. Labels move only on y and only as far
 * as they must, so each stays attached to its mark. Deterministic: equal ys
 * break ties on key.
 */
export function nudgeLabels(
  slots: readonly LabelSlot[],
  minGap: number,
  bounds: readonly [number, number],
): ReadonlyMap<string, number> {
  const [top, bottom] = bounds;
  const order = [...slots].sort((a, b) => a.y - b.y || (a.key < b.key ? -1 : 1));
  const placed = order.map((slot) => ({ key: slot.key, y: slot.y }));

  // Sweep down: each label sits at least `minGap` below the one above it.
  for (let i = 1; i < placed.length; i += 1) {
    const above = placed[i - 1];
    const here = placed[i];
    if (above === undefined || here === undefined) continue;
    if (here.y - above.y < minGap) here.y = above.y + minGap;
  }
  // Sweep up: pull the stack back inside the plot without reintroducing overlap.
  const last = placed[placed.length - 1];
  if (last !== undefined && last.y > bottom) last.y = bottom;
  for (let i = placed.length - 2; i >= 0; i -= 1) {
    const below = placed[i + 1];
    const here = placed[i];
    if (below === undefined || here === undefined) continue;
    if (below.y - here.y < minGap) here.y = below.y - minGap;
  }
  const first = placed[0];
  if (first !== undefined && first.y < top) {
    // The stack is taller than the plot: start at the top and let it run on.
    let y = top;
    for (const slot of placed) {
      slot.y = y;
      y += minGap;
    }
  }
  return new Map(placed.map((slot) => [slot.key, slot.y]));
}

/** A direct label with the x of the mark it belongs to. */
export interface PlacedLabel extends LabelSlot {
  readonly x: number;
}

/**
 * Groups labels that are close enough on x to overlap, so only real collisions
 * get nudged. A label pushed off its own mark to clear a label 200px away reads
 * as noise; one that never moves overlaps its neighbour. Clustering first is
 * what keeps both from happening.
 */
export function clusterByX(
  labels: readonly PlacedLabel[],
  threshold: number,
): readonly (readonly PlacedLabel[])[] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
  const clusters: PlacedLabel[][] = [];
  let run: PlacedLabel[] = [];
  let previousX: number | null = null;
  for (const label of sorted) {
    if (previousX !== null && label.x - previousX > threshold) {
      clusters.push(run);
      run = [];
    }
    run.push(label);
    previousX = label.x;
  }
  clusters.push(run);
  return clusters.filter((cluster) => cluster.length > 0);
}

/**
 * Nudges only the labels that actually collide: cluster on x, then sweep each
 * cluster on y. Returns every label's final y, moved or not.
 */
export function placeLabels(
  labels: readonly PlacedLabel[],
  options: {
    readonly minGap: number;
    readonly bounds: readonly [number, number];
    readonly xThreshold: number;
  },
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const cluster of clusterByX(labels, options.xThreshold)) {
    for (const [key, y] of nudgeLabels(cluster, options.minGap, options.bounds)) {
      out.set(key, y);
    }
  }
  return out;
}

/** The `d` attribute for a polyline through already-projected points. */
export function polylinePath(points: readonly (readonly [number, number])[]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`)
    .join(' ');
}

/** A closed band between an upper and a lower edge, both already projected. */
export function bandPath(
  upper: readonly (readonly [number, number])[],
  lower: readonly (readonly [number, number])[],
): string {
  if (upper.length === 0 || lower.length === 0) return '';
  const back = [...lower].reverse();
  return `${polylinePath(upper)} ${back
    .map(([x, y]) => `L${round(x)} ${round(y)}`)
    .join(' ')} Z`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The day nearest an x position, used by the crosshair so the reader aims at a
 * date and never at a 2px line.
 */
export function nearestDay(
  x: number,
  scale: (day: IsoDay) => number,
  days: readonly IsoDay[],
): IsoDay | null {
  let best: IsoDay | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const day of days) {
    const distance = Math.abs(scale(day) - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = day;
    }
  }
  return best;
}

/** The Whoop band a recovery score falls in. Thresholds are Whoop's own. */
export function recoveryBand(score: number): 'low' | 'moderate' | 'high' {
  if (score < 34) return 'low';
  if (score < 67) return 'moderate';
  return 'high';
}

/**
 * The centred rolling median of a series with holes. A pending day stays a hole
 * in the output, so the line breaks rather than dipping through a zero.
 */
export function rollingMedian(
  values: readonly (number | null)[],
  window: number,
): readonly (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((value, i) => {
    if (value === null) return null;
    const slice: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      const v = values[j];
      if (v !== null && v !== undefined) slice.push(v);
    }
    if (slice.length === 0) return null;
    slice.sort((a, b) => a - b);
    const mid = Math.floor(slice.length / 2);
    if (slice.length % 2 === 1) return slice[mid] ?? null;
    const a = slice[mid - 1];
    const b = slice[mid];
    return a === undefined || b === undefined ? null : (a + b) / 2;
  });
}

/** The median of the values present, ignoring pending days. */
export function median(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const mid = Math.floor(present.length / 2);
  if (present.length % 2 === 1) return present[mid] ?? null;
  const a = present[mid - 1];
  const b = present[mid];
  return a === undefined || b === undefined ? null : (a + b) / 2;
}
