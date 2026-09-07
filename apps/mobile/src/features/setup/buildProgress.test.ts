import { describe, expect, it } from 'vitest';
import type { PlanSkeleton } from '@vert/engine';
import type { BuildPlan } from './buildProgram';
import {
  RULE_BOOK_PROGRESS,
  buildStepCount,
  progressFraction,
  progressFromWrite,
  writeStepCount,
  writeStepLine,
} from './buildProgress';

/** Only the two lengths the counts read. */
function skeletonWith(weeks: number, sessions: number): PlanSkeleton {
  return {
    weeks: Array.from({ length: weeks }, () => ({
      sessions: Array.from({ length: sessions }, () => ({})),
    })),
  } as unknown as PlanSkeleton;
}

function planWith(weeks: number, sessions: number): BuildPlan {
  return {
    skeleton: skeletonWith(weeks, sessions),
    weeks: Array.from({ length: weeks }, () => ({
      sessions: Array.from({ length: sessions }, () => ({})),
    })),
  } as unknown as BuildPlan;
}

describe('build progress', () => {
  it('counts a materialize step a week, the program row, every week and every session', () => {
    // 12 materialize + 1 program + 12 week rows + 48 sessions.
    expect(buildStepCount(skeletonWith(12, 4))).toBe(73);
    expect(buildStepCount(skeletonWith(8, 3))).toBe(41);
  });

  it('counts the write half as the program row, every week, and every session', () => {
    expect(writeStepCount(planWith(12, 4))).toBe(61);
    expect(writeStepCount(planWith(8, 3))).toBe(33);
  });

  it('leaves exactly one materialize step a week between the two counts', () => {
    expect(buildStepCount(skeletonWith(12, 4)) - writeStepCount(planWith(12, 4))).toBe(12);
  });

  it('starts on an empty track with the rule book named', () => {
    expect(RULE_BOOK_PROGRESS.total).toBeNull();
    expect(progressFraction(RULE_BOOK_PROGRESS)).toBe(0);
    expect(RULE_BOOK_PROGRESS.line).toBe('Running the rule book');
  });

  it('says which step just landed, in one format per kind', () => {
    expect(writeStepLine({ kind: 'materialize', w: 7, of: 12 })).toBe('Building week 7 of 12');
    expect(writeStepLine({ kind: 'program' })).toBe('Saving the program');
    expect(writeStepLine({ kind: 'week', w: 4, of: 12 })).toBe('Writing week 4 of 12');
    expect(writeStepLine({ kind: 'session', w: 7, n: 3, of: 4 })).toBe(
      'Writing week 7, session 3 of 4',
    );
    expect(writeStepLine({ kind: 'session', w: 1, n: 2, of: 4 })).toBe(
      'Writing week 1, session 2 of 4',
    );
  });

  it('turns a step into the fraction the bar draws', () => {
    const half = progressFromWrite({ done: 6, total: 12, step: { kind: 'week', w: 5, of: 12 } });
    expect(half.line).toBe('Writing week 5 of 12');
    expect(progressFraction(half)).toBe(0.5);
    expect(progressFraction({ done: 73, total: 73, line: '' })).toBe(1);
    expect(progressFraction({ done: 80, total: 73, line: '' })).toBe(1);
  });

  it('keeps one running count across materializing and writing', () => {
    const total = buildStepCount(skeletonWith(12, 4));
    const lastMaterialize = progressFromWrite({
      done: 12,
      total,
      step: { kind: 'materialize', w: 12, of: 12 },
    });
    const firstWrite = progressFromWrite({ done: 13, total, step: { kind: 'program' } });
    expect(progressFraction(firstWrite)).toBeGreaterThan(progressFraction(lastMaterialize));
    expect(progressFraction({ done: total, total, line: '' })).toBe(1);
  });
});
