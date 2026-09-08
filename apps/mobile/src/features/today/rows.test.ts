import { describe, expect, it } from 'vitest';
import type { SetPrescription } from '@vert/engine';
import {
  doneLabel,
  exerciseComplete,
  nextUnloggedSet,
  rowDetail,
  rowIndex,
  rowKind,
  rowPrescription,
  setsSummary,
} from './rows';

function set(patch: Partial<SetPrescription> = {}): SetPrescription {
  return {
    setNumber: 1,
    reps: 5,
    displayLoad: '5 × 205 lb',
    restS: 180,
    restRule: 'heavy strength',
    isRamp: false,
    isHeld: false,
    ...patch,
  };
}

describe('rowIndex', () => {
  it('numbers a working set', () => {
    expect(rowIndex(set({ setNumber: 3 }))).toBe('3');
  });

  it('marks a ramp set with R', () => {
    expect(rowIndex(set({ setNumber: 2, isRamp: true }))).toBe('R2');
  });
});

describe('rowKind', () => {
  it('reads a hold as timed even when it carries a load', () => {
    expect(rowKind(set({ durationS: 30, loadKg: 20 }), 'entered')).toBe('timed');
  });

  it('reads a sprint as distance', () => {
    expect(rowKind(set({ distanceM: 15, reps: 1 }), 'none')).toBe('distance');
  });

  it('opens a load stepper when there is a target RPE and no load', () => {
    expect(rowKind(set({ targetRpe: 6 }), 'rpe')).toBe('rpe');
  });

  it('stays loadable in RPE mode once a load is prescribed', () => {
    expect(rowKind(set({ loadKg: 100 }), 'rpe')).toBe('loadable');
  });

  it('falls back to bodyweight', () => {
    expect(rowKind(set({ displayLoad: '8 × BW' }), 'none')).toBe('bodyweight');
  });
});

describe('rowDetail', () => {
  it('carries the engine qualifier that makes a shuttle a run', () => {
    expect(
      rowDetail({
        set: set({ reps: 1, displayLoad: '1 rep', detailLine: '2 cuts' }),
        bothSides: false,
      }),
    ).toBe('2 cuts');
  });

  it('says nothing on a plain unlogged row', () => {
    expect(rowDetail({ set: set(), bothSides: false })).toBeUndefined();
  });

  it('carries the unilateral reminder and the ramp tag', () => {
    expect(rowDetail({ set: set({ isRamp: true }), bothSides: true })).toBe('each side · ramp');
  });

  it('shows the unreduced prescription after a soreness tier-down', () => {
    const reduced = set({ reps: 7, displayLoad: '7 × 185 lb', original: set() });
    expect(rowDetail({ set: reduced, bothSides: false })).toBe('was 5 × 205 lb');
  });

  it('reports a short set as what was actually done', () => {
    const detail = rowDetail({
      set: set(),
      bothSides: false,
      log: { setNumber: 1, repsDone: 4, durationS: null, loadKg: null, rpe: null },
    });
    expect(detail).toBe('did 4');
  });

  it('reports a hold stopped early in seconds held', () => {
    const detail = rowDetail({
      set: set({ reps: undefined, durationS: 30, displayLoad: '30 s hold' }),
      bothSides: false,
      log: { setNumber: 1, repsDone: null, durationS: 21, loadKg: null, rpe: null },
    });
    expect(detail).toBe('held 21 s hold');
  });

  it('adds the logged effort in RPE mode', () => {
    const detail = rowDetail({
      set: set({ targetRpe: 6 }),
      bothSides: false,
      log: { setNumber: 1, repsDone: 5, durationS: null, loadKg: 60, rpe: 7 },
    });
    expect(detail).toBe('done · RPE 7');
  });
});

describe('rowPrescription', () => {
  it('keeps the engine notation when a load was prescribed', () => {
    const log = { setNumber: 1, repsDone: 5, durationS: null, loadKg: 93, rpe: null };
    expect(rowPrescription(set({ loadKg: 93 }), log, 205)).toBe('5 × 205 lb');
  });

  it('shows what was lifted on an RPE row', () => {
    const log = { setNumber: 1, repsDone: 5, durationS: null, loadKg: 45, rpe: 7 };
    expect(rowPrescription(set({ targetRpe: 6 }), log, 100)).toBe('5 × 100 lb');
  });
});

describe('completion', () => {
  const sets = [set({ setNumber: 1 }), set({ setNumber: 2 }), set({ setNumber: 3 })];

  it('finds the next row with no log', () => {
    expect(nextUnloggedSet(sets, new Set([1]))?.setNumber).toBe(2);
  });

  it('returns null once every row is written', () => {
    expect(nextUnloggedSet(sets, new Set([1, 2, 3]))).toBeNull();
  });

  it('folds only when every row is written', () => {
    expect(exerciseComplete(sets, new Set([1, 2]))).toBe(false);
    expect(exerciseComplete(sets, new Set([1, 2, 3]))).toBe(true);
  });

  it('counts what is done', () => {
    expect(doneLabel(sets, new Set([1, 3]))).toBe('done 2/3');
  });
});

describe('setsSummary', () => {
  it('collapses identical rows into one prescription', () => {
    expect(setsSummary([set({ setNumber: 1 }), set({ setNumber: 2 }), set({ setNumber: 3 })])).toBe(
      '3 sets · 5 × 205 lb',
    );
  });

  it('lists unequal rows rather than averaging them into one load', () => {
    expect(
      setsSummary([
        set({ setNumber: 1, displayLoad: '5 × 205 lb' }),
        set({ setNumber: 2, displayLoad: '4 × 220 lb' }),
        set({ setNumber: 3, displayLoad: '3 × 235 lb' }),
      ]),
    ).toBe('3 sets · 5 × 205 lb / 4 × 220 lb / 3 × 235 lb');
  });

  it('keeps the notation the engine wrote for bodyweight and holds', () => {
    expect(setsSummary([set({ displayLoad: '8 × BW' })])).toBe('1 set · 8 × BW');
    expect(setsSummary([set({ displayLoad: '30 s hold' }), set({ setNumber: 2, displayLoad: '30 s hold' })])).toBe(
      '2 sets · 30 s hold',
    );
  });

  it('says nothing for an exercise with no sets', () => {
    expect(setsSummary([])).toBeUndefined();
  });
});
