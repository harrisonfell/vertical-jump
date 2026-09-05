/**
 * Webhooks: verified on the raw bytes, deduped on the trace id, applied once.
 *
 * Whoop retries five times over an hour, so the second delivery of a trace it
 * has already applied must change nothing. A delivery that failed before it
 * was applied is a different case: that one is allowed through again, because
 * refusing it would lose the event for good.
 */

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WHOOP_CONNECTION_ID,
  sessionWorkoutLink,
  webhookEvent,
  whoopConnection,
  whoopMirrorDeletion,
  whoopRecovery,
  whoopSleep,
  whoopWorkout,
} from '../src/db/tables/whoop';
import { session } from '../src/db/tables/mirror';
import { encryptToken, whoopSignature } from '../src/lib/crypto';
import { WEBHOOK_MAX_AGE_MS, handleWebhookEvent, verifyWebhook } from '../src/lib/whoop/webhook';
import {
  TEST_ENCRYPTION_KEY,
  asDatabase,
  freshDb,
  resetDb,
  setTestEnv,
  type TestDb,
} from './support/whoop';

let db: TestDb;

const NOW = new Date('2026-09-05T00:00:00.000Z');
const SECRET = 'test-client-secret';

/** The two records the recorded fixtures name, so a fetch can resolve them. */
const WORKOUT_ID = '2f7c1e40-9b6a-4d31-8f52-0ac9e7b31d68';
const SLEEP_ID = 'b4f0b8a2-1d2c-4f6e-9d5a-7c3e21ab90f4';
const CYCLE_ID = '93845123';

function headersFor(rawBody: string, timestamp = String(NOW.getTime())): Headers {
  return new Headers({
    'x-whoop-signature': whoopSignature(timestamp, rawBody, SECRET),
    'x-whoop-signature-timestamp': timestamp,
  });
}

async function seedConnected(): Promise<void> {
  await db.insert(whoopConnection).values({
    id: WHOOP_CONNECTION_ID,
    status: 'connected',
    whoopUserId: '100427',
    accessTokenCipher: encryptToken('access-live', TEST_ENCRYPTION_KEY),
    refreshTokenCipher: encryptToken('refresh-live', TEST_ENCRYPTION_KEY),
    expiresAt: new Date(NOW.getTime() + 3600_000),
    connectedAt: new Date('2026-08-01T07:00:00.000Z'),
    updatedAt: NOW,
  });
}

beforeAll(async () => {
  db = await freshDb();
}, 60_000);

beforeEach(async () => {
  setTestEnv({ WHOOP_FIXTURE: '1' });
  await resetDb(db);
  await seedConnected();
});

describe('verifyWebhook', () => {
  const body = '{"user_id":100427,"id":"abc","type":"workout.updated","trace_id":"t-1"}';

  it('accepts a signature over timestamp then raw body', () => {
    expect(verifyWebhook(body, headersFor(body), SECRET, NOW)).toEqual({ ok: true, reason: 'ok' });
  });

  it('refuses a body that has been altered by one character', () => {
    const headers = headersFor(body);
    const tampered = body.replace('100427', '100428');
    expect(verifyWebhook(tampered, headers, SECRET, NOW).reason).toBe('bad_signature');
  });

  it('refuses a signature made with another secret', () => {
    const headers = new Headers({
      'x-whoop-signature': whoopSignature(String(NOW.getTime()), body, 'someone-else'),
      'x-whoop-signature-timestamp': String(NOW.getTime()),
    });
    expect(verifyWebhook(body, headers, SECRET, NOW).reason).toBe('bad_signature');
  });

  it('refuses a delivery older than five minutes, so a capture cannot replay', () => {
    const old = String(NOW.getTime() - WEBHOOK_MAX_AGE_MS - 1000);
    expect(verifyWebhook(body, headersFor(body, old), SECRET, NOW).reason).toBe('stale');
  });

  it('refuses a delivery with no signature headers at all', () => {
    expect(verifyWebhook(body, new Headers(), SECRET, NOW).reason).toBe('missing_headers');
  });
});

