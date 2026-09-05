/**
 * The climbing house rules, on the wire.
 *
 * The gate's own test stream, the day's readiness answer, the single-leg pair
 * and the profile answers all travel as their own op kinds, and each one is
 * asserted against rows rather than against the response body.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client';
import {
  athlete,
  jumpRep,
  jumpTestSession,
  readinessOutcome,
  readinessTestSession,
} from '../src/db/tables/mirror';
import { teardown } from './support/harness';
import { CREATED, push, syncHarness } from './support/syncOps';

let db: Database;

beforeEach(async () => {
  db = await syncHarness();
}, 60_000);

afterEach(() => {
  teardown();
});

/** The climbing house rules, on the wire. */
describe('the climbing ops', () => {
  it('applies a readiness test and replaces the day when it is logged again', async () => {
    const payload = {
      localDate: '2026-10-22',
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: [6.95, 7.05, 7.15],
      best: 7.15,
      unit: 'm',
      entrySource: 'typed',
      createdAt: CREATED,
    };
    const first = await push([
      { id: 'dev_test:r1', kind: 'readiness_test.create', entityId: 'rt-1', payload },
    ]);
    expect(first.accepted).toEqual(['dev_test:r1']);

    const rows = await db.select().from(readinessTestSession);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.best).toBeCloseTo(7.15, 5);
    expect(rows[0]?.attempts).toEqual([6.95, 7.05, 7.15]);
    // The athlete is derived: there is one, and the phone does not send an id.
    expect(rows[0]?.athleteId).toBe('athlete_owner');

    await push([
      {
        id: 'dev_test:r2',
        kind: 'readiness_test.create',
        entityId: 'rt-1',
        payload: { ...payload, attempts: [7.2], best: 7.2 },
      },
    ]);
    const again = await db.select().from(readinessTestSession);
    expect(again).toHaveLength(1);
    expect(again[0]?.best).toBeCloseTo(7.2, 5);
  });

  it('refuses a readiness test with no day or no kind', async () => {
    const response = await push([
      { id: 'dev_test:r3', kind: 'readiness_test.create', entityId: 'rt-2', payload: { unit: 'm' } },
    ]);
    expect(response.accepted).toEqual([]);
    expect(response.rejected[0]?.reason).toBe('invalid_payload');
    expect(await db.select().from(readinessTestSession)).toHaveLength(0);
  });

  it('keeps one readiness outcome a session, and the latest one stands', async () => {
    const base = {
      localDate: '2026-10-22',
      channels: [
        { name: 'autonomic', band: 'unknown' },
        { name: 'neuromuscular', band: 'high' },
      ],
      adjustment: { tierDown: false, holdVolume: false },
      houseRuleId: 'house.sc.readiness_gate',
    };
    await push([
      {
        id: 'dev_test:o1',
        kind: 'readiness_outcome.set',
        entityId: 'session-1',
        payload: { ...base, state: 'both_high', line: 'Both channels read high. As written.' },
      },
    ]);
    await push([
      {
        id: 'dev_test:o2',
        kind: 'readiness_outcome.set',
        entityId: 'session-1',
        payload: { ...base, state: 'neuromuscular_low', line: 'Throw 6.4 m. One tier down.' },
      },
    ]);

    const rows = await db.select().from(readinessOutcome);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('neuromuscular_low');
    expect(rows[0]?.line).toBe('Throw 6.4 m. One tier down.');
    expect(rows[0]?.appliedAt).toBe(CREATED);
  });

  it('lands a single-leg pair with a side on every rep', async () => {
    await push([
      {
        id: 'dev_test:sl1',
        kind: 'jumpTest.single_leg',
        entityId: 'slt-1',
        payload: {
          localDate: '2026-10-13',
          instrument: 'ovr_jump_regular',
          mode: 'single_leg',
          canonical: false,
          attempts: [
            { attemptIndex: 1, heightMm: 455, side: 'left' },
            { attemptIndex: 2, heightMm: 488, side: 'right' },
          ],
        },
      },
    ]);

    const tests = await db.select().from(jumpTestSession).where(eq(jumpTestSession.id, 'slt-1'));
    expect(tests[0]?.mode).toBe('single_leg');
    // Never canonical: a single-leg jump is not the stream the trend is read
    // from (house.sc.asymmetry_tracking).
    expect(tests[0]?.canonical).toBe(false);

    const reps = await db.select().from(jumpRep).where(eq(jumpRep.jumpTestSessionId, 'slt-1'));
    expect(reps.map((rep) => rep.side).sort()).toEqual(['left', 'right']);
  });

  it('carries the climbing answers on an athlete upsert', async () => {
    await push([
      {
        id: 'dev_test:a1',
        kind: 'athlete.upsert',
        entityId: 'athlete_owner',
        payload: {
          sport: 'speed_climbing',
          secondaryGoal: 'upper_body_power',
          fingerHistory: true,
          gripMode: 'open_hand',
          fingerPainCeiling: 3,
          wallWork: { weekdays: [3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
          valgusControl: { required: true, sessionsPerWeek: 2, minHoursFromWall: 6 },
          weakerSide: 'left',
          readinessConfig: { kind: 'seated_mb_throw', metric: 'distance_m', attempts: 3 },
        },
      },
    ]);
    const rows = await db.select().from(athlete).where(eq(athlete.id, 'athlete_owner'));
    expect(rows[0]?.sport).toBe('speed_climbing');
    expect(rows[0]?.gripMode).toBe('open_hand');
    expect(rows[0]?.fingerHistory).toBe(true);
    expect(rows[0]?.weakerSide).toBe('left');
    expect(rows[0]?.wallWork).toMatchObject({ weekdays: [3, 5] });
  });

  it('carries the two wall answers and the best recent set', async () => {
    await push([
      {
        id: 'dev_test:a2',
        kind: 'athlete.upsert',
        entityId: 'athlete_owner',
        payload: {
          sport: 'speed_climbing',
          wallWork: {
            weekdays: [0, 2, 4],
            typicalStart: '18:00',
            typicalEnd: '20:00',
            fingerLoad: 'hard',
            sameDayGapHours: 6,
          },
          sessionWindow: { start: '08:00', end: '10:00' },
          bestSets: {
            box_squat: { reps: 2, loadKg: 138.346, rpe: 8.5, at: '2026-08-31' },
          },
        },
      },
    ]);
    const rows = await db.select().from(athlete).where(eq(athlete.id, 'athlete_owner'));
    expect(rows[0]?.wallWork).toMatchObject({ fingerLoad: 'hard', sameDayGapHours: 6 });
    expect(rows[0]?.sessionWindow).toMatchObject({ start: '08:00', end: '10:00' });
    expect(rows[0]?.bestSets).toMatchObject({
      box_squat: { reps: 2, rpe: 8.5, at: '2026-08-31' },
    });
  });

  it('leaves the best set alone when a patch does not carry one', async () => {
    await push([
      {
        id: 'dev_test:a3',
        kind: 'athlete.upsert',
        entityId: 'athlete_owner',
        payload: { bestSets: { box_squat: { reps: 2, loadKg: 138.346, at: '2026-08-31' } } },
      },
    ]);
    await push([
      {
        id: 'dev_test:a4',
        kind: 'athlete.upsert',
        entityId: 'athlete_owner',
        payload: { bodyweightKg: 68 },
      },
    ]);
    const rows = await db.select().from(athlete).where(eq(athlete.id, 'athlete_owner'));
    expect(rows[0]?.bodyweightKg).toBeCloseTo(68, 5);
    // Additive: a phone a build behind sends no `bestSets` key, and the column
    // it never heard of keeps what the newer build wrote.
    expect(rows[0]?.bestSets).toMatchObject({ box_squat: { reps: 2 } });
  });
});
