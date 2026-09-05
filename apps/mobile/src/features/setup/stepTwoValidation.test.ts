import { describe, expect, it } from 'vitest';
import {
  feasibilityLine,
  orderWeekdays,
  reachTouchIn,
  validateStepTwo,
  type StepTwoDraft,
} from './stepTwoValidation';

const TODAY = '2026-09-04';

const VALID: StepTwoDraft = {
  measure: 'device',
  baselineIn: '29.4',
  reachIn: '',
  touchIn: '',
  canonical: true,
  goalIn: '36',
  targetDate: '2026-11-29',
  weekdays: [1, 2, 4, 6],
  daysPerWeek: 4,
  bodyweightLb: '181',
  squatLb: '275',
  hingeLb: '',
  pressLb: '',
  boxSquatLb: '',
  pullUpAddedLb: '',
  inSeason: false,
};

function check(patch: Partial<StepTwoDraft>) {
  return validateStepTwo({ ...VALID, ...patch }, { today: TODAY });
}

describe('validateStepTwo', () => {
  it('accepts the owner answers', () => {
    const result = check({});
    expect(result.errors).toEqual({});
    expect(result.ok).toBe(true);
    expect(result.currentIn).toBe(29.4);
  });

  it('refuses a goal at or below the current height', () => {
    expect(check({ goalIn: '29.4' }).errors.goalIn).toBe(
      'Your goal has to be above 29.4 in, where you are now.',
    );
    expect(check({ goalIn: '25' }).errors.goalIn).toBe(
      'Your goal has to be above 29.4 in, where you are now.',
    );
    expect(check({ goalIn: '29.5' }).errors.goalIn).toBeUndefined();
  });

  it('asks for a goal when the field is blank', () => {
    expect(check({ goalIn: '' }).errors.goalIn).toBe('Enter a goal jump height.');
  });

  it('refuses a jump height outside the device field', () => {
    expect(check({ baselineIn: '4' }).errors.baselineIn).toBe(
      'A jump height reads between 6 and 60 in. Check the number.',
    );
    expect(check({ baselineIn: '61' }).errors.baselineIn).toBe(
      'A jump height reads between 6 and 60 in. Check the number.',
    );
  });

  it('refuses a target date under two weeks out, and names the gap', () => {
    expect(check({ targetDate: '2026-09-17' }).errors.targetDate).toBe(
      'That is 13 days out. Pick a date at least 2 weeks out.',
    );
    expect(check({ targetDate: '2026-09-18' }).errors.targetDate).toBeUndefined();
    expect(check({ targetDate: '2026-08-30' }).errors.targetDate).toBe(
      'That date has passed. Pick a date at least 2 weeks out.',
    );
    expect(check({ targetDate: 'soon' }).errors.targetDate).toBe(
      "That isn't a date. Use YYYY-MM-DD, for example 2026-12-05.",
    );
  });

  it('passes the engine weekday refusal through with its rule number', () => {
    // Mon Lower Strength and Tue Power + Speed at 2 days a week: R91.
    expect(check({ weekdays: [1, 2], daysPerWeek: 2 }).errors.weekdays).toBe(
      "Strength and Power can't be on consecutive days (rule 91). Pick another day.",
    );
    expect(check({ weekdays: [1, 4], daysPerWeek: 2 }).errors.weekdays).toBeUndefined();
  });

  it('refuses the wrong number of training days', () => {
    expect(check({ weekdays: [1, 2, 4], daysPerWeek: 4 }).errors.weekdays).toBe(
      'Pick 4 training days.',
    );
  });

  it('reads reach and touch as a jump height', () => {
    const result = check({ measure: 'reach', reachIn: '96', touchIn: '125.4' });
    expect(result.currentIn).toBeCloseTo(29.4, 6);
    expect(result.errors.touchIn).toBeUndefined();
  });

  it('refuses a touch height at or below the reach', () => {
    expect(check({ measure: 'reach', reachIn: '96', touchIn: '96' }).errors.touchIn).toBe(
      'Touch height has to be above your standing reach.',
    );
  });

  it('bounds bodyweight and an entered 1RM', () => {
    expect(check({ bodyweightLb: '20' }).errors.bodyweightLb).toBe(
      'Bodyweight reads between 60 and 500 lb.',
    );
    expect(check({ squatLb: '2000' }).errors.squatLb).toBe('A 1RM reads between 45 and 1,000 lb.');
    expect(check({ squatLb: '' }).errors.squatLb).toBeUndefined();
  });
});

describe('orderWeekdays', () => {
  it('sorts into template order and drops duplicates', () => {
    expect(orderWeekdays([6, 1, 2, 4, 1])).toEqual([1, 2, 4, 6]);
  });

  it('drops anything that is not a weekday', () => {
    expect(orderWeekdays([1, 9, -1, 3.5])).toEqual([1]);
  });
});

describe('reachTouchIn', () => {
  it('is the difference, or null when either is missing', () => {
    expect(reachTouchIn(96, 125)).toBe(29);
    expect(reachTouchIn(null, 125)).toBeNull();
    expect(reachTouchIn(96, null)).toBeNull();
  });
});

describe('feasibilityLine', () => {
  it('reads the program length, the date and the required pace', () => {
    expect(
      feasibilityLine({
        currentIn: 29.4,
        goalIn: 36,
        targetDate: '2026-11-29',
        today: TODAY,
        weekdays: [1, 2, 4, 6],
      }),
    ).toBe('12 weeks to 29 Nov. From 29.4 in to 36.0 in is +0.55 in/wk.');
  });

  it('measures from today when no weekday is picked yet', () => {
    expect(
      feasibilityLine({
        currentIn: 30,
        goalIn: 32,
        targetDate: '2026-10-02',
        today: TODAY,
        weekdays: [],
      }),
    ).toBe('5 weeks to 2 Oct. From 30.0 in to 32.0 in is +0.40 in/wk.');
  });

  it('is null when the date is not a date', () => {
    expect(
      feasibilityLine({
        currentIn: 30,
        goalIn: 32,
        targetDate: 'later',
        today: TODAY,
        weekdays: [],
      }),
    ).toBeNull();
  });
});

describe('the climbing main lifts', () => {
  it('reads a box squat on the same 1RM field as any other lift', () => {
    expect(check({ boxSquatLb: '320' }).errors.boxSquatLb).toBeUndefined();
    expect(check({ boxSquatLb: '40' }).errors.boxSquatLb).toBe(
      'A 1RM reads between 45 and 1,000 lb.',
    );
  });

  it('reads an added load on its own field, where 40 lb is an ordinary answer', () => {
    expect(check({ pullUpAddedLb: '40' }).errors.pullUpAddedLb).toBeUndefined();
    expect(check({ pullUpAddedLb: '2' }).errors.pullUpAddedLb).toBe(
      'An added load reads between 5 and 300 lb.',
    );
    expect(check({ pullUpAddedLb: '400' }).errors.pullUpAddedLb).toBe(
      'An added load reads between 5 and 300 lb.',
    );
  });

  it('asks for neither: both fields are optional', () => {
    expect(check({ boxSquatLb: '', pullUpAddedLb: '' }).ok).toBe(true);
  });
});
