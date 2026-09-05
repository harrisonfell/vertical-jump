import { describe, expect, it } from 'vitest';
import { inToMm } from '@vert/engine/units';
import { RULESET_V1 } from '@vert/engine';
import { emptyDraft, modeFor, throwAttemptCount } from './sheetModel';
import { readSingleLeg, singleLegAttempts, singleLegIssues } from './singleLeg';
import { readThrow, storedUnit, throwAttempts, throwStep, throwUnit } from './throwTest';
import { MODE_OPTIONS, kindFor, selectionFor, type Attempt, type TestDraft } from './validate';

const CONFIG = RULESET_V1.constants.climbing.readiness;

function attempt(heightIn: number | null, flagged = false): Attempt {
  return { heightIn, gctMs: null, flagged };
}

function pair(left: readonly (number | null)[], right: readonly (number | null)[]): TestDraft {
  return {
    kind: 'single_leg',
    instrument: 'ovr_jump_regular',
    attempts: left.map((value) => attempt(value)),
    rightAttempts: right.map((value) => attempt(value)),
    throwAttempts: [],
    bodyweightLb: 150,
    boxHeightIn: null,
    notes: '',
    canonical: false,
  };
}

describe('the mode selector', () => {
  it('offers the four instruments plus the two other streams', () => {
    expect(MODE_OPTIONS.map((option) => option.label)).toEqual([
      'OVR Jump Regular',
      'OVR Jump RSI',
      'Vertec reach minus touch',
      'Manual',
      'Single leg (left and right)',
      'Readiness throw',
    ]);
  });

  it('maps a selection to its stream and back', () => {
    expect(kindFor('single_leg')).toBe('single_leg');
    expect(kindFor('readiness_throw')).toBe('readiness_throw');
    expect(kindFor('ovr_jump_rsi')).toBe('jump');
    expect(selectionFor('jump', 'ovr_jump_rsi')).toBe('ovr_jump_rsi');
    expect(selectionFor('single_leg', 'ovr_jump_rsi')).toBe('single_leg');
  });

  it('opens a single-leg draft with three attempts a side and no canonical flag', () => {
    const draft = emptyDraft({
      instrument: 'ovr_jump_regular',
      kind: 'single_leg',
      bodyweightLb: 150,
      throwAttempts: 3,
    });
    expect(draft.attempts).toHaveLength(3);
    expect(draft.rightAttempts).toHaveLength(3);
    expect(draft.canonical).toBe(false);
    expect(modeFor('ovr_jump_regular', 'single_leg')).toBe('single_leg');
  });

  it('opens a readiness draft with as many attempts as the config asks for', () => {
    const draft = emptyDraft({
      instrument: 'ovr_jump_regular',
      kind: 'readiness_throw',
      bodyweightLb: 150,
      throwAttempts: throwAttemptCount(CONFIG),
    });
    expect(draft.throwAttempts).toEqual([null, null, null]);
    expect(draft.canonical).toBe(false);
  });
});

