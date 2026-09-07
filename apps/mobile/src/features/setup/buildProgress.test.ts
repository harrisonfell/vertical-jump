import { describe, expect, it } from 'vitest';
import type { BuildPlan } from './buildProgram';
import {
  RULE_BOOK_PROGRESS,
  progressFraction,
  progressFromWrite,
  writeStepCount,
  writeStepLine,
} from './buildProgress';

/** Only the two lengths the count reads. */
function planWith(weeks: number, sessions: number): BuildPlan {
  return {
    skeleton: { weeks: Array.from({ length: weeks }, () => ({})) },
    week1: { sessions: Array.from({ length: sessions }, () => ({})) },
  } as unknown as BuildPlan;
}

describe('build progress', () => {
  it('counts one program row, every week, and every week-1 session', () => {
    expect(writeStepCount(planWith(12, 4))).toBe(17);
    expect(writeStepCount(planWith(8, 3))).toBe(12);
  });

  it('starts on an empty track with the rule book named', () => {
    expect(RULE_BOOK_PROGRESS.total).toBeNull();
    expect(progressFraction(RULE_BOOK_PROGRESS)).toBe(0);
    expect(RULE_BOOK_PROGRESS.line).toBe('Running the rule book');
  });

  it('says which write just landed, in one format per kind', () => {
    expect(writeStepLine({ kind: 'program' })).toBe('Saving the program');
    expect(writeStepLine({ kind: 'week', w: 4, of: 12 })).toBe('Writing week 4 of 12');
    expect(writeStepLine({ kind: 'session', n: 2, of: 4 })).toBe(
      'Writing week 1, session 2 of 4',
    );
  });

  it('turns a write into the fraction the bar draws', () => {
    const half = progressFromWrite({ done: 6, total: 12, step: { kind: 'week', w: 5, of: 12 } });
    expect(half.line).toBe('Writing week 5 of 12');
    expect(progressFraction(half)).toBe(0.5);
    expect(progressFraction({ done: 17, total: 17, line: '' })).toBe(1);
    expect(progressFraction({ done: 20, total: 17, line: '' })).toBe(1);
  });
});
