import { describe, expect, it } from 'vitest';
import type { Adherence } from '@vert/engine';
import { countAdherence, ladderLine } from './ladder';

function adherence(completed: number, prescribed: number): Adherence {
  return countAdherence(prescribed, completed);
}

describe('countAdherence', () => {
  it('is zero when nothing is done', () => {
    expect(adherence(0, 4).pct).toBe(0);
  });

  it('never counts more than were prescribed', () => {
    expect(adherence(6, 4).completed).toBe(4);
  });
});

describe('ladderLine', () => {
  it('names the rung one more session actually reaches at four days a week', () => {
    expect(ladderLine(7, adherence(2, 4))).toBe(
      'Week 7 · 2 of 4 done (50%) · finish 1 more for 75%',
    );
  });

  it('matches the brief verbatim at three days a week', () => {
    expect(ladderLine(7, adherence(2, 3))).toBe(
      'Week 7 · 2 of 3 done (67%) · finish 1 more for 100%',
    );
  });

  it('drops the tail once the week is complete', () => {
    expect(ladderLine(7, adherence(4, 4))).toBe('Week 7 · 4 of 4 done (100%)');
  });

  it('starts the ladder from nothing done', () => {
    expect(ladderLine(1, adherence(0, 4))).toBe(
      'Week 1 · 0 of 4 done (0%) · finish 1 more for 25%',
    );
  });

  it('says nothing about a week with no sessions', () => {
    expect(ladderLine(1, adherence(0, 0))).toBe('Week 1 · 0 of 0 done (0%)');
  });

  it('carries no reward framing and no exclamation mark', () => {
    const line = ladderLine(7, adherence(3, 4));
    expect(line).not.toMatch(/[!]/);
    expect(line.toLowerCase()).not.toMatch(/great|nice|keep it up|streak/);
  });
});
