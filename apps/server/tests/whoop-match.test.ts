/**
 * Matching a Whoop workout to a session.
 *
 * The window is the session start minus 30 minutes to its finish plus 30,
 * where the finish is the Finish tap or the last logged set. Maximum overlap
 * wins, then the sport allowlist, then start proximity. These are the same
 * cases the phone's copy of this logic asserts, because the two must never
 * disagree about which workout belongs to which session.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { session, sessionEvent, setLog } from '../src/db/tables/mirror';
import { sessionWorkoutLink, whoopWorkout } from '../src/db/tables/whoop';
import {
  SPORT_ALLOWLIST,
  WINDOW_PAD_MS,
  matchWindow,
  matchWorkout,
  overlapSeconds,
  rankCandidates,
  relinkAroundWorkout,
  relinkSessions,
  sportRank,
  type MatchSession,
  type MatchWorkout,
} from '../src/lib/whoop/match';
import { asDatabase, freshDb, resetDb, setTestEnv, type TestDb } from './support/whoop';

const SESSION: MatchSession = {
  id: 'session-1',
  startedAt: '2026-09-03T18:00:00.000Z',
  markedCompleteAt: '2026-09-03T19:10:00.000Z',
  lastSetAt: '2026-09-03T19:05:00.000Z',
};

function workout(over: Partial<MatchWorkout> = {}): MatchWorkout {
  return {
    id: 'w-1',
    startAt: '2026-09-03T18:02:00.000Z',
    endAt: '2026-09-03T19:08:00.000Z',
    sportName: 'strength trainer',
    ...over,
  };
}

describe('the match window', () => {
  it('runs from half an hour before the start to half an hour after the finish', () => {
    const window = matchWindow(SESSION);
    expect(window?.fromMs).toBe(Date.parse(SESSION.startedAt ?? '') - WINDOW_PAD_MS);
    expect(window?.toMs).toBe(Date.parse('2026-09-03T19:10:00.000Z') + WINDOW_PAD_MS);
  });

  it('falls back to the last logged set when the session was never finished', () => {
    const window = matchWindow({ ...SESSION, markedCompleteAt: null });
    expect(window?.toMs).toBe(Date.parse('2026-09-03T19:05:00.000Z') + WINDOW_PAD_MS);
  });

  it('has no window at all when the session was never started', () => {
    expect(matchWindow({ ...SESSION, startedAt: null })).toBeNull();
  });
});

describe('ranking candidates', () => {
  it('prefers the workout that overlaps the session for longest', () => {
    const long = workout({ id: 'long', startAt: '2026-09-03T18:05:00.000Z', endAt: '2026-09-03T19:05:00.000Z' });
    const short = workout({ id: 'short', startAt: '2026-09-03T18:50:00.000Z', endAt: '2026-09-03T19:00:00.000Z' });
    expect(matchWorkout(SESSION, [short, long])?.workout.id).toBe('long');
  });

  it('breaks a tie on the sport allowlist', () => {
    const start = '2026-09-03T18:10:00.000Z';
    const end = '2026-09-03T19:00:00.000Z';
    const walk = workout({ id: 'walk', startAt: start, endAt: end, sportName: 'walking' });
    const lift = workout({ id: 'lift', startAt: start, endAt: end, sportName: 'weightlifting' });
    const best = matchWorkout(SESSION, [walk, lift]);
    expect(best?.workout.id).toBe('lift');
    expect(best?.sportRank).toBe(SPORT_ALLOWLIST.indexOf('weightlifting'));
  });

  it('breaks a remaining tie on how close the two starts are', () => {
    const near = workout({ id: 'near', startAt: '2026-09-03T18:05:00.000Z', endAt: '2026-09-03T18:55:00.000Z' });
    const far = workout({ id: 'far', startAt: '2026-09-03T18:15:00.000Z', endAt: '2026-09-03T19:05:00.000Z' });
    expect(matchWorkout(SESSION, [far, near])?.workout.id).toBe('near');
  });

  it('ignores a workout that misses the window entirely', () => {
    const morning = workout({ id: 'morning', startAt: '2026-09-03T06:00:00.000Z', endAt: '2026-09-03T07:00:00.000Z' });
    expect(rankCandidates(SESSION, [morning])).toEqual([]);
  });

  it('treats a workout Whoop is still scoring as instantaneous', () => {
    const window = matchWindow(SESSION);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(overlapSeconds(workout({ endAt: null }), window)).toBe(0);
  });

  it('ranks a sport that is not on the list last, but still ranks it', () => {
    expect(sportRank('paddleboarding')).toBe(SPORT_ALLOWLIST.length);
    expect(sportRank(null)).toBe(SPORT_ALLOWLIST.length);
    expect(sportRank('Strength Trainer')).toBe(0);
  });
});

/* ------------------------------------------------------------ the store */

