import { describe, expect, it } from 'vitest';
import type { SessionWindow, WallWork } from '@vert/engine';
import { validateStepTwo, type StepTwoDraft } from './stepTwoValidation';

/**
 * Step 2's weekday refusal, for a climber.
 *
 * A speed climber's picks decide which day carries the upper-power session,
 * because that session is the week's one hard finger day and has to clear the
 * wall (`house.sc.sport_requirements`). Given the sport and the two windows,
 * `validateWeekdays` checks the picks against the placement the generator will
 * actually build, so a set of days that cannot carry it is refused here rather
 * than at build time. The sentence is the engine's, word for word: this asserts
 * that the app shows it and does not reword it.
 */

const TODAY = '2026-09-04';

const BASE: StepTwoDraft = {
  measure: 'device',
  baselineIn: '29.4',
  reachIn: '',
  touchIn: '',
  canonical: true,
  goalIn: '36',
  targetDate: '2026-11-29',
  weekdays: [1, 2, 3, 5],
  daysPerWeek: 4,
  bodyweightLb: '150',
  squatLb: '',
  hingeLb: '',
  pressLb: '',
  boxSquatLb: '320',
  pullUpAddedLb: '',
  inSeason: false,
};

/** The owner's wall: Sunday, Tuesday and Thursday evenings, hard on the hands. */
const WALL: WallWork = {
  weekdays: [0, 2, 4],
  typicalStart: '18:00',
  typicalEnd: '20:00',
  fingerLoad: 'hard',
  sameDayGapHours: 6,
};

/** The owner's gym window: mornings, ten hours clear of the wall. */
const MORNINGS: SessionWindow = { start: '08:00', end: '10:00' };
/** An evening lifter, whose gym window runs into the wall's. */
const EVENINGS: SessionWindow = { start: '17:00', end: '19:00' };

function check(
  patch: Partial<StepTwoDraft>,
  wallWork: WallWork | null,
  sessionWindow: SessionWindow | null,
) {
  return validateStepTwo(
    { ...BASE, ...patch },
    { today: TODAY, sport: 'speed_climbing', wallWork, sessionWindow },
  );
}

describe('the weekday refusal a climber sees in step 2', () => {
  it('accepts the owner picks, which put upper power on a wall morning', () => {
    const result = check({}, WALL, MORNINGS);
    expect(result.errors.weekdays).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it('refuses picks that cannot carry the upper-power day, in the engine words', () => {
    // Evenings in the gym: the same-day gap fails, so a wall day cannot carry
    // the session, and Mon, Wed, Fri and Sat are all inside 48 h of a wall day.
    const result = check({}, WALL, EVENINGS);
    expect(result.errors.weekdays).toBe(
      'Upper power needs a climbing day at least 6 h before the wall, ' +
        'or a day 48 h from climbing. Pick Sun, Tue or Thu.',
    );
    expect(result.ok).toBe(false);
  });

  it('says the athletes own gap, not a number typed into the app', () => {
    const wall: WallWork = { ...WALL, sameDayGapHours: 9 };
    expect(check({}, wall, EVENINGS).errors.weekdays).toContain('at least 9 h before the wall');
  });

  it('leaves the refusal alone when the wall is light on the hands', () => {
    // `fingerLoad: 'light'` takes the wall out of the finger rule entirely, so
    // the picks are read the way any other sport reads them.
    const result = check({}, { ...WALL, fingerLoad: 'light' }, EVENINGS);
    expect(result.errors.weekdays).toBeUndefined();
  });

  it('reads the picks as any other sport would when no wall is on file', () => {
    expect(check({}, null, MORNINGS).errors.weekdays).toBeUndefined();
    expect(
      validateStepTwo({ ...BASE }, { today: TODAY }).errors.weekdays,
    ).toBeUndefined();
  });
});
