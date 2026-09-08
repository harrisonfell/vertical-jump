import { describe, expect, it } from 'vitest';
import { nodeStates } from './spineModel';
import { weekBarModel } from './weekBar';
import type { SessionStatus } from '@/data/types';

/**
 * The two models behind the session's spine and the week bar above it: which
 * node is the current one, and how many segments the week gets.
 */

describe('nodeStates', () => {
  it('marks exactly one node current: the first unfinished one', () => {
    const states = nodeStates([
      { done: true, sequenced: true },
      { done: false, sequenced: true },
      { done: false, sequenced: true },
    ]);
    expect(states).toEqual(['done', 'current', 'upcoming']);
    expect(states.filter((state) => state === 'current')).toHaveLength(1);
  });

  it('leaves nothing current once every node is finished', () => {
    expect(
      nodeStates([
        { done: true, sequenced: true },
        { done: true, sequenced: true },
      ]),
    ).toEqual(['done', 'done']);
  });

  it('never lets an unsequenced node hold the accent or claim to be done', () => {
    // The jump test cannot report itself finished, so it must not be the node
    // the accent parks on for the rest of the session.
    const states = nodeStates([
      { done: true, sequenced: true },
      { done: false, sequenced: false },
      { done: false, sequenced: true },
    ]);
    expect(states).toEqual(['done', 'upcoming', 'current']);
  });

  it('has no current node in an empty session', () => {
    expect(nodeStates([])).toEqual([]);
  });
});

function day(scheduledDate: string, status: SessionStatus) {
  return { scheduledDate, status };
}

describe('weekBarModel', () => {
  it('draws one segment per scheduled training day, in date order', () => {
    const model = weekBarModel(
      [
        day('2026-09-09', 'planned'),
        day('2026-09-07', 'done'),
        day('2026-09-11', 'planned'),
        day('2026-09-08', 'done'),
      ],
      4,
    );
    expect(model.segments.map((segment) => segment.key)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-11',
    ]);
    expect(model.segments.map((segment) => segment.filled)).toEqual([true, true, false, false]);
    expect(model.line).toBe('Week 4: 2 of 4 sessions done');
  });

  it('fills only a finished day: part-logged and missed are not done', () => {
    const model = weekBarModel(
      [
        day('2026-09-07', 'done'),
        day('2026-09-08', 'not_finished'),
        day('2026-09-09', 'missed'),
      ],
      1,
    );
    expect(model.segments.map((segment) => segment.filled)).toEqual([true, false, false]);
    expect(model.line).toBe('Week 1: 1 of 3 sessions done');
  });

  it('says nothing at all when the week has no sessions on it', () => {
    const model = weekBarModel([], 2);
    expect(model.segments).toEqual([]);
    expect(model.line).toBeNull();
  });

  it('drops the week number when there is not one yet', () => {
    expect(weekBarModel([day('2026-09-07', 'done')], null).line).toBe('1 of 1 sessions done');
  });
});