describe('single-leg validation', () => {
  it('needs both legs before it saves, and says which one is missing', () => {
    const nothing = readSingleLeg(pair([null, null, null], [null, null, null]));
    expect(nothing.canSave).toBe(false);
    expect(nothing.line).toBe('Enter both legs. A gap needs a left and a right.');

    const halfLogged = readSingleLeg(pair([17.9, null, null], [null, null, null]));
    expect(halfLogged.canSave).toBe(false);
    expect(halfLogged.line).toBe('Enter the right leg too. A gap needs both.');
    expect(halfLogged.pct).toBeNull();
  });

  it('computes the gap live from the best unflagged attempt on each side', () => {
    const reading = readSingleLeg(pair([17.2, 17.9, 17.5], [19.0, 19.2, 18.8]));
    expect(reading.canSave).toBe(true);
    expect(reading.leftBestIn).toBe(17.9);
    expect(reading.rightBestIn).toBe(19.2);
    expect(reading.pct).toBeCloseTo(-6.77, 2);
    expect(reading.band).toBe('watch');
    expect(reading.weakerSide).toBe('left');
    expect(reading.line).toBe('Left 17.9 in, right 19.2 in. 7% down on the left. Worth watching.');
  });

  it('keeps a flagged attempt out of the side it was taken on', () => {
    const draft = pair([17.2, 19.9, null], [19.0, null, null]);
    const flagged: TestDraft = {
      ...draft,
      attempts: [attempt(17.2), attempt(19.9, true), attempt(null)],
    };
    const reading = readSingleLeg(flagged);
    expect(reading.leftBestIn).toBe(17.2);
    expect(reading.weakerSide).toBe('left');
  });

  it('names the side in a blocking issue so the row can find its own error', () => {
    const reading = readSingleLeg(pair([4.8], [19.0]));
    expect(reading.canSave).toBe(false);
    expect(reading.issues[0]?.message).toBe(
      'Left attempt 1 reads 4.8 in. The device does not record under 6.0 in. Check the number, or flag the attempt.',
    );
    const issues = singleLegIssues(pair([17.2], [61]));
    expect(issues.left).toHaveLength(0);
    expect(issues.right[0]?.message).toBe(
      'Right attempt 1 reads 61.0 in, over the 60.0 in ceiling. Check the number.',
    );
  });

  it('writes left then right, each rep carrying its side, numbers closed up', () => {
    const rows = singleLegAttempts(pair([17.2, null, 17.9], [19.0, 19.2, null]));
    expect(rows.map((row) => row.side)).toEqual(['left', 'left', 'right', 'right']);
    expect(rows.map((row) => row.attemptIndex)).toEqual([1, 2, 3, 4]);
    expect(rows[0]?.heightMm).toBe(inToMm(17.2));
  });

  it('reads level legs as no side, so the ordering never turns on noise', () => {
    const reading = readSingleLeg(pair([19.0], [19.4]));
    expect(reading.band).toBe('balanced');
    expect(reading.weakerSide).toBeNull();
    expect(reading.line).toBe('Left 19.0 in, right 19.4 in. 2% apart, inside the band.');
  });
});

describe('the readiness throw', () => {
  it('takes the best attempt as the day number and says how many counted', () => {
    const reading = readThrow([7.0, 7.15, 6.9], CONFIG);
    expect(reading.canSave).toBe(true);
    expect(reading.best).toBe(7.15);
    expect(reading.summary).toBe('Best 7.2 m · 3 attempts');
  });

  it('treats an untyped row as no attempt rather than as a zero', () => {
    const reading = readThrow([null, 7.0, null], CONFIG);
    expect(reading.counted).toBe(1);
    expect(reading.summary).toBe('Best 7.0 m · 1 attempt');
    expect(throwAttempts([null, 7.0, null])).toEqual([7.0]);
  });

  it('blocks a reading outside the throw bounds and names the range', () => {
    const reading = readThrow([0.4], CONFIG);
    expect(reading.canSave).toBe(false);
    expect(reading.issues[0]?.message).toBe(
      'Attempt 1 reads 0.4 m. A throw reads between 1.0 m and 20.0 m. Check the number.',
    );
  });

  it('blocks a draft with nothing in it', () => {
    const reading = readThrow([null, null, null], CONFIG);
    expect(reading.canSave).toBe(false);
    expect(reading.issues[0]?.message).toBe('Enter at least one throw.');
    expect(reading.summary).toBe('No throw counted yet.');
  });

  it('moves in tenths of a metre and stores the metric unit', () => {
    expect(throwStep('distance_m')).toBe(0.1);
    expect(throwUnit('distance_m')).toBe('m');
    expect(storedUnit('distance_m')).toBe('m');
    expect(storedUnit('rsi')).toBe('RSI');
  });

  it('follows a swapped config, because the test is configuration not a constant', () => {
    const cmj = { ...CONFIG, kind: 'cmj' as const, metric: 'height_in' as const };
    const reading = readThrow([29.4], cmj);
    expect(reading.summary).toBe('Best 29.4 in · 1 attempt');
    expect(readThrow([null], cmj).issues[0]?.message).toBe('Enter at least one jump.');
  });
});
