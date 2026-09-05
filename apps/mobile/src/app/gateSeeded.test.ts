import { describe, expect, it } from 'vitest';
import { openMigratedTestDb } from '@/data/testing/testDb';
import { seedIfEmpty } from '@/data/fixtures/seed';
import { getAthlete } from '@/data/store/athlete';
import { getCurrentProgram } from '@/data/store/program';
import { getWhoopConnection } from '@/data/store/whoop';
import { decideGate, type GateAthlete } from './gateDecision';

/**
 * The fixture must land on Today, not on setup step two.
 *
 * A fresh browser in `EXPO_PUBLIC_FIXTURE=1` used to open on `/setup/two`: the
 * athlete row was there, the program was not yet, and the gate read the pair
 * before seeding had finished. Seeding now runs inside the DbProvider's open,
 * before the status flips to ready, so by the time the gate can decide the
 * program exists. This asserts the second half of that: a seeded store answers
 * the gate's questions with "ready".
 */

const TODAY = '2026-09-04';
const ZONE = 'America/New_York';

describe('the seeded fixture store', () => {
  it('holds a current program and sends the athlete to the tabs', async () => {
    const db = await openMigratedTestDb();
    const seeded = await seedIfEmpty(db, TODAY, ZONE, 'seed');
    expect(seeded).toBe(true);

    const program = await getCurrentProgram(db);
    expect(program).not.toBeNull();

    const athlete = await getAthlete(db);
    expect(athlete).not.toBeNull();
    const gateAthlete: GateAthlete = {
      clearance: athlete?.clearance ?? null,
      sport: athlete?.sport ?? null,
      daysPerWeek: athlete?.daysPerWeek ?? null,
      weekdays: athlete?.weekdays ?? [],
      goalHeightMm: athlete?.goalHeightMm ?? null,
      targetDate: athlete?.targetDate ?? null,
    };

    expect(
      decideGate({
        dbStatus: 'ready',
        athleteLoaded: true,
        programLoaded: true,
        athlete: gateAthlete,
        hasProgram: program !== null,
      }),
    ).toBe('ready');

    // Ninety days of Whoop mirrors behind a disconnected row would put "Whoop
    // not connected" on Today while the store holds every number it claims to
    // be missing, so the seed writes the connection too.
    const connection = await getWhoopConnection(db);
    expect(connection.status).toBe('connected');
    expect(connection.lastSyncAt).not.toBeNull();

    await db.closeAsync();
  });

  it('never seeds twice over a store that already has an athlete', async () => {
    const db = await openMigratedTestDb();
    expect(await seedIfEmpty(db, TODAY, ZONE, 'seed')).toBe(true);
    expect(await seedIfEmpty(db, TODAY, ZONE, 'seed')).toBe(false);
    expect(await seedIfEmpty(db, TODAY, ZONE, 'empty')).toBe(false);
    await db.closeAsync();
  });
});
