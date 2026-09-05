import { scaleLinear } from 'd3-scale';
import { describe, expect, it } from 'vitest';
import { LABEL_WIDTH, jumpDirectLabels, type DirectLabel } from './jumpLabels';
import { labelRect, polylineHitsRect, segmentHitsRect, type LabelBox } from './labelGeometry';
import type { IsoDay, JumpChartData, JumpPoint, SeriesPoint } from './props';
import {
  earlyTrend,
  goalMet,
  noTests,
  plateau,
  twoTests,
  withGap,
  withHollowMarks,
  withProjection,
  withStreamBreak,
} from './sampleData';
import { PLOT_PAD, fixedHeightDomain, parseDay, segmentByGap } from './scale';

/** The box a placed label ended up covering. */
function rectOf(label: DirectLabel) {
  return labelRect(
    {
      key: label.key,
      x: label.x,
      y: label.y,
      width: LABEL_WIDTH[label.key],
      side: label.anchor === 'end' ? 'left' : 'right',
    },
    label.y,
  );
}

describe('label boxes', () => {
  const box: LabelBox = { key: 'latest', x: 200, y: 100, width: 86, side: 'left' };

  it('runs a left-side label back from its anchor', () => {
    expect(labelRect(box, 100)).toEqual({ left: 114, right: 200, top: 92, bottom: 108 });
  });

  it('runs a right-side label forward from its anchor', () => {
    expect(labelRect({ ...box, side: 'right' }, 100)).toEqual({
      left: 200,
      right: 286,
      top: 92,
      bottom: 108,
    });
  });

  it('counts a segment that only cuts a corner as a hit', () => {
    const rect = labelRect(box, 100);
    expect(segmentHitsRect([110, 88], [118, 96], rect)).toBe(true);
    expect(segmentHitsRect([110, 60], [300, 60], rect)).toBe(false);
  });

  it('counts a segment that ends inside the box as a hit', () => {
    expect(segmentHitsRect([150, 100], [160, 100], labelRect(box, 100))).toBe(true);
  });

  it('walks every leg of a polyline', () => {
    const rect = labelRect(box, 100);
    const trend: readonly (readonly [number, number])[] = [
      [100, 40],
      [150, 40],
      [150, 100],
    ];
    expect(polylineHitsRect(trend, rect)).toBe(true);
    expect(polylineHitsRect([[0, 0]], rect)).toBe(false);
  });
});

describe('jumpDirectLabels', () => {
  const rising: readonly JumpPoint[] = [
    { date: '2026-09-13', heightIn: 29.8, canonical: true, instrument: 'OVR Jump' },
    { date: '2026-09-27', heightIn: 30.6, canonical: true, instrument: 'OVR Jump' },
    { date: '2026-10-11', heightIn: 31.4, canonical: true, instrument: 'OVR Jump' },
    { date: '2026-10-18', heightIn: 32.5, canonical: true, pr: true, instrument: 'OVR Jump' },
  ];
  const data: JumpChartData = {
    programStart: '2026-09-08',
    targetDate: '2026-11-29',
    today: '2026-10-20',
    baseline: { date: '2026-09-08', heightIn: 29.4, remembered: true },
    goalIn: 36,
    tests: rising,
    instrument: 'OVR Jump',
    trend: [
      { date: '2026-09-13', heightIn: 29.8 },
      { date: '2026-10-18', heightIn: 32.5 },
    ],
  };

  // A phone-width frame: 3.6px a day across, 15px an inch down.
  const px = (day: string) => 30 + (parseDay(day) - parseDay(data.programStart)) * 3.6;
  const py = (value: number) => 180 - (value - 27) * 15;
  const project = (point: SeriesPoint): readonly [number, number] => [
    px(point.date),
    py(point.heightIn),
  ];
  const RIGHT = 326;
  const BOUNDS = [22, 172] as const;

  const labels = jumpDirectLabels({
    data,
    latest: rising[3],
    prTest: rising[3],
    observedSegments: [rising],
    px,
    py,
    project,
    right: RIGHT,
    bounds: BOUNDS,
  });

  it('names the marks it should and folds the PR into the latest label', () => {
    expect(labels.map((label) => label.key)).toEqual(['latest', 'baseline', 'goal']);
    expect(labels[0]?.text).toBe('32.5 latest · PR');
    expect(labels[1]?.text).toBe('29.4 baseline');
    expect(labels[2]?.text).toBe('36.0 goal');
  });

  it('sits the latest label above and to the left of its own mark', () => {
    const latest = labels[0];
    expect(latest?.anchor).toBe('end');
    expect(latest?.x ?? 0).toBeLessThan(px('2026-10-18'));
    expect(latest?.y ?? 0).toBeLessThan(py(32.5));
  });

  it('keeps every direct label clear of the pace, the trend, and the path', () => {
    const pace: readonly (readonly [number, number])[] = [
      [px(data.baseline.date), py(data.baseline.heightIn)],
      [RIGHT, py(data.goalIn)],
    ];
    const trend = (data.trend ?? []).map(project);
    const observed = rising.map(project);
    for (const label of labels) {
      const rect = rectOf(label);
      expect(polylineHitsRect(pace, rect)).toBe(false);
      expect(polylineHitsRect(trend, rect)).toBe(false);
      expect(polylineHitsRect(observed, rect)).toBe(false);
    }
  });

  it('lifts the latest label off a trend that falls into it', () => {
    const falling: readonly JumpPoint[] = [
      { date: '2026-09-13', heightIn: 32.5, canonical: true, instrument: 'OVR Jump' },
      { date: '2026-09-27', heightIn: 31.6, canonical: true, instrument: 'OVR Jump' },
      { date: '2026-10-11', heightIn: 30.7, canonical: true, instrument: 'OVR Jump' },
      { date: '2026-10-18', heightIn: 29.8, canonical: true, instrument: 'OVR Jump' },
    ];
    const fallingData: JumpChartData = {
      ...data,
      tests: falling,
      trend: [
        { date: '2026-09-13', heightIn: 32.5 },
        { date: '2026-10-18', heightIn: 29.8 },
      ],
    };
    const out = jumpDirectLabels({
      data: fallingData,
      latest: falling[3],
      prTest: undefined,
      observedSegments: [falling],
      px,
      py,
      project,
      right: RIGHT,
      bounds: BOUNDS,
    });
    const latest = out[0];
    expect(latest?.key).toBe('latest');
    // The trend now arrives from above-left, straight through the wanted spot.
    expect(latest?.y).not.toBe(py(29.8) - 13);
    const trend = (fallingData.trend ?? []).map(project);
    expect(latest === undefined ? true : polylineHitsRect(trend, rectOf(latest))).toBe(false);
  });
});