let db: TestDb;

const NOW = new Date('2026-09-05T00:00:00.000Z');

async function addSession(
  id: string,
  scheduledDate: string,
  startedAt: string,
  finishedAt: string | null,
  lastSetAt: string | null,
): Promise<void> {
  await db.insert(session).values({
    id,
    programId: 'program-1',
    weekId: 'week-1',
    scheduledDate,
    dayType: 'lower_power',
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  await db.insert(sessionEvent).values({
    id: `${id}-start`,
    sessionId: id,
    kind: 'start',
    at: startedAt,
    createdAt: startedAt,
  });
  if (finishedAt !== null) {
    await db.insert(sessionEvent).values({
      id: `${id}-finish`,
      sessionId: id,
      kind: 'complete',
      at: finishedAt,
      createdAt: finishedAt,
    });
  }
  if (lastSetAt !== null) {
    await db.insert(setLog).values({
      id: `${id}-log`,
      sessionId: id,
      sessionExerciseId: `${id}-ex`,
      setNumber: 1,
      completedAt: lastSetAt,
      idempotencyKey: `${id}-ex:1`,
      createdAt: lastSetAt,
    });
  }
}

async function addWorkout(
  id: string,
  startAt: string,
  endAt: string,
  sportName: string,
): Promise<void> {
  await db.insert(whoopWorkout).values({
    id,
    scoreState: 'SCORED',
    sportName,
    startAt,
    endAt,
    timezoneOffset: '-04:00',
    localDate: startAt.slice(0, 10),
    raw: { id },
    updatedAt: NOW,
  });
}

async function links(): Promise<Record<string, string>> {
  const rows = await db.select().from(sessionWorkoutLink);
  return Object.fromEntries(rows.map((row) => [row.sessionId, row.whoopWorkoutId]));
}

describe('relinkSessions', () => {
  beforeAll(async () => {
    db = await freshDb();
  }, 60_000);

  beforeEach(async () => {
    setTestEnv();
    await resetDb(db);
  });

  it('links each session to the workout it actually overlaps', async () => {
    await addSession('s-morning', '2026-09-03', '2026-09-03T13:00:00.000Z', '2026-09-03T14:00:00.000Z', null);
    await addSession('s-evening', '2026-09-03', '2026-09-03T18:00:00.000Z', '2026-09-03T19:10:00.000Z', null);
    await addWorkout('w-morning', '2026-09-03T13:05:00.000Z', '2026-09-03T13:55:00.000Z', 'jumping rope');
    await addWorkout('w-evening', '2026-09-03T18:02:00.000Z', '2026-09-03T19:08:00.000Z', 'strength trainer');

    const result = await relinkSessions(asDatabase(db), {
      from: new Date('2026-09-03T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
      now: NOW,
    });

    expect(result.linked).toBe(2);
    expect(await links()).toEqual({ 's-morning': 'w-morning', 's-evening': 'w-evening' });
  });

  it('gives one workout to one session, never to both', async () => {
    // Two sessions half an hour apart, one workout across the pair.
    await addSession('s-first', '2026-09-03', '2026-09-03T18:00:00.000Z', '2026-09-03T18:40:00.000Z', null);
    await addSession('s-second', '2026-09-03', '2026-09-03T18:50:00.000Z', '2026-09-03T19:30:00.000Z', null);
    await addWorkout('w-one', '2026-09-03T18:05:00.000Z', '2026-09-03T18:45:00.000Z', 'strength trainer');

    await relinkSessions(asDatabase(db), {
      from: new Date('2026-09-03T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
      now: NOW,
    });

    const rows = await db.select().from(sessionWorkoutLink);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe('s-first');
  });

  it('never touches a link the owner made by hand', async () => {
    await addSession('s-1', '2026-09-03', '2026-09-03T18:00:00.000Z', '2026-09-03T19:10:00.000Z', null);
    await addWorkout('w-auto', '2026-09-03T18:02:00.000Z', '2026-09-03T19:08:00.000Z', 'strength trainer');
    await addWorkout('w-manual', '2026-09-03T18:40:00.000Z', '2026-09-03T18:50:00.000Z', 'other');
    await db.insert(sessionWorkoutLink).values({
      sessionId: 's-1',
      whoopWorkoutId: 'w-manual',
      matchSource: 'manual',
      overlapS: 600,
      linkedAt: '2026-09-03T20:00:00.000Z',
      updatedAt: NOW,
    });

    const result = await relinkSessions(asDatabase(db), {
      from: new Date('2026-09-03T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
      now: NOW,
    });

    expect(result.linked).toBe(0);
    expect((await links())['s-1']).toBe('w-manual');
  });

  it('drops an automatic link once the workout it named is gone', async () => {
    await addSession('s-1', '2026-09-03', '2026-09-03T18:00:00.000Z', '2026-09-03T19:10:00.000Z', null);
    await db.insert(sessionWorkoutLink).values({
      sessionId: 's-1',
      whoopWorkoutId: 'w-vanished',
      matchSource: 'auto',
      overlapS: 3600,
      linkedAt: '2026-09-03T20:00:00.000Z',
      updatedAt: NOW,
    });

    const result = await relinkSessions(asDatabase(db), {
      from: new Date('2026-09-03T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
      now: NOW,
    });

    expect(result.unlinked).toBe(1);
    expect(await db.select().from(sessionWorkoutLink)).toHaveLength(0);
  });

  it('leaves a session with no logs alone, however close the workout is', async () => {
    await db.insert(session).values({
      id: 's-untouched',
      programId: 'program-1',
      weekId: 'week-1',
      scheduledDate: '2026-09-03',
      dayType: 'lower_power',
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    });
    await addWorkout('w-1', '2026-09-03T18:02:00.000Z', '2026-09-03T19:08:00.000Z', 'strength trainer');

    const result = await relinkSessions(asDatabase(db), {
      from: new Date('2026-09-03T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
      now: NOW,
    });

    expect(result.linked).toBe(0);
    expect(await db.select().from(sessionWorkoutLink)).toHaveLength(0);
  });

  it('uses the last logged set when the session was never finished', async () => {
    await addSession('s-1', '2026-09-03', '2026-09-03T18:00:00.000Z', null, '2026-09-03T19:05:00.000Z');
    await addWorkout('w-1', '2026-09-03T18:02:00.000Z', '2026-09-03T19:08:00.000Z', 'strength trainer');

    await relinkAroundWorkout(asDatabase(db), 'w-1', NOW);

    const rows = await db.select().from(sessionWorkoutLink);
    expect(rows[0]?.sessionId).toBe('s-1');
    expect(rows[0]?.overlapS).toBeGreaterThan(3600);
    expect(rows[0]?.matchSource).toBe('auto');
  });
});
