/**
 * Row notation the runner reads (defect ledger D-19, D-20, COPY-08).
 *
 * A change-of-direction drill is a run and a count of cuts, never a
 * bodyweight lift; the last-time line follows brief section 13; and the "no
 * working max yet" sentence is one string the engine owns.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_MAX_LINE,
  getPerSetPrescription,
  indexById,
  lastTimeLine,
  loadExercises,
  workingMaxSourceLine,
} from '../src/index.js';
import {
  displays,
  makeAthlete,
  makeContext,
  makeLog,
} from '../src/prescribe/prescribe.fixtures.test.js';
import type { Exercise } from '../src/types/exercise.js';
import type { SetLog } from '../src/types/logs.js';
import { lbToKg } from '../src/units.js';

const byId = indexById(loadExercises().exercises);
const athlete = makeAthlete('advanced');

function exercise(id: string): Exercise {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`the seed is missing ${id}`);
  return found;
}

function log(setNumber: number, repsDone: number, loadLb?: number): SetLog {
  return makeLog({
    id: `set-${setNumber}`,
    exerciseId: 'back_squat',
    setNumber,
    repsDone,
    ...(loadLb === undefined ? null : { loadKg: lbToKg(loadLb) }),
  });
}

describe('D-19: change-of-direction rows read as runs and cuts', () => {
  it('prescribes the 5-10-5 shuttle as reps with the cuts on the second line', () => {
    const rows = getPerSetPrescription(
      exercise('shuttle_5_10_5'),
      athlete,
      makeContext({ sets: 4, repsPerSet: 1 }),
    );
    expect(displays(rows)).toEqual(['1 rep', '1 rep', '1 rep', '1 rep']);
    expect(rows.map((row) => row.detailLine)).toEqual(['2 cuts', '2 cuts', '2 cuts', '2 cuts']);
    expect(rows.every((row) => row.reps === 1)).toBe(true);
    expect(rows.every((row) => !row.displayLoad.includes('BW'))).toBe(true);
  });

  it('keeps a distance drill at "15 m" and hangs its cut on the second line', () => {
    const rows = getPerSetPrescription(
      exercise('cut_and_sprint_45'),
      athlete,
      makeContext({ sets: 4, repsPerSet: 1 }),
    );
    expect(displays(rows)).toEqual(['15 m', '15 m', '15 m', '15 m']);
    expect(rows.map((row) => row.detailLine)).toEqual(['1 cut', '1 cut', '1 cut', '1 cut']);
  });

  it('leaves a plain sprint without a cut count', () => {
    const rows = getPerSetPrescription(
      exercise('sprint_30m'),
      athlete,
      makeContext({ sets: 3, repsPerSet: 1 }),
    );
    expect(displays(rows)).toEqual(['30 m', '30 m', '30 m']);
    expect(rows.every((row) => row.detailLine === undefined)).toBe(true);
  });

  it('still writes a real bodyweight row as "8 × BW"', () => {
    const rows = getPerSetPrescription(
      exercise('pogo_hops'),
      athlete,
      makeContext({ sets: 2, repsPerSet: 8 }),
    );
    expect(rows[0]?.displayLoad).toBe('8 × BW');
    expect(rows[0]?.detailLine).toBeUndefined();
  });
});

describe('D-20: the last-time line', () => {
  it('lists reps alone for a bodyweight row', () => {
    expect(lastTimeLine([log(1, 5), log(2, 5)], 'back_squat')).toBe('last 5 / 5');
  });

  it('carries the load for a loadable row, without repeating the unit', () => {
    expect(lastTimeLine([log(1, 5, 205), log(2, 4, 220)], 'back_squat')).toBe(
      'last 5 × 205 / 4 × 220',
    );
  });

  it('collapses more than four identical sets', () => {
    const logs = Array.from({ length: 6 }, (_unused, index) => log(index + 1, 8));
    expect(lastTimeLine(logs, 'back_squat')).toBe('last 8 × 6 sets');
  });

  it('keeps four identical sets spelled out', () => {
    const logs = Array.from({ length: 4 }, (_unused, index) => log(index + 1, 8));
    expect(lastTimeLine(logs, 'back_squat')).toBe('last 8 / 8 / 8 / 8');
  });

  it('has nothing to say when this exercise was not logged', () => {
    expect(lastTimeLine([log(1, 5)], 'bench_press')).toBeUndefined();
  });
});

describe('COPY-08: one "no working max" line', () => {
  it('exports the brief section 13 sentence from the engine', () => {
    expect(NO_MAX_LINE).toBe('No 1RM yet · log load and effort; prescribed after 2 sets');
  });

  it('sits beside the source line the same row shows once a max exists', () => {
    expect(typeof workingMaxSourceLine).toBe('function');
  });
});
