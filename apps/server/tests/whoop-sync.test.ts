/**
 * The 90 day backfill, chunked and resumable, against the recorded fixtures.
 *
 * Whoop has no sandbox, so the fixtures are the wrist: 90 cycles, 90 sleeps,
 * 90 recoveries and 20 workouts, paged 25 at a time exactly as the real API
 * pages them. A call bounded to four pages therefore cannot finish, which is
 * the whole point: the cursor is the progress and a cancelled sync loses
 * nothing.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WHOOP_CONNECTION_ID,
  whoopConnection,
  whoopCycle,
  whoopMirrorDeletion,
  whoopRecovery,
  whoopSleep,
  whoopWorkout,
} from '../src/db/tables/whoop';
import { encryptToken } from '../src/lib/crypto';
import { deleteWhoopMirrors, disconnectWhoop, readWhoopStatus, runWhoopSync } from '../src/lib/whoop/sync';
import {
  TEST_ENCRYPTION_KEY,
  asDatabase,
  freshDb,
  jsonResponse,
  resetDb,
  setTestEnv,
  stubFetch,
  type FetchStub,
  type TestDb,
} from './support/whoop';

let db: TestDb;
let stub: FetchStub | null = null;

/** The day after the newest recorded cycle, so the window covers all 90. */
const NOW = new Date('2026-09-05T00:00:00.000Z');

async function seedConnected(): Promise<void> {
  await db.insert(whoopConnection).values({
    id: WHOOP_CONNECTION_ID,
    status: 'importing',
    whoopUserId: '100427',
    accessTokenCipher: encryptToken('access-live', TEST_ENCRYPTION_KEY),
    refreshTokenCipher: encryptToken('refresh-live', TEST_ENCRYPTION_KEY),
    expiresAt: new Date(NOW.getTime() + 3600_000),
    scopes: 'offline',
    connectedAt: new Date('2026-09-04T20:00:00.000Z'),
    backfillDaysTotal: 90,
    updatedAt: NOW,
  });
}

async function count(table: typeof whoopCycle | typeof whoopRecovery | typeof whoopSleep | typeof whoopWorkout): Promise<number> {
  const rows = await db.select({ id: table.id }).from(table);
  return rows.length;
}

async function connectionRow() {
  const rows = await db
    .select()
    .from(whoopConnection)
    .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));
  const row = rows[0];
  if (row === undefined) throw new Error('no connection row');
  return row;
}

