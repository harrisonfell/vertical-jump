import { describe, expect, it } from 'vitest';
import { loadRuleset, planSkeleton } from '@vert/engine';
import { FIXTURE_PROGRAM_START, ownerAthlete } from '@vert/engine/fixtures';
import { blockLabelForWeek, blockSegments, phaseLabel, type SegmentWeek } from './blocks';

function skeletonWeeks(): SegmentWeek[] {
  const skeleton = planSkeleton(ownerAthlete(), FIXTURE_PROGRAM_START, loadRuleset());
  return skeleton.weeks.map((week) => ({
    w: week.w,
    kind: week.kind,
    blockType: week.blockType,
  }));
}

describe('phaseLabel', () => {
  it('names a load week by its block', () => {
    expect(phaseLabel({ w: 1, kind: 'load', blockType: 'strength' })).toBe('Strength');
    expect(phaseLabel({ w: 7, kind: 'load', blockType: 'power' })).toBe('Power');
  });

  it('names a reduced week by its kind, whatever block it sits in', () => {
    expect(phaseLabel({ w: 5, kind: 'deload', blockType: 'strength' })).toBe('Deload');
    expect(phaseLabel({ w: 11, kind: 'taper', blockType: 'power' })).toBe('Taper');
    expect(phaseLabel({ w: 12, kind: 'peak', blockType: 'power' })).toBe('Peak');
  });
});

describe('blockSegments from the real skeleton', () => {
  it('reads the twelve-week layout out of brief section 09', () => {
    const segments = blockSegments(skeletonWeeks());
    expect(segments.map((segment) => segment.span)).toEqual([
      'Strength 1-4',
      'Deload 5',
      'Power 6-10',
      'Taper 11',
      'Peak 12',
    ]);
  });

  it('marks the reduced weeks so the band can draw them a tone apart', () => {
    const segments = blockSegments(skeletonWeeks());
    expect(segments.map((segment) => segment.reduced)).toEqual([false, true, false, true, true]);
  });

  it('covers every week exactly once', () => {
    const segments = blockSegments(skeletonWeeks());
    expect(segments.reduce((total, segment) => total + segment.weeks, 0)).toBe(12);
    expect(segments[0]?.weekFrom).toBe(1);
    expect(segments[segments.length - 1]?.weekTo).toBe(12);
  });

  it('never merges two runs of the same phase across a gap', () => {
    const segments = blockSegments([
      { w: 1, kind: 'load', blockType: 'strength' },
      { w: 2, kind: 'deload', blockType: 'strength' },
      { w: 3, kind: 'load', blockType: 'strength' },
    ]);
    expect(segments.map((segment) => segment.span)).toEqual([
      'Strength 1',
      'Deload 2',
      'Strength 3',
    ]);
  });

  it('sorts weeks that arrive out of order', () => {
    const segments = blockSegments([
      { w: 2, kind: 'load', blockType: 'strength' },
      { w: 1, kind: 'load', blockType: 'strength' },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.span).toBe('Strength 1-2');
  });
});

describe('blockLabelForWeek', () => {
  it('names the block the sticky header shows', () => {
    expect(blockLabelForWeek(skeletonWeeks(), 7)).toBe('Power');
    expect(blockLabelForWeek(skeletonWeeks(), 5)).toBe('Deload');
  });

  it('is null outside the program', () => {
    expect(blockLabelForWeek(skeletonWeeks(), 99)).toBeNull();
  });
});
