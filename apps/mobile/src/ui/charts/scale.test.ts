import { describe, expect, it } from 'vitest';
import { avoidGeometry, labelRect, polylineHitsRect, type LabelBox } from './labelGeometry';
import {
  addDays,
  bandPath,
  clusterByX,
  daysBetween,
  fixedHeightDomain,
  formatDayLong,
  formatDayShort,
  median,
  nearestDay,
  nudgeLabels,
  parseDay,
  placeLabels,
  polylinePath,
  recoveryBand,
  rollingMedian,
  segmentByGap,
  toDay,
  wholeInchTicks,
} from './scale';

describe('day arithmetic', () => {
  it('parses a day without letting a timezone move it', () => {
    expect(parseDay('1970-01-01')).toBe(0);
    expect(parseDay('2026-09-08')).toBe(parseDay('2026-09-07') + 1);
  });

  it('round-trips through toDay', () => {
    for (const day of ['2026-01-01', '2026-02-28', '2026-09-08', '2026-11-29', '2027-12-31']) {
      expect(toDay(parseDay(day))).toBe(day);
    }
  });

  it('measures and adds whole days', () => {
    expect(daysBetween('2026-09-08', '2026-11-29')).toBe(82);
    expect(daysBetween('2026-11-29', '2026-09-08')).toBe(-82);
    expect(addDays('2026-09-08', 82)).toBe('2026-11-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formats a day for the axis and for the tooltip', () => {
    expect(formatDayShort('2026-09-13')).toBe('13 Sep');
    expect(formatDayLong('2026-09-13')).toBe('Sun 13 Sep');
    expect(formatDayLong('2026-09-12')).toBe('Sat 12 Sep');
  });
});

describe('fixedHeightDomain', () => {
  it('spans baseline minus 2 to goal plus 2 in whole inches', () => {
    expect(fixedHeightDomain({ baselineIn: 29.4, goalIn: 36, testsIn: [] })).toEqual([27, 38]);
  });

  it('opens for a test below the baseline or above the goal', () => {
    expect(
      fixedHeightDomain({ baselineIn: 29.4, goalIn: 36, testsIn: [28.1, 32.5, 37.2] }),
    ).toEqual([26, 40]);
  });

  it('does not move when a test lands inside the frame', () => {
    const empty = fixedHeightDomain({ baselineIn: 29.4, goalIn: 36, testsIn: [] });
    const later = fixedHeightDomain({ baselineIn: 29.4, goalIn: 36, testsIn: [30.1, 32.5] });
    expect(later).toEqual(empty);
  });

  it('always returns whole inches', () => {
    const [lo, hi] = fixedHeightDomain({ baselineIn: 29.4, goalIn: 36.5, testsIn: [32.75] });
    expect(Number.isInteger(lo)).toBe(true);
    expect(Number.isInteger(hi)).toBe(true);
  });
});

describe('wholeInchTicks', () => {
  it('returns whole inches only', () => {
    for (const tick of wholeInchTicks([27, 38])) {
      expect(Number.isInteger(tick)).toBe(true);
    }
  });

  it('keeps the count at or under the cap by widening the step', () => {
    expect(wholeInchTicks([27, 38], 6).length).toBeLessThanOrEqual(6);
    expect(wholeInchTicks([0, 100], 6).length).toBeLessThanOrEqual(6);
    expect(wholeInchTicks([30, 34], 6)).toEqual([30, 31, 32, 33, 34]);
  });

  it('steps by 2 rather than showing twelve ticks', () => {
    expect(wholeInchTicks([27, 38], 6)).toEqual([28, 30, 32, 34, 36, 38]);
  });

  it('stays inside the domain', () => {
    const ticks = wholeInchTicks([27.5, 38.5], 6);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(27.5);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(38.5);
  });
});

describe('segmentByGap', () => {
  const day = (d: { readonly date: string }) => d.date;

  it('keeps one run when every gap is inside the limit', () => {
    const points = [{ date: '2026-09-13' }, { date: '2026-09-27' }, { date: '2026-10-11' }];
    expect(segmentByGap(points, day)).toHaveLength(1);
  });

  it('breaks a gap longer than 21 days', () => {
    const points = [{ date: '2026-09-13' }, { date: '2026-10-20' }, { date: '2026-10-27' }];
    const segments = segmentByGap(points, day);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([{ date: '2026-09-13' }]);
    expect(segments[1]).toHaveLength(2);
  });

  it('treats exactly 21 days as continuous and 22 as a break', () => {
    expect(segmentByGap([{ date: '2026-09-01' }, { date: '2026-09-22' }], day)).toHaveLength(1);
    expect(segmentByGap([{ date: '2026-09-01' }, { date: '2026-09-23' }], day)).toHaveLength(2);
  });

  it('sorts out-of-order input before segmenting', () => {
    const segments = segmentByGap([{ date: '2026-10-27' }, { date: '2026-09-13' }], day);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([{ date: '2026-09-13' }]);
  });

  it('returns nothing for an empty series', () => {
    expect(segmentByGap([], day)).toEqual([]);
  });
});

describe('nudgeLabels', () => {
  it('leaves labels alone when they already clear the gap', () => {
    const out = nudgeLabels(
      [
        { key: 'goal', y: 10 },
        { key: 'latest', y: 60 },
      ],
      16,
      [0, 200],
    );
    expect(out.get('goal')).toBe(10);
    expect(out.get('latest')).toBe(60);
  });

  it('pushes colliding labels apart by exactly the minimum gap', () => {
    const out = nudgeLabels(
      [
        { key: 'a', y: 100 },
        { key: 'b', y: 104 },
        { key: 'c', y: 106 },
      ],
      16,
      [0, 300],
    );
    const ys = ['a', 'b', 'c'].map((k) => out.get(k) ?? 0);
    for (let i = 1; i < ys.length; i += 1) {
      expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(16);
    }
    expect(ys[0]).toBe(100);
  });

  it('keeps the nudged stack inside the plot bounds', () => {
    const out = nudgeLabels(
      [
        { key: 'a', y: 190 },
        { key: 'b', y: 194 },
        { key: 'c', y: 198 },
      ],
      16,
      [0, 200],
    );
    const ys = ['a', 'b', 'c'].map((k) => out.get(k) ?? 0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < ys.length; i += 1) {
      expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(16);
    }
  });

  it('preserves the order of the marks it labels', () => {
    const out = nudgeLabels(
      [
        { key: 'low', y: 150 },
        { key: 'high', y: 148 },
      ],
      20,
      [0, 200],
    );
    expect(out.get('high') ?? 0).toBeLessThan(out.get('low') ?? 0);
  });

  it('is deterministic when two labels want the same y', () => {
    const slots = [
      { key: 'b', y: 50 },
      { key: 'a', y: 50 },
    ];
    const first = nudgeLabels(slots, 16, [0, 200]);
    const second = nudgeLabels(slots, 16, [0, 200]);
    expect(first.get('a')).toBe(second.get('a'));
    expect(first.get('a')).toBe(50);
    expect(first.get('b')).toBe(66);
  });

  it('runs a stack taller than the plot from the top instead of clipping', () => {
    const slots = [
      { key: 'a', y: 5 },
      { key: 'b', y: 6 },
      { key: 'c', y: 7 },
    ];
    const out = nudgeLabels(slots, 20, [0, 30]);
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(20);
    expect(out.get('c')).toBe(40);
  });
});

describe('placeLabels', () => {
  const options = { minGap: 16, bounds: [0, 200] as const, xThreshold: 80 };

  it('leaves a far-apart label on its own mark', () => {
    const out = placeLabels(
      [
        { key: 'baseline', x: 10, y: 150 },
        { key: 'goal', x: 300, y: 152 },
      ],
      options,
    );
    expect(out.get('baseline')).toBe(150);
    expect(out.get('goal')).toBe(152);
  });

  it('nudges labels that share a region of the x axis', () => {
    const out = placeLabels(
      [
        { key: 'latest', x: 280, y: 100 },
        { key: 'pr', x: 300, y: 104 },
      ],
      options,
    );
    expect((out.get('pr') ?? 0) - (out.get('latest') ?? 0)).toBeGreaterThanOrEqual(16);
  });

  it('returns a y for every label it was given', () => {
    const keys = ['baseline', 'latest', 'pr', 'goal'];
    const out = placeLabels(
      [
        { key: 'baseline', x: 10, y: 160 },
        { key: 'latest', x: 260, y: 90 },
        { key: 'pr', x: 270, y: 92 },
        { key: 'goal', x: 320, y: 40 },
      ],
      options,
    );
    for (const key of keys) expect(out.has(key)).toBe(true);
  });
});

describe('clusterByX', () => {
  it('splits on a gap wider than the threshold', () => {
    const clusters = clusterByX(
      [
        { key: 'a', x: 0, y: 0 },
        { key: 'b', x: 40, y: 0 },
        { key: 'c', x: 400, y: 0 },
      ],
      80,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toHaveLength(2);
  });

  it('returns nothing for no labels', () => {
    expect(clusterByX([], 80)).toEqual([]);
  });
});

describe('path builders', () => {
  it('writes a polyline that starts with a move', () => {
    expect(
      polylinePath([
        [0, 0],
        [10, 5],
      ]),
    ).toBe('M0 0 L10 5');
  });

  it('closes a band by walking the lower edge backwards', () => {
    const path = bandPath(
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 10],
        [10, 10],
      ],
    );
    expect(path).toBe('M0 0 L10 0 L10 10 L0 10 Z');
  });

  it('returns nothing for an empty band', () => {
    expect(bandPath([], [])).toBe('');
  });
});

describe('nearestDay', () => {
  const days = ['2026-09-13', '2026-09-27', '2026-10-11'];
  const scale = (day: string) => daysBetween('2026-09-13', day) * 2;

  it('snaps to the closest day, not the closest pixel of a line', () => {
    expect(nearestDay(0, scale, days)).toBe('2026-09-13');
    expect(nearestDay(27, scale, days)).toBe('2026-09-27');
    expect(nearestDay(1000, scale, days)).toBe('2026-10-11');
  });

  it('returns null with nothing to snap to', () => {
    expect(nearestDay(10, scale, [])).toBeNull();
  });
});

describe('recovery helpers', () => {
  it('maps a score to Whoop bands', () => {
    expect(recoveryBand(12)).toBe('low');
    expect(recoveryBand(33)).toBe('low');
    expect(recoveryBand(34)).toBe('moderate');
    expect(recoveryBand(66)).toBe('moderate');
    expect(recoveryBand(67)).toBe('high');
  });

  it('keeps a pending day a hole in the rolling median', () => {
    const out = rollingMedian([50, null, 60, 70, 80], 3);
    expect(out[1]).toBeNull();
    expect(out[0]).toBe(50);
    expect(out[2]).toBe(65);
  });

  it('ignores pending days when taking the median', () => {
    expect(median([50, null, 70])).toBe(60);
    expect(median([null, null])).toBeNull();
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('avoidGeometry', () => {
  const bounds = [8, 192] as const;
  const latest: LabelBox = {
    key: 'latest',
    x: 200,
    y: 100,
    width: 86,
    side: 'left',
    own: [208, 113],
  };
  /** A trend segment running straight through the label's own box. */
  const trend: readonly (readonly [number, number])[] = [
    [120, 100],
    [208, 100],
  ];

  it('leaves a label alone when nothing is under it', () => {
    const out = avoidGeometry([latest], { lines: [], marks: [] }, { bounds });
    expect(out.get('latest')).toBe(100);
  });

  it('lifts a label off a line that runs straight through it', () => {
    const out = avoidGeometry([latest], { lines: [trend], marks: [] }, { bounds, step: 6 });
    const y = out.get('latest') ?? 0;
    expect(y).toBe(88);
    expect(polylineHitsRect(trend, labelRect(latest, y))).toBe(false);
  });

  it('moves up before it moves down', () => {
    const out = avoidGeometry([latest], { lines: [trend], marks: [] }, { bounds, step: 6 });
    expect(out.get('latest') ?? 0).toBeLessThan(100);
  });

  it('sits happily on the mark it names', () => {
    const under: LabelBox = {
      key: 'baseline',
      x: 120,
      y: 100,
      width: 78,
      side: 'right',
      own: [150, 100],
    };
    const out = avoidGeometry([under], { lines: [], marks: [[150, 100]] }, { bounds, step: 6 });
    expect(out.get('baseline')).toBe(100);
  });

  it('clears a mark it does not name', () => {
    const out = avoidGeometry(
      [latest],
      {
        lines: [],
        marks: [
          [208, 113],
          [150, 100],
        ],
      },
      { bounds, step: 6 },
    );
    const y = out.get('latest') ?? 0;
    expect(y).not.toBe(100);
    expect(Math.abs(y - 100)).toBeLessThanOrEqual(30);
  });

  it('keeps two labels that share an x apart', () => {
    const pr: LabelBox = { key: 'pr', x: 200, y: 104, width: 62, side: 'left', own: [208, 117] };
    const out = avoidGeometry([latest, pr], { lines: [], marks: [] }, { bounds, step: 6 });
    const first = labelRect(latest, out.get('latest') ?? 0);
    const second = labelRect(pr, out.get('pr') ?? 0);
    expect(first.bottom <= second.top || second.bottom <= first.top).toBe(true);
  });

  it('keeps a label it cannot place rather than sending it travelling', () => {
    const wall: readonly (readonly [number, number])[] = [
      [120, 0],
      [120, 300],
    ];
    const out = avoidGeometry(
      [latest],
      { lines: [wall], marks: [] },
      { bounds, step: 6, maxSteps: 3 },
    );
    expect(out.get('latest')).toBe(100);
  });

  it('stays inside the bounds it was given', () => {
    const roof: readonly (readonly [number, number])[] = [
      [100, 0],
      [300, 20],
    ];
    const high: LabelBox = { ...latest, y: 10 };
    const out = avoidGeometry([high], { lines: [roof], marks: [] }, { bounds, step: 6 });
    const y = out.get('latest') ?? 0;
    expect(y).toBeGreaterThanOrEqual(bounds[0]);
    expect(y).toBeLessThanOrEqual(bounds[1]);
  });
});
