import { describe, expect, it } from 'vitest';
import { buildClimberFixture } from '@vert/engine/fixtures';
import type { SessionPlan } from '@vert/engine';
import { hasHardFingerWork, rowNotes, rowNotesFor } from './planNotes';

/**
 * The per-row house notes as the generator actually wrote them into week 7 of
 * the climbing fixture: Monday lower strength, Tuesday the upper power day.
 */
const climber = buildClimberFixture();

function session(date: string): SessionPlan {
  const week = climber.weeks[climber.weeks.length - 1];
  const found = week?.sessions.find((entry) => entry.date === date);
  if (found === undefined) throw new Error(`no session on ${date}`);
  return found;
}

const monday = session('2026-10-19');
const tuesday = session('2026-10-20');

describe('rowNotes', () => {
  it('carries the weaker side onto a unilateral row', () => {
    const notes = rowNotes(monday);
    expect(rowNotesFor(notes, 'secondary', 'step_up').sideNote).toBe('Weaker side first: left');
  });

  it('carries the grip onto a pulling row', () => {
    const notes = rowNotes(tuesday);
    expect(rowNotesFor(notes, 'main_lift', 'weighted_pull_up').fingerNote).toBe('Open hand only.');
  });

  it('says nothing about a row that carries neither', () => {
    const notes = rowNotes(monday);
    expect(rowNotesFor(notes, 'main_lift', 'box_squat')).toEqual({
      sideNote: null,
      fingerNote: null,
    });
  });

  it('finds a row whose stored block no longer matches the snapshot', () => {
    const notes = rowNotes(tuesday);
    expect(rowNotesFor(notes, 'secondary', 'weighted_pull_up').fingerNote).toBe('Open hand only.');
  });

  it('keeps two rows of the same exercise apart by their block', () => {
    const first = monday.blocks[0]?.exercises[0];
    if (first === undefined) throw new Error('the fixture built no rows');
    const plan: SessionPlan = {
      ...monday,
      blocks: [
        {
          name: 'warm_up',
          grouped: true,
          exercises: [{ ...first, exerciseId: 'pogo_hops', sideNote: 'Weaker side first: left' }],
        },
        {
          name: 'primer',
          grouped: false,
          exercises: [
            { ...first, exerciseId: 'pogo_hops', sideNote: undefined, fingerNote: 'Open hand only.' },
          ],
        },
      ],
    };
    const notes = rowNotes(plan);
    expect(rowNotesFor(notes, 'warm_up', 'pogo_hops').sideNote).toBe('Weaker side first: left');
    expect(rowNotesFor(notes, 'warm_up', 'pogo_hops').fingerNote).toBeNull();
    expect(rowNotesFor(notes, 'primer', 'pogo_hops').fingerNote).toBe('Open hand only.');
  });

  it('is empty for a session with no snapshot', () => {
    expect(rowNotes(null).size).toBe(0);
    expect(rowNotesFor(rowNotes(null), 'main_lift', 'box_squat').sideNote).toBeNull();
  });
});

describe('hasHardFingerWork', () => {
  it('is true on the day the pulleys are loaded hard', () => {
    expect(hasHardFingerWork(tuesday)).toBe(true);
  });

  it('is false on a lower day and on a session with no snapshot', () => {
    expect(hasHardFingerWork(monday)).toBe(false);
    expect(hasHardFingerWork(null)).toBe(false);
  });
});
