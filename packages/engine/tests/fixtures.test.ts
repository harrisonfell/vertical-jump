/**
 * The owner fixture, built through the engine. These tests are the contract
 * the app's fixture mode boots against: if a shape here changes, the runner's
 * screenshots change with it.
 */
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_CURRENT_WEEK,
  FIXTURE_PROGRAM_START,
  FIXTURE_TARGET_DATE,
  FIXTURE_TEST_HEIGHTS_IN,
  FIXTURE_TODAY,
  buildOwnerFixture,
} from '../src/fixtures/index.js';
import { mmToIn } from '../src/units.js';
import { displayedRowCount } from '../src/select/order.js';

const fixture = buildOwnerFixture();

describe('the owner fixture', () => {
  it('builds a 12-week program from Mon 7 Sep 2026 to Sun 29 Nov 2026', () => {
    expect(fixture.skeleton.programStart).toBe(FIXTURE_PROGRAM_START);
    expect(fixture.skeleton.targetDate).toBe(FIXTURE_TARGET_DATE);
    expect(fixture.skeleton.W).toBe(12);
    expect(fixture.skeleton.daysPerWeek).toBe(4);
    expect(fixture.skeleton.weekdays).toEqual([1, 2, 4, 6]);
    expect(fixture.athlete.level).toBe('advanced');
    expect(fixture.athlete.sport).toBe('basketball');
  });

  it('materializes weeks 1 to 7 in order, each reading the one before it', () => {
    expect(fixture.weeks.map((week) => week.w)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fixture.weeks[0]?.outcome).toBeUndefined();
    for (const week of fixture.weeks.slice(1)) {
      expect(week.outcome).toBeDefined();
      expect(week.outcome?.line.length ?? 0).toBeGreaterThan(0);
    }
    expect(fixture.weeks[4]?.kind).toBe('deload');
    expect(fixture.weeks[5]?.blockType).toBe('power');
    expect(fixture.weeks[6]?.w).toBe(FIXTURE_CURRENT_WEEK);
  });

  it('logs weeks 1 to 6 as written, with week 3 at 3 of 4 and a failed squat set in week 5', () => {
    const week3 = fixture.weeks[2];
    const week3Records = fixture.sessions.filter((record) =>
      week3?.sessions.some((session) => session.id === record.sessionId),
    );
    expect(week3Records.filter((record) => record.status === 'done')).toHaveLength(3);

    const week5 = fixture.weeks[4];
    const squat = week5?.sessions
      .flatMap((session) => session.blocks)
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'back_squat');
    const topSet = squat?.sets.at(-1);
    const log = fixture.setLogs.find(
      (entry) => entry.exerciseId === 'back_squat' && entry.setNumber === (topSet?.setNumber ?? 0) &&
        entry.plannedDate >= (week5?.windowStart ?? '') && entry.plannedDate <= (week5?.windowEnd ?? ''),
    );
    expect(log?.repsDone ?? 0).toBeLessThan(topSet?.reps ?? 0);
    expect(fixture.weeks[5]?.outcome?.kind).toBe('hold');
    expect(fixture.weeks[5]?.outcome?.line).toContain('back squat loads');
  });

  it('leaves week 7 with Monday and Tuesday done and Thursday still to run', () => {
    const week7 = fixture.weeks[6];
    const ids = new Set(week7?.sessions.map((session) => session.id));
    const records = fixture.sessions.filter((record) => ids.has(record.sessionId));
    expect(records.filter((record) => record.status === 'done')).toHaveLength(2);
    expect(fixture.today).toBe(FIXTURE_TODAY);
    const dates = week7?.sessions.map((session) => session.date) ?? [];
    expect(dates).toEqual(['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-24']);
  });

  it('makes week 7 Thursday the test day with the expected blocks', () => {
    const week7 = fixture.weeks[6];
    const thursday = week7?.sessions.find((session) => session.date === FIXTURE_TODAY);
    expect(thursday).toBeDefined();
    if (thursday === undefined) return;
    expect(thursday.dayType).toBe('power_speed');
    expect(thursday.isTestDay).toBe(true);
    expect(thursday.testStatus).toBe('planned');
    expect(thursday.headerSuffixes).toContain('· Test day');
    expect(thursday.blocks.map((block) => block.name)).toEqual([
      'warm_up',
      'primer',
      'jump_test',
      'power',
      'cod',
      'accessory',
      'cool_down',
    ]);
    expect(thursday.isMaximalCns).toBe(true);
    expect(displayedRowCount(thursday.blocks)).toBeLessThanOrEqual(8);
    expect(thursday.contacts.highIntensity).toBeLessThanOrEqual(25);
    expect(thursday.contacts.highAmplitude).toBeLessThanOrEqual(20);
    const range = { bottom: 80, top: 120 };
    expect(thursday.contacts.extensive).toBeGreaterThanOrEqual(range.bottom);
    expect(thursday.contacts.extensive).toBeLessThanOrEqual(range.top);
  });

  it('carries six canonical OVR Jump tests rising to a 32.5 in PR', () => {
    expect(fixture.tests).toHaveLength(6);
    const bests = fixture.tests.map((test) =>
      Math.round(mmToIn(Math.max(...test.reps.map((rep) => rep.heightMm))) * 10) / 10,
    );
    expect(bests).toEqual(FIXTURE_TEST_HEIGHTS_IN);
    expect(fixture.tests.every((test) => test.instrument === 'ovr_jump_regular')).toBe(true);
    expect(fixture.tests.every((test) => test.canonical)).toBe(true);
    expect(fixture.tests[0]?.isBaseline).toBe(true);
    expect(fixture.tests.slice(1).every((test) => !test.isBaseline)).toBe(true);
    expect(fixture.tests.every((test) => test.reps.length === 5)).toBe(true);
  });

  it('mirrors 90 days of Whoop with all three score states', () => {
    expect(fixture.whoop.cycles).toHaveLength(90);
    expect(fixture.whoop.recoveries).toHaveLength(90);
    expect(fixture.whoop.sleeps).toHaveLength(90);
    expect(fixture.whoop.workouts.length).toBeGreaterThan(20);
    const states = new Set(fixture.whoop.recoveries.map((row) => row.score_state));
    expect(states.has('SCORED')).toBe(true);
    expect(states.has('PENDING_SCORE')).toBe(true);
    expect(states.has('UNSCORABLE')).toBe(true);
    for (const row of fixture.whoop.recoveries) {
      if (row.score_state === 'SCORED') expect(row.score).toBeDefined();
      else expect(row.score).toBeUndefined();
    }
    expect(fixture.whoop.cycles.at(-1)?.localDay).toBe(FIXTURE_TODAY);
  });

  it('is deterministic: two builds are byte-identical', () => {
    expect(JSON.stringify(buildOwnerFixture())).toBe(JSON.stringify(fixture));
    expect(JSON.stringify(buildOwnerFixture(7))).not.toBe(JSON.stringify(fixture));
  });

  it('prescribes real loads from the entered squat max, and RPE mode where there is none', () => {
    const monday = fixture.weeks[6]?.sessions[0];
    const squat = monday?.blocks
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'back_squat');
    expect(squat?.sourceLine.length ?? 0).toBeGreaterThan(0);
    expect(squat?.sets.every((set) => set.loadKg !== undefined)).toBe(true);
    expect(squat?.sets.every((set) => set.displayLoad.includes('lb'))).toBe(true);

    const week1Monday = fixture.weeks[0]?.sessions[0];
    const week1Rows = week1Monday?.blocks.flatMap((block) => block.exercises) ?? [];
    const rpeRow = week1Rows.find((row) => row.sets.some((set) => set.targetRpe !== undefined));
    expect(rpeRow).toBeDefined();
    expect(rpeRow?.loadMode).toBe('week1');
    expect((rpeRow?.sets ?? []).every((set) => (set.targetRpe ?? 0) <= 7)).toBe(true);
  });
});
