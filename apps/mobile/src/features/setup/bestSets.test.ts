import { describe, expect, it } from 'vitest';
import { lbToKg, resolveWorkingMaxWithEntry, loadRuleset, kgToLb } from '@vert/engine';
import { indexById, loadExercises } from '@vert/engine';
import {
  bestSetSummary,
  bestSetValuesFrom,
  bestSetsDraftFrom,
  bestSetsFrom,
  bestSetsHaveErrors,
  emptyBestSet,
  isBlankBestSet,
  isNearMaxSet,
  validateBestSet,
  type BestSetValues,
} from './bestSets';

/**
 * The best recent set, from what the athlete types to what R73 reads.
 *
 * The number that matters is the owner's own: two at 305 lb at RPE 8.5. RPE 8
 * or higher at 6 reps or fewer waives the house 0.95 confidence factor, so
 * Epley reads it at face value, 305 x (1 + 2/30) = 325.3 lb, which is 325 on
 * the 5 lb grid. The last test here runs that through the engine rather than
 * restating the arithmetic, so a change to R73 fails here rather than quietly
 * changing what the athlete is prescribed.
 */

const TODAY = '2026-09-05';

const OWNER: BestSetValues = { reps: '2', loadLb: '305', rpe: 8.5, date: '2026-08-31' };

describe('one typed set', () => {
  it('is blank until something is typed, and blank is a valid answer', () => {
    expect(isBlankBestSet(emptyBestSet(TODAY))).toBe(true);
    expect(isBlankBestSet(undefined)).toBe(true);
    expect(validateBestSet(emptyBestSet(TODAY), 'boxSquatLb', TODAY)).toEqual({});
    expect(emptyBestSet(TODAY).date).toBe(TODAY);
  });

  it('accepts the owner set', () => {
    expect(validateBestSet(OWNER, 'boxSquatLb', TODAY)).toEqual({});
  });

  it('asks for the half of a set that is missing', () => {
    expect(validateBestSet({ ...OWNER, reps: '' }, 'boxSquatLb', TODAY).reps).toBe(
      'Enter the reps you did.',
    );
    expect(validateBestSet({ ...OWNER, loadLb: '' }, 'boxSquatLb', TODAY).loadLb).toBe(
      'Enter the load you lifted.',
    );
  });

  it('reads an added load on its own scale, where 30 lb is an ordinary answer', () => {
    const hung: BestSetValues = { reps: '5', loadLb: '30', rpe: 8, date: '2026-08-31' };
    expect(validateBestSet(hung, 'pullUpAddedLb', TODAY)).toEqual({});
    expect(validateBestSet(hung, 'boxSquatLb', TODAY).loadLb).toBe(
      'That load reads between 45 and 1,000 lb.',
    );
    expect(
      validateBestSet({ ...hung, loadLb: '' }, 'pullUpAddedLb', TODAY).loadLb,
    ).toBe('Enter the load you hung.');
  });

  it('refuses a set from the future and a date that is not one', () => {
    expect(validateBestSet({ ...OWNER, date: '2026-09-06' }, 'boxSquatLb', TODAY).date).toBe(
      'A set you have done is today or earlier.',
    );
    expect(validateBestSet({ ...OWNER, date: '31 Aug' }, 'boxSquatLb', TODAY).date).toBe(
      "That isn't a date. Use YYYY-MM-DD, for example 2026-08-31.",
    );
  });

  it('keeps the reps on a scale a set actually has', () => {
    expect(validateBestSet({ ...OWNER, reps: '0' }, 'boxSquatLb', TODAY).reps).toBe(
      'Reps read between 1 and 20.',
    );
    expect(validateBestSet({ ...OWNER, reps: '25' }, 'boxSquatLb', TODAY).reps).toBe(
      'Reps read between 1 and 20.',
    );
  });

  it('names R73 near-max test on the set the athlete just typed', () => {
    expect(isNearMaxSet(2, 8.5)).toBe(true);
    expect(isNearMaxSet(6, 8)).toBe(true);
    expect(isNearMaxSet(7, 9)).toBe(false);
    expect(isNearMaxSet(3, 7)).toBe(false);
    expect(isNearMaxSet(3, null)).toBe(false);

    expect(bestSetSummary(OWNER)).toBe('2 × 305 lb at RPE 8.5 · counts as a near-max');
    expect(bestSetSummary({ ...OWNER, rpe: 7 })).toContain('read at 95%');
    expect(bestSetSummary(emptyBestSet(TODAY))).toBeNull();
  });
});

describe('the stored document', () => {
  it('writes one entry per lift, in kilograms, and nothing for a blank row', () => {
    const draft = {
      boxSquatLb: OWNER,
      pullUpAddedLb: emptyBestSet(TODAY),
    };
    expect(bestSetsFrom(draft, TODAY)).toEqual({
      box_squat: { reps: 2, loadKg: lbToKg(305), rpe: 8.5, at: '2026-08-31' },
    });
  });

  it('writes nothing for a refused row, so a half-typed set never reaches R73', () => {
    const draft = { boxSquatLb: { ...OWNER, reps: '' } };
    expect(bestSetsHaveErrors(draft, TODAY)).toBe(true);
    expect(bestSetsFrom(draft, TODAY)).toEqual({});
  });

  it('leaves the effort out when no chip was tapped', () => {
    const draft = { boxSquatLb: { ...OWNER, rpe: null } };
    expect(bestSetsFrom(draft, TODAY)).toEqual({
      box_squat: { reps: 2, loadKg: lbToKg(305), at: '2026-08-31' },
    });
  });

  it('round-trips a stored set back into the form', () => {
    const stored = bestSetsFrom({ boxSquatLb: OWNER }, TODAY);
    expect(bestSetValuesFrom(stored['box_squat'], TODAY)).toEqual(OWNER);
    expect(bestSetValuesFrom(undefined, TODAY)).toEqual(emptyBestSet(TODAY));

    const draft = bestSetsDraftFrom(stored, ['boxSquatLb', 'pullUpAddedLb'], TODAY);
    expect(draft.boxSquatLb).toEqual(OWNER);
    expect(isBlankBestSet(draft.pullUpAddedLb)).toBe(true);
  });
});

describe('what the engine does with it', () => {
  it('raises the box squat to 325 lb from the owner two at 305 at RPE 8.5', () => {
    const ruleset = loadRuleset();
    const boxSquat = indexById(loadExercises().exercises).get('box_squat');
    expect(boxSquat).toBeDefined();
    if (boxSquat === undefined) return;

    const stored = bestSetsFrom({ boxSquatLb: OWNER }, TODAY);
    const entry = stored['box_squat'];
    expect(entry).toBeDefined();

    const frozen = resolveWorkingMaxWithEntry(
      'box_squat',
      boxSquat,
      {
        lift: 'box_squat',
        valueKg: lbToKg(320),
        source: 'entered',
        confidence: 1,
        frozenAt: '2026-09-07T03:00:00.000Z',
        lastRaiseAt: '2026-09-07T03:00:00.000Z',
        failStreak: 0,
      },
      null,
      [],
      ruleset,
      '2026-09-14T03:00:00.000Z',
      entry,
    );
    expect(Math.round(kgToLb(frozen.valueKg))).toBe(325);
  });
});