describe('handleWebhookEvent', () => {
  it('upserts the workout an event names', async () => {
    const result = await handleWebhookEvent(
      asDatabase(db),
      { user_id: 100427, id: WORKOUT_ID, type: 'workout.updated', trace_id: 'trace-w1' },
      NOW,
    );

    expect(result).toEqual({ applied: true, duplicate: false });
    const rows = await db.select().from(whoopWorkout).where(eq(whoopWorkout.id, WORKOUT_ID));
    expect(rows[0]?.sportName).toBe('strength trainer');
    expect(rows[0]?.strain).toBeCloseTo(11.2043, 3);
    expect(rows[0]?.localDate).toBe('2026-09-03');
  });

  it('applies a trace once, however many times Whoop retries it', async () => {
    const event = {
      user_id: 100427,
      id: WORKOUT_ID,
      type: 'workout.updated' as const,
      trace_id: 'trace-w2',
    };
    const first = await handleWebhookEvent(asDatabase(db), event, NOW);
    const second = await handleWebhookEvent(asDatabase(db), event, NOW);
    const third = await handleWebhookEvent(asDatabase(db), event, NOW);

    expect(first).toEqual({ applied: true, duplicate: false });
    expect(second).toEqual({ applied: false, duplicate: true });
    expect(third).toEqual({ applied: false, duplicate: true });

    const ledger = await db.select().from(webhookEvent);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.processedAt).not.toBeNull();
  });

  it('resolves a recovery through its sleep to its cycle', async () => {
    // A v2 recovery event carries the sleep UUID, never the cycle id.
    const result = await handleWebhookEvent(
      asDatabase(db),
      { user_id: 100427, id: SLEEP_ID, type: 'recovery.updated', trace_id: 'trace-r1' },
      NOW,
    );

    expect(result.applied).toBe(true);
    const sleeps = await db.select().from(whoopSleep).where(eq(whoopSleep.id, SLEEP_ID));
    expect(sleeps[0]?.cycleId).toBe(CYCLE_ID);

    const recoveries = await db.select().from(whoopRecovery);
    expect(recoveries).toHaveLength(1);
    // Keyed on the cycle, which is the natural key of a v2 recovery: keying on
    // the sleep id when there was one made the same physiological day two rows
    // as soon as one delivery arrived without it.
    expect(recoveries[0]?.id).toBe(CYCLE_ID);
    expect(recoveries[0]?.sleepId).toBe(SLEEP_ID);
    expect(recoveries[0]?.cycleId).toBe(CYCLE_ID);
    expect(recoveries[0]?.recoveryScore).toBe(71);
  });

  it('uses the sleep it already holds rather than asking Whoop again', async () => {
    await handleWebhookEvent(
      asDatabase(db),
      { user_id: 100427, id: SLEEP_ID, type: 'sleep.updated', trace_id: 'trace-s1' },
      NOW,
    );
    const result = await handleWebhookEvent(
      asDatabase(db),
      { user_id: 100427, id: SLEEP_ID, type: 'recovery.updated', trace_id: 'trace-r2' },
      NOW,
    );
    expect(result.applied).toBe(true);
    expect((await db.select().from(whoopRecovery))[0]?.cycleId).toBe(CYCLE_ID);
  });

  it('deletes a workout, unlinks its session, and leaves a tombstone', async () => {
    await handleWebhookEvent(
      asDatabase(db),
      { user_id: 100427, id: WORKOUT_ID, type: 'workout.updated', trace_id: 'trace-w3' },
      NOW,
    );
    await db.insert(session).values({
      id: 'session-1',
      programId: 'program-1',
      weekId: 'week-1',
      scheduledDate: '2026-09-03',
      dayType: 'lower_power',
      createdAt: '2026-09-03T12:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    });
    await db.insert(sessionWorkoutLink).values({
      sessionId: 'session-1',
      whoopWorkoutId: WORKOUT_ID,
      matchSource: 'auto',
      overlapS: 4475,
      linkedAt: '2026-09-03T19:30:00.000Z',
      updatedAt: NOW,
    });

    const result = await handleWebhookEvent(
      asDatabase(db),
      { user_id: 100427, id: WORKOUT_ID, type: 'workout.deleted', trace_id: 'trace-w4' },
      NOW,
    );

    expect(result.applied).toBe(true);
    expect(await db.select().from(whoopWorkout)).toHaveLength(0);
    expect(await db.select().from(sessionWorkoutLink)).toHaveLength(0);

    const tombstones = await db.select().from(whoopMirrorDeletion);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]?.kind).toBe('workout');
    expect(tombstones[0]?.id).toBe(WORKOUT_ID);
  });

  it('lets a delivery that failed before it applied through again', async () => {
    const event = {
      user_id: 100427,
      id: 'not-a-recorded-workout',
      type: 'workout.updated' as const,
      trace_id: 'trace-w5',
    };
    await expect(handleWebhookEvent(asDatabase(db), event, NOW)).rejects.toThrow();

    const failedRow = await db.select().from(webhookEvent);
    expect(failedRow[0]?.processedAt).toBeNull();
    expect(failedRow[0]?.error).not.toBeNull();

    // The retry is not treated as a duplicate, because it never applied.
    await expect(handleWebhookEvent(asDatabase(db), event, NOW)).rejects.toThrow();
  });
});
