import { describe, expect, it } from 'vitest';
import { PROJECTED_CAPTION, futureTargetsLine, nextWeekIsFinal, notBuiltLine } from './detail';

/**
 * The future day: what week N+1 counts as, the targets line, and the caption
 * above a projected day. Split from detail.test.ts to keep it under the cap.
 */

describe('nextWeekIsFinal', () => {
  it('is false for a projected next week, which the next revision rewrites', () => {
    const weeks = [
      { w: 7, generatedBy: 'setup' },
      { w: 8, generatedBy: 'projection' },
    ];
    expect(nextWeekIsFinal(weeks, 7)).toBe(false);
  });

  it('is false for a revised next week, which is still a week nobody has run', () => {
    expect(nextWeekIsFinal([{ w: 8, generatedBy: 'revision' }], 7)).toBe(false);
  });

  it('is true only when the next week was written from what happened', () => {
    expect(nextWeekIsFinal([{ w: 8, generatedBy: 'engine' }], 7)).toBe(true);
    expect(nextWeekIsFinal([{ w: 2, generatedBy: 'setup' }], 1)).toBe(true);
  });

  it('is false when the next week has no row, or no source at all', () => {
    expect(nextWeekIsFinal([{ w: 7, generatedBy: 'setup' }], 7)).toBe(false);
    expect(nextWeekIsFinal([{ w: 8, generatedBy: null }], 7)).toBe(false);
    expect(nextWeekIsFinal([], 7)).toBe(false);
  });

  it('keeps the Finish button on an unfinished session under whole-plan build', () => {
    // Every week carries a generatedAt from build day, so the old
    // "a row exists" test would have hidden it on every session but week 12's.
    const weeks = Array.from({ length: 12 }, (_, index) => ({
      w: index + 1,
      generatedBy: index === 0 ? 'setup' : 'projection',
    }));
    expect(weeks.map((week) => nextWeekIsFinal(weeks, week.w))).not.toContain(true);
  });
});

describe('futureTargetsLine', () => {
  it('reads the day above its own sets', () => {
    expect(
      futureTargetsLine({
        dayType: 'Lower Strength',
        mainLiftName: 'back squat',
        workingSets: 3,
      }),
    ).toBe('Lower Strength · main lift: back squat · 3 working sets');
  });

  it('promises nothing about when loads appear, because they are on the screen', () => {
    const line = futureTargetsLine({
      dayType: 'Lower Strength',
      mainLiftName: 'back squat',
      workingSets: 3,
    });
    expect(line).not.toContain('loads');
    expect(line).not.toContain('built');
  });
});

describe('the caption above a projected day', () => {
  it('says the sets are a projection and that logging rewrites them', () => {
    expect(PROJECTED_CAPTION).toBe('Projected from your plan. It is rewritten as you log.');
  });

  it('names the week that has no sessions to show', () => {
    expect(notBuiltLine(7)).toBe('Week 7 has not been built yet. It appears here when it is.');
  });
});

describe('futureTargetsLine on a hard finger day', () => {
  it('names hard finger work, because the 48 h gap is measured from it', () => {
    expect(
      futureTargetsLine({
        dayType: 'Upper power',
        mainLiftName: 'Weighted pull-up',
        workingSets: 3,
        hardFinger: true,
      }),
    ).toBe('Upper power · main lift: Weighted pull-up · 3 working sets · hard finger work');
  });

  it('says nothing about fingers on a day that carries none', () => {
    expect(
      futureTargetsLine({
        dayType: 'Lower Strength',
        mainLiftName: 'Box squat',
        workingSets: 3,
      }),
    ).not.toContain('finger');
  });
});

