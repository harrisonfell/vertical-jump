import { beforeAll, describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../../data/executor';
import { openMigratedTestDb } from '../../data/testing/testDb';
import { applyFixture } from '../../data/fixtures/seed';
import { buildEngineFixture } from '../../data/fixtures/fromEngine';
import { listSessionExercises, listSessionsByDate } from '../../data/store/sessions';
import { listSetLogs, logSet } from '../../data/store/setLogs';
import { getCurrentProgram } from '../../data/store/program';
import { skeletonWeekCount } from './header';
import { countContacts, footerLeft, plannedSets } from './footer';
import { buildTodaySession, flattenExercises } from './model';
import { exerciseComplete, rowDetail } from './rows';

/**
 * The runner's whole read path, end to end: the engine's owner fixture written
 * through the real repositories, read back as session rows, and merged into the
 * blocks the screen renders. If the seeder's exercise keys and the snapshot's
 * block names ever drift apart, the merge silently loses the landing prompt and
 * the contact counts, and this is what notices.
 */

const TODAY = '2026-10-22';
let db: SqlExecutor;

beforeAll(async () => {
  db = await openMigratedTestDb();
  // The basketball owner, on purpose: these assert the runner's merge machinery
  // against depth jumps and shuttles, which is a basketball week. The app itself
  // now boots the climbing owner (EXPO_PUBLIC_FIXTURE=1); "basketball" is the
  // same fixture this file has always read.
  await applyFixture(db, buildEngineFixture(TODAY, 'UTC', 'basketball'));
});

describe("today's session, read back through the store", () => {
  it('finds the Power + Speed test day on the fixture today', async () => {
    const sessions = await listSessionsByDate(db, TODAY, TODAY);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.dayType).toBe('Power + Speed');
    expect(sessions[0]?.testStatus).toBe('planned');
  });

  it('merges rows and snapshot into the blocks the screen draws', async () => {
    const sessions = await listSessionsByDate(db, TODAY, TODAY);
    const session = sessions[0];
    expect(session).toBeDefined();
    if (session === undefined) return;

    const rows = await listSessionExercises(db, session.id);
    const plan = buildTodaySession(rows, session.snapshot);

    expect(plan.blocks.map((block) => block.name)).toContain('jump_test');
    expect(plan.isTestDay).toBe(true);
    expect(plannedSets(plan)).toBeGreaterThan(20);

    // Every row carries the identity a set log is written against.
    for (const exercise of flattenExercises(plan)) {
      expect(exercise.id).not.toBe('');
      expect(exercise.sets.length).toBeGreaterThan(0);
    }
  });

  it('counts contacts from what was logged, and folds a finished exercise', async () => {
    const sessions = await listSessionsByDate(db, TODAY, TODAY);
    const session = sessions[0];
    if (session === undefined) throw new Error('no session today');

    const rows = await listSessionExercises(db, session.id);
    const plan = buildTodaySession(rows, session.snapshot);
    const depth = flattenExercises(plan).find((entry) => entry.exerciseId === 'depth_jump');
    expect(depth).toBeDefined();
    if (depth === undefined) return;

    for (const set of depth.sets) {
      await logSet(db, {
        sessionId: session.id,
        sessionExerciseId: depth.id,
        setNumber: set.setNumber,
        repsDone: set.reps ?? null,
        plannedDate: session.scheduledDate,
        loggedOnDay: TODAY,
      });
    }

    const logs = await listSetLogs(db, session.id);
    const reps = new Map([
      [
        depth.id,
        new Map(
          logs
            .filter((log) => log.sessionExerciseId === depth.id)
            .map((log) => [log.setNumber, log.repsDone ?? 0]),
        ),
      ],
    ]);

    const tally = countContacts([depth], reps);
    const plannedContacts = depth.sets.reduce(
      (total, set) => total + (set.reps ?? 0) * depth.contactsPerRep,
      0,
    );
    expect(tally.total).toBe(plannedContacts);
    expect(tally.highIntensity).toBe(plannedContacts);

    const logged = new Set(logs.map((log) => log.setNumber));
    expect(exerciseComplete(depth.sets, logged)).toBe(true);

    expect(
      footerLeft({
        setsLogged: logs.length,
        setsPlanned: plannedSets(plan),
        contacts: plan.contacts,
        tally,
      }),
    ).toContain('high-intensity');
  });

  it('reads the week count from the skeleton, not from the weeks written so far', async () => {
    const program = await getCurrentProgram(db);
    expect(program).not.toBeNull();
    expect(skeletonWeekCount(program?.snapshot)).toBe(12);
  });

  it('names a shuttle as a run and carries last time with its loads', async () => {
    const sessions = await listSessionsByDate(db, TODAY, TODAY);
    const session = sessions[0];
    if (session === undefined) throw new Error('no session today');

    const rows = await listSessionExercises(db, session.id);
    const plan = buildTodaySession(rows, session.snapshot);
    const shuttle = flattenExercises(plan).find((entry) => entry.exerciseId === 'shuttle_5_10_5');
    expect(shuttle).toBeDefined();
    if (shuttle === undefined) return;

    expect(shuttle.block).toBe('cod');
    // A shuttle is a run: "1 rep" with the cuts beneath it, never "1 × BW".
    for (const set of shuttle.sets) {
      expect(set.displayLoad).toBe('1 rep');
      expect(rowDetail({ set, bothSides: shuttle.bothSides })).toBe('2 cuts');
    }

    const withLoads = flattenExercises(plan)
      .map((entry) => entry.lastTimeNote)
      .filter((line): line is string => line !== null && line !== '');
    expect(withLoads.length).toBeGreaterThan(0);
    for (const line of withLoads) {
      expect(line.startsWith('last ')).toBe(true);
      expect(line).not.toContain(', ');
    }
  });

  it('stamps the session as started on the first tap, with no Start button', async () => {
    const sessions = await listSessionsByDate(db, TODAY, TODAY);
    expect(sessions[0]?.startedAt).not.toBeNull();
    expect(sessions[0]?.status).toBe('not_finished');
  });
});
