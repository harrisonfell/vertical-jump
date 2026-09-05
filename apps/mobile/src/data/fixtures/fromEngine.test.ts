import { inToMm } from '@vert/engine/units';
import { buildOwnerFixture } from '@vert/engine/fixtures';
import { describe, expect, it } from 'vitest';
import { getAthlete } from '../store/athlete';
import { getCurrentProgram, listWeeks } from '../store/program';
import { listSessionsByWeek } from '../store/sessions';
import { getCurrentBest, listJumpTests } from '../store/jumpTests';
import { getWhoopConnection, listRecovery } from '../store/whoop';
import { openMigratedTestDb } from '../testing/testDb';
import { applyFixture } from './seed';
import { fromEngineFixture, fixtureShiftDays } from './fromEngine';
import { rotateWeekday, shiftDay, shiftInstant, shiftJson } from './shift';
import { isFixtureData } from './types';

const ZONE = 'America/New_York';
/** The engine fixture's own today: week 7, Power block, the test day. */
const ENGINE_TODAY = '2026-10-22';

describe('shifting a fixture in time', () => {
  it('moves dates, instants and weekdays by the same offset', () => {
    expect(shiftDay('2026-10-22', 0)).toBe('2026-10-22');
    expect(shiftDay('2026-10-22', -48)).toBe('2026-09-04');
    expect(shiftInstant('2026-10-22T18:20:00.000Z', 7)).toBe('2026-10-29T18:20:00.000Z');
    expect(shiftInstant('not a stamp', 7)).toBe('not a stamp');
    expect(rotateWeekday(4, 1)).toBe(5);
    expect(rotateWeekday(6, 1)).toBe(0);
    expect(rotateWeekday(1, -48)).toBe(2);
  });

  it('walks a snapshot without changing anything but its dates', () => {
    const walked = shiftJson(
      { date: '2026-10-22', weekday: 4, weekdays: [1, 2, 4, 6], reps: 5, name: 'Back squat' },
      1,
    ) as Record<string, unknown>;
    expect(walked['date']).toBe('2026-10-23');
    expect(walked['weekday']).toBe(5);
    expect(walked['weekdays']).toEqual([2, 3, 5, 0]);
    expect(walked['reps']).toBe(5);
    expect(walked['name']).toBe('Back squat');
  });

  it('is a no-op at zero, so the engine anchor is byte-identical', () => {
    const owner = buildOwnerFixture();
    expect(fixtureShiftDays(owner, ENGINE_TODAY)).toBe(0);
    expect(fixtureShiftDays(owner, '2026-10-29')).toBe(7);
    expect(fixtureShiftDays(owner, '2026-09-04', 'engine')).toBe(0);
  });
});

describe('the engine owner fixture, converted', () => {
  it('produces the shape the seeder writes', () => {
    const data = fromEngineFixture(buildOwnerFixture(), ENGINE_TODAY, ZONE);
    expect(isFixtureData(data)).toBe(true);
    expect(data.athlete.level).toBe('advanced');
    expect(data.athlete.daysPerWeek).toBe(4);
    expect(data.athlete.weekdays).toEqual([1, 2, 4, 6]);
    expect(data.athlete.timezone).toBe(ZONE);
    expect(data.program.startDate).toBe('2026-09-07');
    expect(data.weeks.map((week) => week.w)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(data.jumpTests).toHaveLength(6);
    expect(data.whoopRecoveries).toHaveLength(90);

    // Every set log points at a session and an exercise the fixture defines.
    const sessionKeys = new Set(data.sessions.map((session) => session.key));
    const exerciseKeys = new Set(
      data.sessions.flatMap((session) => session.exercises.map((row) => row.key)),
    );
    for (const log of data.setLogs) {
      expect(sessionKeys.has(log.sessionKey)).toBe(true);
      expect(exerciseKeys.has(log.exerciseKey)).toBe(true);
    }
  });

  it('slides the whole fixture so its today is the athlete today', () => {
    const today = '2026-09-04';
    const data = fromEngineFixture(buildOwnerFixture(), today, ZONE);
    const shift = -48;

    expect(data.program.startDate).toBe(shiftDay('2026-09-07', shift));
    // The weekday numbers move with the dates, so the calendar stays honest.
    expect(data.athlete.weekdays).toEqual([1, 2, 4, 6].map((day) => rotateWeekday(day, shift)));
    const week7 = data.weeks.find((week) => week.w === 7);
    expect(week7).toBeDefined();
    expect(week7 !== undefined && week7.windowStart <= today).toBe(true);
    expect(week7 !== undefined && week7.windowEnd >= today).toBe(true);
    expect(data.sessions.some((session) => session.scheduledDate === today)).toBe(true);
  });

  it('seeds a real week 7 through the repositories', async () => {
    const db = await openMigratedTestDb();
    const data = fromEngineFixture(buildOwnerFixture(), ENGINE_TODAY, ZONE);
    await applyFixture(db, data);

    const athlete = await getAthlete(db);
    expect(athlete?.level).toBe('advanced');
    expect(athlete?.timezone).toBe(ZONE);
    expect(Object.keys(athlete?.workingMax ?? {})).toContain('back_squat');

    const program = await getCurrentProgram(db);
    expect(program?.startDate).toBe('2026-09-07');

    const weeks = await listWeeks(db, program?.id ?? '');
    expect(weeks).toHaveLength(7);
    const week7 = weeks.find((week) => week.w === 7);
    expect(week7?.snapshot).not.toBeNull();

    const sessions = await listSessionsByWeek(db, week7?.id ?? '', ENGINE_TODAY);
    expect(sessions.length).toBeGreaterThan(0);
    // Weeks 1 to 6 are logged; week 7 has Monday and Tuesday done.
    expect(sessions.filter((session) => session.status === 'done').length).toBe(2);
    for (const session of sessions) expect(session.prescribedSetCount).toBeGreaterThan(0);

    const tests = await listJumpTests(db, {
      instrument: 'ovr_jump_regular',
      canonicalOnly: true,
    });
    expect(tests).toHaveLength(6);
    // The stream rises to 32.5 in, which is what Progress reads as current.
    const best = await getCurrentBest(db, 'ovr_jump_regular', 'Regular');
    expect(best).not.toBeNull();
    expect(best ?? 0).toBeGreaterThan(inToMm(32.4));
    expect(best ?? 0).toBeLessThan(inToMm(32.6));

    const recovery = await listRecovery(db, '2026-07-25', ENGINE_TODAY);
    expect(recovery).toHaveLength(90);
    expect(recovery.some((day) => day.scoreState !== 'SCORED')).toBe(true);

    // Ninety days of mirrors behind a disconnected row is a strip that reads
    // "Whoop not connected" while holding every number it says it has not got.
    const connection = await getWhoopConnection(db);
    expect(connection.status).toBe('connected');
    expect(connection.lastSyncAt).not.toBeNull();

    // Sleep hours are the fact the athlete acts on most directly, and the
    // strip cannot show them if the mirror drops Whoop's time in bed.
    const sleep = await db.getFirstAsync<{ total_in_bed_time_milli: number | null }>(
      "SELECT total_in_bed_time_milli FROM whoop_sleep WHERE score_state = 'SCORED' LIMIT 1",
    );
    expect(sleep?.total_in_bed_time_milli ?? 0).toBeGreaterThan(6 * 3_600_000);

    await db.closeAsync();
  });
});
