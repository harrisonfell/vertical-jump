/**
 * Per-side effort on unilateral work.
 *
 * The worked case is the owner's own: single-leg RDLs at 30, 35 and 40 lb, the
 * right leg never above RPE 6 and the left up at 8. It is a two-point gap on
 * matched loads, which is the left leg working harder for the same weight, and
 * it is the whole reason the two legs are logged apart.
 */
import { describe, expect, it } from 'vitest';
import {
  EFFORT_BAND_RPE,
  harderSideFrom,
  readSideEffort,
  sideEffortTail,
  weakerSideFrom,
} from '../src/analytics/index.js';
import { lastTimeLine } from '../src/materialize/block6.js';
import { selectSession } from '../src/select/assemble.js';
import { indexById, loadExercises } from '../src/exercises/index.js';
import { climberPowerContext } from './select.climbing.support.js';
import { lbToKg } from '../src/units.js';
import type { SetLog } from '../src/types/logs.js';
import type { Side } from '../src/types/core.js';
import type { SingleLegTest } from '../src/types/readiness.js';

function set(partial: Partial<SetLog> & { setNumber: number }): SetLog {
  return {
    id: `slog-${partial.setNumber}-${partial.side ?? 'both'}`,
    sessionId: 'sess',
    exerciseId: 'single_leg_rdl',
    repsDone: 8,
    loadSource: 'week1',
    completedAt: '2026-09-07T18:00:00.000Z',
    plannedDate: '2026-09-07',
    idempotencyKey: `set:${partial.setNumber}:${partial.side ?? 'both'}`,
    ...partial,
  };
}

/** The three sets as logged, with the per-side effort the athlete reported. */
function ownerRdlSession(leftRpe: readonly number[], rightRpe: readonly number[]): SetLog[] {
  const loadsLb = [30, 35, 40];
  const rows: SetLog[] = [];
  loadsLb.forEach((lb, index) => {
    const setNumber = index + 1;
    const sides: readonly Side[] = ['left', 'right'];
    for (const side of sides) {
      const rpe = side === 'left' ? leftRpe[index] : rightRpe[index];
      rows.push(set({ setNumber, side, loadKg: lbToKg(lb), ...(rpe === undefined ? null : { rpe }) }));
    }
  });
  return rows;
}

describe('reading the sides out of logged unilateral sets', () => {
  it('names the left leg from 30, 35 and 40 lb at RPE 6, 7 and 8 against 5, 6 and 6', () => {
    const reading = readSideEffort(ownerRdlSession([6, 7, 8], [5, 6, 6]));
    expect(reading).not.toBeNull();
    expect(reading?.pairs).toHaveLength(3);
    expect(reading?.leftRpe).toBeCloseTo(7);
    expect(reading?.rightRpe).toBeCloseTo(5 + 2 / 3);
    expect(reading?.harderSide).toBe('left');
    expect(reading?.line).toContain('The left leg is working harder');
  });

  it('pairs a set number only when both legs did the same load and reps', () => {
    const logs = [
      set({ setNumber: 1, side: 'left', loadKg: lbToKg(40), rpe: 8 }),
      set({ setNumber: 1, side: 'right', loadKg: lbToKg(30), rpe: 8 }),
    ];
    // The right leg lifted 10 lb less, so the two efforts are not comparable
    // and nothing is named from them.
    expect(readSideEffort(logs)).toBeNull();
  });

  it('names no side inside the band', () => {
    const reading = readSideEffort(ownerRdlSession([7, 7, 7], [7, 7, 7]));
    expect(reading?.gap).toBe(0);
    expect(reading?.harderSide).toBeNull();
    expect(reading?.line).toContain('Level');
  });

  it('needs more than the band to name a side', () => {
    const reading = readSideEffort(ownerRdlSession([7, 7, 7.5], [7, 7, 7]));
    expect(Math.abs(reading?.gap ?? 0)).toBeLessThanOrEqual(EFFORT_BAND_RPE);
    expect(reading?.harderSide).toBeNull();
  });

  it('ignores a row logged once for both sides', () => {
    const logs = [
      set({ setNumber: 1, loadKg: lbToKg(30), rpe: 6 }),
      set({ setNumber: 2, loadKg: lbToKg(35), rpe: 7 }),
    ];
    expect(readSideEffort(logs)).toBeNull();
    expect(harderSideFrom(logs)).toBeNull();
  });

  it('never pairs two legs across different exercises', () => {
    const logs = [
      set({ setNumber: 1, side: 'left', exerciseId: 'single_leg_rdl', loadKg: lbToKg(40), rpe: 8 }),
      set({
        setNumber: 1,
        side: 'right',
        exerciseId: 'bulgarian_split_squat',
        loadKg: lbToKg(40),
        rpe: 6,
      }),
    ];
    expect(readSideEffort(logs)).toBeNull();
  });

  it('never pairs two legs across different sessions', () => {
    const logs = [
      set({ setNumber: 1, side: 'left', sessionId: 'mon', loadKg: lbToKg(40), rpe: 8 }),
      set({ setNumber: 1, side: 'right', sessionId: 'thu', loadKg: lbToKg(40), rpe: 6 }),
    ];
    expect(readSideEffort(logs)).toBeNull();
  });

  it('averages the gap across every exercise logged per side', () => {
    const logs = [
      ...ownerRdlSession([8, 8, 8], [6, 6, 6]),
      set({
        setNumber: 1,
        side: 'left',
        exerciseId: 'bulgarian_split_squat',
        loadKg: lbToKg(50),
        rpe: 7,
      }),
      set({
        setNumber: 1,
        side: 'right',
        exerciseId: 'bulgarian_split_squat',
        loadKg: lbToKg(50),
        rpe: 7,
      }),
    ];
    const reading = readSideEffort(logs);
    // Three RDL pairs two points apart and one split-squat pair level: still the
    // left leg, on a gap the level pair pulls down rather than cancels.
    expect(reading?.pairs).toHaveLength(4);
    expect(reading?.gap).toBeCloseTo(1.5);
    expect(reading?.harderSide).toBe('left');
  });

  it('ignores a side logged with no effort, rather than reading it as zero', () => {
    const logs = [
      set({ setNumber: 1, side: 'left', loadKg: lbToKg(30), rpe: 8 }),
      set({ setNumber: 1, side: 'right', loadKg: lbToKg(30) }),
    ];
    expect(readSideEffort(logs)).toBeNull();
  });
});