/**
 * The frames the visual review flagged, at the three composition widths. This
 * is the regression guard for the overlapping "32.5 latest · PR" label: the
 * gallery's own data, through the real placement, with nothing rendered.
 */
describe('gallery frames', () => {
  const frames: readonly (readonly [string, JumpChartData])[] = [
    ['0 tests', noTests],
    ['1 to 2 tests', twoTests],
    ['3 to 5 tests', earlyTrend],
    ['6+ tests', withProjection],
    ['flagged', withHollowMarks],
    ['goal met', goalMet],
    ['plateau', plateau],
    ['gap', withGap],
    ['stream break', withStreamBreak],
  ];
  const sizes: readonly (readonly [number, number])[] = [
    [390, 200],
    [834, 280],
    [1280, 280],
  ];

  for (const [name, data] of frames) {
    for (const [width, height] of sizes) {
      it(`${name} at ${width} keeps its labels off the lines`, () => {
        const left = PLOT_PAD.left;
        const right = Math.max(left + 1, width - PLOT_PAD.right);
        const top = PLOT_PAD.top;
        const bottom = Math.max(top + 1, height - PLOT_PAD.bottom);
        const domainY = fixedHeightDomain({
          baselineIn: data.baseline.heightIn,
          goalIn: data.goalIn,
          testsIn: data.tests.map((test) => test.heightIn),
        });
        const xScale = scaleLinear()
          .domain([parseDay(data.programStart), parseDay(data.targetDate)])
          .range([left, right]);
        const yScale = scaleLinear().domain([domainY[0], domainY[1]]).range([bottom, top]);
        const px = (day: IsoDay) => xScale(parseDay(day));
        const py = (value: number) => yScale(value);
        const project = (point: SeriesPoint): readonly [number, number] => [
          px(point.date),
          py(point.heightIn),
        ];
        const canonical = data.tests.filter((test) => test.canonical && test.flagged !== true);
        const observedSegments = segmentByGap(canonical, (test) => test.date);

        const labels = jumpDirectLabels({
          data,
          latest: canonical.length > 0 ? canonical[canonical.length - 1] : undefined,
          prTest: data.tests.find((test) => test.pr === true),
          observedSegments,
          px,
          py,
          project,
          right,
          bounds: [top + 8, bottom - 8],
        });

        const lines: (readonly (readonly [number, number])[])[] = [
          [
            [px(data.baseline.date), py(data.baseline.heightIn)],
            [right, py(data.goalIn)],
          ],
        ];
        for (const segment of observedSegments) lines.push(segment.map(project));
        if (data.trend !== undefined && data.trend.length >= 2) lines.push(data.trend.map(project));
        if (data.projection !== undefined) lines.push(data.projection.line.map(project));

        for (const label of labels) {
          const rect = rectOf(label);
          for (const line of lines) {
            expect(`${label.key} ${polylineHitsRect(line, rect)}`).toBe(`${label.key} false`);
          }
          // And inside the chart's own box. A label that leaves the SVG lands
          // in the neighbouring column: "36.0 goa" under the test ledger.
          expect(`${label.key} left ${rect.left >= 0}`).toBe(`${label.key} left true`);
          expect(`${label.key} right ${rect.right <= width}`).toBe(`${label.key} right true`);
        }
      });
    }
  }
});
