/**
 * The height chart's direct labels: which four exist, what each one says, and
 * where it ends up once the plot underneath it is accounted for.
 *
 * It lives outside the component because placement is the part that can be
 * wrong: a renderer is not needed to prove that "32.5 latest" is not sitting on
 * the trend segment, and a pure function is.
 */

import { avoidGeometry, type LabelBox } from './labelGeometry';
import type { IsoDay, JumpChartData, JumpPoint, SeriesPoint } from './props';
import { placeLabels, type PlacedLabel } from './scale';

/** How far a direct label sits clear of the mark it names. */
export const LABEL_OFFSET = 13;

/** The rendered width of each direct label, at the caption size. */
export const LABEL_WIDTH = { goal: 64, baseline: 78, latest: 86, pr: 62 } as const;

export type LabelKey = keyof typeof LABEL_WIDTH;

/** A direct label, placed and ready to draw. */
export interface DirectLabel {
  readonly key: LabelKey;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'end';
  readonly width: number;
  readonly color: 'ink' | 'ink3';
}

export interface JumpLabelInput {
  readonly data: JumpChartData;
  /** The newest canonical test, if the stream has one. */
  readonly latest: JumpPoint | undefined;
  readonly prTest: JumpPoint | undefined;
  /** The observed path, already split on gaps. */
  readonly observedSegments: readonly (readonly JumpPoint[])[];
  readonly px: (day: IsoDay) => number;
  readonly py: (value: number) => number;
  readonly project: (point: SeriesPoint) => readonly [number, number];
  /** The plot's right edge, where the goal point sits. */
  readonly right: number;
  /** The band a label may sit in, top then bottom. */
  readonly bounds: readonly [number, number];
}

interface Wanted extends DirectLabel {
  readonly side: 'left' | 'right';
  readonly own: readonly [number, number];
}

/** One inch, one decimal: the athlete reads "32.5", never "32.50". */
function inches(value: number): string {
  return value.toFixed(1);
}

/**
 * A direct label sits to the left of its mark, and flips to the right when the
 * mark is early enough that the label would run off the plot. Measuring first
 * is the rule: a label never gets clipped to make room.
 */
export function sideOf(
  x: number,
  labelWidth: number,
): { readonly anchor: 'start' | 'end'; readonly side: 'left' | 'right'; readonly x: number } {
  return x - labelWidth < 4
    ? { anchor: 'start', side: 'right', x: x + 8 }
    : { anchor: 'end', side: 'left', x: x - 8 };
}

/**
 * Latest, PR, baseline, goal, in that order of claim.
 *
 * Each rides clear of its own mark before anything else happens: a value set on
 * the dot's own centre line lies straight across the series. The baseline label
 * drops below its marker because the observed path leaves it upward and to the
 * right; the rest sit above-left, on a paper backing.
 *
 * Then two passes move whatever would still collide: `placeLabels` for labels
 * that share a stretch of the x axis, and `avoidGeometry` for the trend segment,
 * the observed path, the required pace, and the neighbouring marks. Reading a
 * number off a chart should never mean reading it off a line.
 */
export function jumpDirectLabels(input: JumpLabelInput): readonly DirectLabel[] {
  const { data, latest, prTest, observedSegments, px, py, project, right, bounds } = input;
  const wanted: Wanted[] = [];

  if (latest !== undefined) {
    const at = sideOf(px(latest.date), LABEL_WIDTH.latest);
    wanted.push({
      key: 'latest',
      text:
        latest.pr === true
          ? `${inches(latest.heightIn)} latest · PR`
          : `${inches(latest.heightIn)} latest`,
      anchor: at.anchor,
      side: at.side,
      x: at.x,
      y: py(latest.heightIn) - LABEL_OFFSET,
      own: [px(latest.date), py(latest.heightIn)],
      width: LABEL_WIDTH.latest,
      color: 'ink',
    });
  }
  if (prTest !== undefined && prTest.date !== latest?.date) {
    const at = sideOf(px(prTest.date), LABEL_WIDTH.pr);
    wanted.push({
      key: 'pr',
      text: `${inches(prTest.heightIn)} PR`,
      anchor: at.anchor,
      side: at.side,
      x: at.x,
      y: py(prTest.heightIn) - LABEL_OFFSET,
      own: [px(prTest.date), py(prTest.heightIn)],
      width: LABEL_WIDTH.pr,
      color: 'ink',
    });
  }
  wanted.push({
    key: 'baseline',
    text: `${inches(data.baseline.heightIn)} baseline`,
    anchor: 'start',
    side: 'right',
    x: px(data.baseline.date) + 8,
    y: py(data.baseline.heightIn) + LABEL_OFFSET,
    own: [px(data.baseline.date), py(data.baseline.heightIn)],
    width: LABEL_WIDTH.baseline,
    color: 'ink3',
  });
  wanted.push({
    key: 'goal',
    text: `${inches(data.goalIn)} goal`,
    anchor: 'start',
    side: 'right',
    x: right + 6,
    y: py(data.goalIn),
    own: [right, py(data.goalIn)],
    width: LABEL_WIDTH.goal,
    color: 'ink3',
  });

  const slots: PlacedLabel[] = wanted.map(({ key, x, y }) => ({ key, x, y }));
  const stacked = placeLabels(slots, { minGap: 16, bounds, xThreshold: 80 });

  const pace: readonly (readonly [number, number])[] = [
    [px(data.baseline.date), py(data.baseline.heightIn)],
    [right, py(data.goalIn)],
  ];
  const lines: (readonly (readonly [number, number])[])[] = [pace];
  for (const segment of observedSegments) {
    lines.push(segment.map((test): readonly [number, number] => [px(test.date), py(test.heightIn)]));
  }
  if (data.trend !== undefined && data.trend.length >= 2) lines.push(data.trend.map(project));
  if (data.projection !== undefined) lines.push(data.projection.line.map(project));

  const marks: (readonly [number, number])[] = [
    [px(data.baseline.date), py(data.baseline.heightIn)],
    [right, py(data.goalIn)],
  ];
  for (const test of data.tests) marks.push([px(test.date), py(test.heightIn)]);

  const boxes: LabelBox[] = wanted.map((label) => ({
    key: label.key,
    x: label.x,
    y: stacked.get(label.key) ?? label.y,
    width: label.width,
    side: label.side,
    own: label.own,
  }));
  const placed = avoidGeometry(boxes, { lines, marks }, { bounds, step: 6, maxSteps: 5 });

  return wanted.map(({ key, text, x, y, anchor, width, color }) => ({
    key,
    text,
    x,
    y: placed.get(key) ?? y,
    anchor,
    width,
    color,
  }));
}