describe('which leg goes first', () => {
  const band = 3;

  it('takes the logged side when no single-leg test exists yet', () => {
    const logged = harderSideFrom(ownerRdlSession([8, 8, 8], [6, 6, 6]));
    expect(weakerSideFrom([], null, band, logged)).toBe('left');
  });

  it('prefers the logged side over a setup answer that disagrees', () => {
    const logged = harderSideFrom(ownerRdlSession([8, 8, 8], [6, 6, 6]));
    expect(weakerSideFrom([], 'right', band, logged)).toBe('left');
  });

  it('keeps the setup answer when the logs name no side', () => {
    expect(weakerSideFrom([], 'right', band, null)).toBe('right');
  });

  it('lets a measured test outrank what the logs report', () => {
    const test: SingleLegTest = {
      date: '2026-09-10',
      instrument: 'vertec_reach_touch',
      leftIn: 24,
      rightIn: 30,
      asymmetryPct: -20,
      weakerSide: 'left',
    };
    // The test measures the left leg 20 percent down, and inches outrank an
    // effort report even when the report points the other way.
    expect(weakerSideFrom([test], null, band, 'right')).toBe('left');
  });

  it('falls back to the logs when the measured gap is inside the band', () => {
    const test: SingleLegTest = {
      date: '2026-09-10',
      instrument: 'vertec_reach_touch',
      leftIn: 30,
      rightIn: 30.3,
      asymmetryPct: -1,
      weakerSide: null,
    };
    expect(weakerSideFrom([test], null, band, 'left')).toBe('left');
  });
});

describe('the row note the athlete reads', () => {
  const byId = indexById(loadExercises().exercises);

  function sideNotes(logged: 'left' | 'right' | null): string[] {
    const context = { ...climberPowerContext(''), weakerSideLogged: logged };
    const notes: string[] = [];
    for (const block of selectSession(context).blocks) {
      for (const row of block.exercises) {
        if (byId.get(row.exerciseId)?.unilateral !== true) continue;
        if (row.sideNote !== undefined) notes.push(row.sideNote);
      }
    }
    return notes;
  }

  it('names the side the logs report, over a setup answer that disagrees', () => {
    // This athlete answered "left" in setup; the logs say the right leg is the
    // one working harder, and the logs are what the legs actually did.
    const notes = sideNotes('right');
    expect(notes.length).toBeGreaterThan(0);
    expect([...new Set(notes)]).toEqual(['Weaker side first: right']);
  });

  it('keeps the setup answer while the logs name no side', () => {
    const notes = sideNotes(null);
    expect(notes.length).toBeGreaterThan(0);
    expect([...new Set(notes)]).toEqual(['Weaker side first: left']);
  });
});

describe('the last-time line', () => {
  const logs = ownerRdlSession([6, 7, 8], [6, 6, 6]);

  it('counts three sets, not six, and names what each leg reported', () => {
    expect(lastTimeLine(logs, 'single_leg_rdl')).toBe(
      'last 8 × 30 / 8 × 35 / 8 × 40 · left RPE 7, right RPE 6',
    );
  });

  it('leaves the tail off when the two legs read the same', () => {
    const level = ownerRdlSession([7, 7, 7], [7, 7, 7]);
    expect(lastTimeLine(level, 'single_leg_rdl')).toBe('last 8 × 30 / 8 × 35 / 8 × 40');
    expect(sideEffortTail(level)).toBeUndefined();
  });

  it('reads a bilateral row exactly as it did before sides existed', () => {
    const bilateral = [
      set({ setNumber: 1, exerciseId: 'romanian_deadlift', loadKg: lbToKg(135), repsDone: 8 }),
      set({ setNumber: 2, exerciseId: 'romanian_deadlift', loadKg: lbToKg(155), repsDone: 8 }),
    ];
    expect(lastTimeLine(bilateral, 'romanian_deadlift')).toBe('last 8 × 135 / 8 × 155');
  });
});
