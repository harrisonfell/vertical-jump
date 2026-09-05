import { describe, expect, it } from 'vitest';
import { openMigratedTestDb } from '../testing/testDb';
import { getAthlete } from '../store/athlete';
import { getCurrentProgram, listWeeks } from '../store/program';
import { listSessionsByWeek } from '../store/sessions';
import { listJumpTests } from '../store/jumpTests';
import { listRecovery } from '../store/whoop';
import { buildPlaceholderFixture } from './placeholder';
import { applyFixture, fixtureMode, seedIfEmpty } from './seed';

const TODAY = '2026-09-08';
const ZONE = 'America/New_York';

describe('fixture mode', () => {
  it('reads the three states of EXPO_PUBLIC_FIXTURE', () => {
    expect(fixtureMode('1')).toBe('seed');
    expect(fixtureMode('empty')).toBe('empty');
    expect(fixtureMode(undefined)).toBe('off');
    expect(fixtureMode('anything else')).toBe('off');
  });
});

describe('the placeholder fixture', () => {
  it('seeds a program, a week, sessions, logs, tests, and Whoop days', async () => {
    const db = await openMigratedTestDb();
    await applyFixture(db, buildPlaceholderFixture(TODAY, ZONE));

    const athlete = await getAthlete(db);
    expect(athlete?.timezone).toBe(ZONE);
    expect(athlete?.level).toBe('advanced');
    expect(athlete?.weekdays).toEqual([1, 2, 4, 6]);

    const program = await getCurrentProgram(db);
    expect(program).not.toBeNull();

    const weeks = await listWeeks(db, program?.id ?? '');
    expect(weeks).toHaveLength(1);

    const sessions = await listSessionsByWeek(db, weeks[0]?.id ?? '', TODAY);
    expect(sessions).toHaveLength(4);
    // Mon and Tue are behind 8 Sep 2026 (a Tuesday is 8 Sep, so Monday is past).
    const past = sessions.filter((session) => session.scheduledDate < TODAY);
    expect(past.length).toBeGreaterThan(0);
    for (const session of past) expect(session.status).toBe('done');
    for (const session of sessions.filter((s) => s.scheduledDate > TODAY)) {
      expect(session.status).toBe('planned');
    }

    const tests = await listJumpTests(db, { instrument: 'ovr_jump_regular', canonicalOnly: true });
    expect(tests).toHaveLength(3);
    expect(tests[0]?.bestHeightMm).toBeGreaterThan(0);
    expect(tests[0]?.spreadMm).toBeGreaterThan(0);
    // Three sessions is still calibration, so nothing is flagged as a PR.
    expect(tests.some((test) => test.isPr)).toBe(false);

    const recovery = await listRecovery(db, '2026-08-01', TODAY);
    expect(recovery).toHaveLength(14);
    expect(recovery[recovery.length - 1]?.scoreState).toBe('PENDING_SCORE');
    expect(recovery[recovery.length - 1]?.recoveryScore).toBeNull();

    await db.closeAsync();
  });

  it('seeds only when the athlete table is empty, and never in empty mode', async () => {
    const db = await openMigratedTestDb();

    expect(await seedIfEmpty(db, TODAY, ZONE, 'empty')).toBe(false);
    expect(await getAthlete(db)).toBeNull();

    expect(await seedIfEmpty(db, TODAY, ZONE, 'off')).toBe(false);
    expect(await getAthlete(db)).toBeNull();

    expect(await seedIfEmpty(db, TODAY, ZONE, 'seed')).toBe(true);
    expect(await getAthlete(db)).not.toBeNull();

    // A second open must not seed a second program on top of real data.
    expect(await seedIfEmpty(db, TODAY, ZONE, 'seed')).toBe(false);
    const programs = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM program');
    expect(programs[0]?.n).toBe(1);

    await db.closeAsync();
  });
});
