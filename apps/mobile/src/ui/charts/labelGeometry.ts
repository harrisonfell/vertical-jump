/**
 * Where a direct label lands once the plot is already drawn.
 *
 * A direct label beats a legend entry only while it is readable: the moment it
 * sits on the trend or on a neighbouring dot it costs more than the key it
 * replaced. This is the pass that keeps that from happening, and like the rest
 * of the chart geometry it is pure, so the rule is testable without a renderer.
 */

import { MARK, type PlacedLabel } from './scale';

/** One line of chart text, which is every direct label the charts draw. */
export const LABEL_LINE_HEIGHT = 16;

/** An axis-aligned box in plot pixels. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A direct label with everything the collision pass needs to box it. */
export interface LabelBox extends PlacedLabel {
  /** The width the label renders at. */
  readonly width: number;
  /** Which way the text runs from `x`. 'left' is PlotText's end anchor. */
  readonly side: 'left' | 'right';
  /** The mark this label names: it may sit on its own mark, never on another. */
  readonly own?: readonly [number, number];
}

/** The box a label covers when its line is centred on `y`. */
export function labelRect(label: LabelBox, y: number, lineHeight = LABEL_LINE_HEIGHT): Rect {
  return {
    left: label.side === 'left' ? label.x - label.width : label.x,
    right: label.side === 'left' ? label.x : label.x + label.width,
    top: y - lineHeight / 2,
    bottom: y + lineHeight / 2,
  };
}

/**
 * Liang-Barsky: does the segment from `a` to `b` cross the box? Clipping the
 * parameter range is exact, so a line that only cuts a corner still counts.
 */
export function segmentHitsRect(
  a: readonly [number, number],
  b: readonly [number, number],
  rect: Rect,
): boolean {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, ax - rect.left],
    [dx, rect.right - ax],
    [-dy, ay - rect.top],
    [dy, rect.bottom - ay],
  ];
  let enter = 0;
  let exit = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > exit) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < exit) exit = t;
    }
  }
  return true;
}

/** Does any leg of an already-projected polyline cross the box? */
export function polylineHitsRect(
  points: readonly (readonly [number, number])[],
  rect: Rect,
): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    if (segmentHitsRect(a, b, rect)) return true;
  }
  return false;
}

/** Everything a direct label has to keep clear of, already projected. */
export interface PlotGeometry {
  /** Series, trend, pace: every line on the plot. */
  readonly lines: readonly (readonly (readonly [number, number])[])[];
  /** Every mark on the plot, including the ones the labels name. */
  readonly marks: readonly (readonly [number, number])[];
}

export interface AvoidOptions {
  /** The band a label may sit in, top then bottom. */
  readonly bounds: readonly [number, number];
  /** How far one try moves the label. */
  readonly step?: number;
  /** Tries in each direction before a label keeps the place it wanted. */
  readonly maxSteps?: number;
  /** The clearance a mark asks for, its centre to the label's edge. */
  readonly markRadius?: number;
  readonly lineHeight?: number;
}

/**
 * Lifts each direct label clear of what it would otherwise sit on: the trend,
 * the observed path, the required pace, the marks around it, and the labels
 * already placed. It tries the same distance above before below, because a
 * value reads as belonging to the mark beneath it, and it moves by the smallest
 * step that clears, because a label that leaves its mark names nothing.
 *
 * A label that can clear nothing keeps the place it wanted: a wrong-looking
 * overlap is recoverable from the table twin, a detached label is not.
 *
 * `labels` is in priority order, first pick to the first label.
 */
export function avoidGeometry(
  labels: readonly LabelBox[],
  geometry: PlotGeometry,
  options: AvoidOptions,
): ReadonlyMap<string, number> {
  const step = options.step ?? 6;
  const maxSteps = options.maxSteps ?? 5;
  const markRadius = options.markRadius ?? MARK.dotRadius + MARK.gap;
  const lineHeight = options.lineHeight ?? LABEL_LINE_HEIGHT;
  const [top, bottom] = options.bounds;

  const offsets = [0];
  for (let i = 1; i <= maxSteps; i += 1) offsets.push(-i * step, i * step);

  const taken: Rect[] = [];
  const out = new Map<string, number>();
  for (const label of labels) {
    let chosen = Math.min(Math.max(label.y, top), bottom);
    for (const offset of offsets) {
      const y = label.y + offset;
      if (y < top || y > bottom) continue;
      const rect = labelRect(label, y, lineHeight);
      if (rectIsBlocked(rect, label, geometry, taken, markRadius)) continue;
      chosen = y;
      break;
    }
    out.set(label.key, chosen);
    taken.push(labelRect(label, chosen, lineHeight));
  }
  return out;
}

function rectIsBlocked(
  rect: Rect,
  label: LabelBox,
  geometry: PlotGeometry,
  taken: readonly Rect[],
  markRadius: number,
): boolean {
  for (const line of geometry.lines) {
    if (polylineHitsRect(line, rect)) return true;
  }
  for (const mark of geometry.marks) {
    const [mx, my] = mark;
    const own = label.own;
    if (own !== undefined && Math.abs(mx - own[0]) < 0.5 && Math.abs(my - own[1]) < 0.5) {
      continue;
    }
    if (
      mx >= rect.left - markRadius &&
      mx <= rect.right + markRadius &&
      my >= rect.top - markRadius &&
      my <= rect.bottom + markRadius
    ) {
      return true;
    }
  }
  for (const other of taken) {
    if (
      rect.left < other.right &&
      rect.right > other.left &&
      rect.top < other.bottom &&
      rect.bottom > other.top
    ) {
      return true;
    }
  }
  return false;
}
