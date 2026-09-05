import { describe, expect, it } from 'vitest';
import { buildClimberFixture } from '@vert/engine/fixtures';
import type { SessionWindow, WallWork, WeekPlan } from '@vert/engine';
import { climbingWeekLines, upperPowerWindowLine } from './climbLines';

/**
 * The one climbing sentence the app writes for itself.
 *
 * The generator places upper power on a climbing day when the two windows
 * clear each other (`house.sc.sport_requirements`) and then says nothing,
 * because from inside the week that is simply where the day is. From outside
 * it is the answer to "why is my hardest pulling on a day I climb", so the
 * Plan and Today say it, from the athlete's own answers and no others.
 */

const climber = buildClimberFixture();

function week7(): WeekPlan {
  const week = climber.weeks[climber.weeks.length - 1];
  if (week === undefined) throw new Error('the fixture built no weeks');
  return week;
}

const WALL: WallWork = {
  weekdays: [0, 2, 4],
  typicalStart: '18:00',
  typicalEnd: '20:00',
  fingerLoad: 'hard',
  sameDayGapHours: 6,
};
const GYM: SessionWindow = { start: '08:00', end: '10:00' };

const OWNER_LINE =
  'Upper power on a climbing day: gym 08:00 to 10:00, wall 18:00 to 20:00, kept 6 h apart.';

describe('upperPowerWindowLine', () => {
  it('names both windows and the gap the athlete chose', () => {
    expect(
      upperPowerWindowLine({
        wallWork: WALL,
        sessionWindow: GYM,
        weekday: 2,
        sessionIntent: 'upper_power',
      }),
    ).toBe(OWNER_LINE);
  });

  it('says nothing on a day that is not the upper-power day', () => {
    expect(
      upperPowerWindowLine({
        wallWork: WALL,
        sessionWindow: GYM,
        weekday: 2,
        sessionIntent: 'strength',
      }),
    ).toBeNull();
  });

  it('says nothing when the day is not a climbing day', () => {
    // Monday: the heavy squat day, which is not on the wall.
    expect(
      upperPowerWindowLine({
        wallWork: WALL,
        sessionWindow: GYM,
        weekday: 1,
        sessionIntent: 'upper_power',
      }),
    ).toBeNull();
  });

  it('says nothing without both windows, because then there is no fact to state', () => {
    const noTimes: WallWork = { weekdays: [0, 2, 4], fingerLoad: 'hard' };
    expect(
      upperPowerWindowLine({
        wallWork: noTimes,
        sessionWindow: GYM,
        weekday: 2,
        sessionIntent: 'upper_power',
      }),
    ).toBeNull();
    expect(
      upperPowerWindowLine({
        wallWork: WALL,
        sessionWindow: null,
        weekday: 2,
        sessionIntent: 'upper_power',
      }),
    ).toBeNull();
    expect(
      upperPowerWindowLine({
        wallWork: null,
        sessionWindow: GYM,
        weekday: 2,
        sessionIntent: 'upper_power',
      }),
    ).toBeNull();
  });

  it('says nothing when the wall is light on the hands', () => {
    expect(
      upperPowerWindowLine({
        wallWork: { ...WALL, fingerLoad: 'light' },
        sessionWindow: GYM,
        weekday: 2,
        sessionIntent: 'upper_power',
      }),
    ).toBeNull();
  });

  it('reads six hours when the athlete never answered the gap', () => {
    const { sameDayGapHours: _unused, ...noGap } = WALL;
    expect(
      upperPowerWindowLine({
        wallWork: noGap,
        sessionWindow: GYM,
        weekday: 2,
        sessionIntent: 'upper_power',
      }),
    ).toBe(OWNER_LINE);
  });
});

describe('climbingWeekLines', () => {
  it('names the day in front of the line, once, on the fixture week', () => {
    expect(climbingWeekLines(week7(), { wallWork: WALL, sessionWindow: GYM })).toEqual([
      `Tue · ${OWNER_LINE}`,
    ]);
  });

  it('says nothing for an athlete who answered neither window', () => {
    expect(climbingWeekLines(week7(), { wallWork: null, sessionWindow: null })).toEqual([]);
  });
});