beforeAll(async () => {
  db = await freshDb();
}, 60_000);

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe('runWhoopSync in fixture mode', () => {
  beforeEach(async () => {
    setTestEnv({ WHOOP_FIXTURE: '1' });
    await resetDb(db);
    await seedConnected();
  });

  it('stops on the page budget and comes back where it left off', async () => {
    const first = await runWhoopSync(asDatabase(db), { now: NOW, maxPages: 4 });

    expect(first.done).toBe(false);
    expect(first.status).toBe('importing');
    // Four pages of 25 finish the cycles and nothing else.
    expect(first.imported).toBe(90);
    expect(first.nextCursor).toBe('sleep');
    expect(await count(whoopCycle)).toBe(90);
    expect(await count(whoopSleep)).toBe(0);

    const row = await connectionRow();
    expect(row.backfillCursor).not.toBeNull();
    expect(row.lastSyncAt).toBeNull();

    const second = await runWhoopSync(asDatabase(db), { now: NOW, maxPages: 4 });
    expect(second.done).toBe(false);
    expect(await count(whoopSleep)).toBe(90);
    // The window is the cursor's, not a fresh one: the same 90 days continue.
    expect(second.backfillDaysDone).toBe(90);
  });

  it('finishes the backfill over several calls and then reports connected', async () => {
    let result = await runWhoopSync(asDatabase(db), { now: NOW, maxPages: 4 });
    let calls = 1;
    while (!result.done && calls < 10) {
      result = await runWhoopSync(asDatabase(db), { now: NOW, maxPages: 4 });
      calls += 1;
    }

    expect(result.done).toBe(true);
    expect(result.status).toBe('connected');
    expect(result.nextCursor).toBeNull();
    expect(result.backfillDaysDone).toBe(90);
    expect(result.backfillDaysTotal).toBe(90);
    expect(result.lastSyncAt).toBe(NOW.toISOString());

    expect(await count(whoopCycle)).toBe(90);
    expect(await count(whoopSleep)).toBe(90);
    expect(await count(whoopRecovery)).toBe(90);
    expect(await count(whoopWorkout)).toBe(20);

    const row = await connectionRow();
    expect(row.backfillCursor).toBeNull();
  });

  it('keeps an unscored day as a gap rather than a zero', async () => {
    let result = await runWhoopSync(asDatabase(db), { now: NOW });
    while (!result.done) result = await runWhoopSync(asDatabase(db), { now: NOW });

    const pending = await db
      .select()
      .from(whoopRecovery)
      .where(eq(whoopRecovery.scoreState, 'PENDING_SCORE'));
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]?.recoveryScore).toBeNull();
    expect(pending[0]?.hrvRmssdMilli).toBeNull();

    const calibrating = await db
      .select()
      .from(whoopRecovery)
      .where(eq(whoopRecovery.userCalibrating, true));
    expect(calibrating).toHaveLength(3);
  });

  it('re-running a finished sync writes no duplicates', async () => {
    let result = await runWhoopSync(asDatabase(db), { now: NOW });
    while (!result.done) result = await runWhoopSync(asDatabase(db), { now: NOW });

    const again = await runWhoopSync(asDatabase(db), { now: new Date(NOW.getTime() + 3600_000) });
    expect(again.done).toBe(true);
    expect(await count(whoopCycle)).toBe(90);
    expect(await count(whoopRecovery)).toBe(90);
  });

  it('deletes every mirror and leaves a tombstone for the phone', async () => {
    let result = await runWhoopSync(asDatabase(db), { now: NOW });
    while (!result.done) result = await runWhoopSync(asDatabase(db), { now: NOW });

    const deleted = await deleteWhoopMirrors(asDatabase(db), NOW);
    expect(deleted).toEqual({ cycles: 90, recoveries: 90, sleeps: 90, workouts: 20 });
    expect(await count(whoopCycle)).toBe(0);

    const tombstones = await db.select().from(whoopMirrorDeletion);
    expect(tombstones).toHaveLength(290);

    // The connection survives a data deletion; only /disconnect ends it.
    expect((await readWhoopStatus(asDatabase(db))).status).toBe('connected');
  });

  it('forgets the token pair on disconnect', async () => {
    const status = await disconnectWhoop(asDatabase(db), NOW);
    expect(status.status).toBe('disconnected');
    expect(status.whoopUserId).toBeNull();

    const row = await connectionRow();
    expect(row.accessTokenCipher).toBeNull();
    expect(row.refreshTokenCipher).toBeNull();

    // With nothing to refresh, a sync is a no-op rather than an error.
    const result = await runWhoopSync(asDatabase(db), { now: NOW });
    expect(result.status).toBe('disconnected');
    expect(result.imported).toBe(0);
    expect(result.done).toBe(true);
  });
});

describe('runWhoopSync against a failing Whoop', () => {
  beforeEach(async () => {
    setTestEnv();
    await resetDb(db);
    await seedConnected();
  });

  it('persists the rate limit as the instant of the next attempt', async () => {
    stub = stubFetch(() =>
      jsonResponse({ error: 'too_many_requests' }, 429, { 'retry-after': '120' }),
    );

    const result = await runWhoopSync(asDatabase(db), { now: NOW });

    expect(result.status).toBe('error');
    expect(result.lastError).toBe('rate_limited');
    expect(result.nextRetryAt).toBe(new Date(NOW.getTime() + 120_000).toISOString());
    expect(result.done).toBe(false);
    expect(result.nextCursor).toBe('cycle');

    const row = await connectionRow();
    expect(row.lastError).toBe('rate_limited');
    expect(row.nextRetryAt?.toISOString()).toBe(new Date(NOW.getTime() + 120_000).toISOString());
  });

  it('reports an unwell Whoop as weather, with an instant to retry at', async () => {
    stub = stubFetch(() => jsonResponse({ error: 'oops' }, 503));

    const result = await runWhoopSync(asDatabase(db), { now: NOW });

    expect(result.lastError).toBe('api_down');
    expect(result.status).toBe('error');
    expect(result.nextRetryAt).not.toBeNull();
  });

  it('turns a rejected token into a reconnect, not a retry loop', async () => {
    stub = stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401));

    const result = await runWhoopSync(asDatabase(db), { now: NOW });

    expect(result.status).toBe('revoked');
    expect(result.lastError).toBe('needs_reauth');
    expect(result.nextRetryAt).toBeNull();
  });
});
