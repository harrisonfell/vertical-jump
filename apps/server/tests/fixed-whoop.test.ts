/**
 * The Whoop contract-fidelity probes, kept as the regression suite.
 *
 * Every test here was written to pin a divergence from the documented v2 API
 * and is now written to pin the fix. The comments say what the behaviour used
 * to be, because that is what a reader cannot see from the code.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API, AUTH, WHOOP_START_TOKEN_PARAM } from '../src/lib/api-contract';
import {
  WHOOP_CONNECTION_ID,
  whoopConnection,
  whoopCycle,
  whoopRecovery,
} from '../src/db/tables/whoop';
import { encryptToken } from '../src/lib/crypto';
import { setDatabaseForTests } from '../src/lib/routes/db';
import { WHOOP_TOKEN_URL, retryAt } from '../src/lib/whoop/api';
import { upsertCycles, upsertRecoveries } from '../src/lib/whoop/mirrors';
import { toCycleRow, toRecoveryRow, type RecoveryV2 } from '../src/lib/whoop/records';
import { revokeWhoop, runWhoopSync } from '../src/lib/whoop/sync';
import {
  TEST_ENCRYPTION_KEY,
  asDatabase,
  freshDb,
  jsonResponse,
  resetDb,
  setTestEnv,
  stubFetch,
  tokenBody,
  type FetchStub,
  type TestDb,
} from './support/whoop';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');

let db: TestDb;
let stub: FetchStub | null = null;

const NOW = new Date('2026-09-05T00:00:00.000Z');

async function seedConnected(expiresAt: Date = new Date(NOW.getTime() + 3_600_000)): Promise<void> {
  await db.insert(whoopConnection).values({
    id: WHOOP_CONNECTION_ID,
    status: 'importing',
    whoopUserId: '100427',
    accessTokenCipher: encryptToken('access-live', TEST_ENCRYPTION_KEY),
    refreshTokenCipher: encryptToken('refresh-live', TEST_ENCRYPTION_KEY),
    expiresAt,
    scopes: 'offline',
    connectedAt: new Date('2026-09-04T20:00:00.000Z'),
    backfillDaysTotal: 90,
    updatedAt: NOW,
  });
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

/** A v2 cycle page, shaped the way Whoop shapes one. */
function cyclePage(ids: readonly number[], nextToken: string | null): Record<string, unknown> {
  return {
    records: ids.map((id) => ({
      id,
      user_id: 100427,
      start: '2026-09-01T10:00:00.000Z',
      end: '2026-09-02T10:00:00.000Z',
      timezone_offset: '-04:00',
      score_state: 'SCORED',
      score: { strain: 11.2, kilojoule: 8000, average_heart_rate: 62, max_heart_rate: 170 },
    })),
    next_token: nextToken,
  };
}

beforeAll(async () => {
  db = await freshDb();
}, 60_000);

beforeEach(async () => {
  await resetDb(db);
  setTestEnv();
  setDatabaseForTests(asDatabase(db));
});

afterEach(() => {
  stub?.restore();
  stub = null;
  setDatabaseForTests(null);
});

/* ------------------------------------------------------------------ 1 */

describe('the phone start ticket', () => {
  it('has a contract path, a route handler, and a start route that reads it', async () => {
    expect(API.whoopStartToken).toBe('/api/whoop/start-token');
    expect(AUTH['/api/whoop/start-token']).toBe('bearer');
    // The handler the app client posts to before it opens the auth session.
    // It did not exist, so the phone could never connect Whoop at all.
    expect(existsSync(join(serverRoot, 'src/app/api/whoop/start-token/route.ts'))).toBe(true);

    const source = readFileSync(join(serverRoot, 'src/app/api/whoop/start/route.ts'), 'utf8');
    expect(source.includes('WHOOP_START_TOKEN_PARAM')).toBe(true);
    expect(WHOOP_START_TOKEN_PARAM).toBe('t');

    const { GET } = await import('../src/app/api/whoop/start/route');
    const url =
      'https://vert.example/api/whoop/start?redirect=vert%3A%2F%2Fwhoop%2Fconnected' +
      '&response=json&t=' +
      'a'.repeat(43);
    const response = await GET(new Request(url) as unknown as NextRequest);
    // A ticket nobody minted is still refused; the credential is real, not the
    // mere presence of the parameter.
    expect(response.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ 2 */

describe('recovery local date', () => {
  /** The v2 Recovery model, verbatim: no timezone_offset field exists on it. */
  const realRecovery = {
    cycle_id: '93851907',
    sleep_id: 'c81d9e77-3a55-4a11-b0f3-2d4c6e8f1a02',
    user_id: 100427,
    created_at: '2026-09-04T02:30:00.000Z',
    updated_at: '2026-09-04T02:40:00.000Z',
    score_state: 'SCORED',
    score: { user_calibrating: false, recovery_score: 71, resting_heart_rate: 48 },
  } as unknown as RecoveryV2;

  const itsCycle = {
    id: '93851907',
    start: '2026-09-04T02:00:00.000Z',
    end: null,
    timezone_offset: '-04:00',
    score_state: 'SCORED',
  } as never;

  it('borrows the cycle offset, so both mirrors name the same day', async () => {
    await upsertCycles(asDatabase(db), [toCycleRow(itsCycle, NOW.toISOString())]);
    await upsertRecoveries(asDatabase(db), [toRecoveryRow(realRecovery, NOW.toISOString())]);

    const cycles = await db.select().from(whoopCycle);
    const recoveries = await db.select().from(whoopRecovery);
    // 02:30Z at -04:00 is 22:30 on the third, local. Deriving the recovery's
    // date from created_at alone filed it on the fourth while its own cycle
    // filed itself on the third, and the readiness match read the wrong one.
    expect(cycles[0]?.localDate).toBe('2026-09-03');
    expect(recoveries[0]?.localDate).toBe('2026-09-03');
    expect(recoveries[0]?.timezoneOffset).toBe('-04:00');
  });

  it('moves a recovery onto the right day when its cycle lands afterwards', async () => {
    await upsertRecoveries(asDatabase(db), [toRecoveryRow(realRecovery, NOW.toISOString())]);
    const guessed = await db.select().from(whoopRecovery);
    // With nothing to borrow from, the UTC date is a placeholder, not a claim.
    expect(guessed[0]?.localDate).toBe('2026-09-04');
    expect(guessed[0]?.timezoneOffset).toBeNull();

    await upsertCycles(asDatabase(db), [toCycleRow(itsCycle, NOW.toISOString())]);
    const corrected = await db.select().from(whoopRecovery);
    expect(corrected[0]?.localDate).toBe('2026-09-03');
    expect(corrected[0]?.timezoneOffset).toBe('-04:00');
    // It also moves in the feed, so the phone is told about the correction.
    expect(corrected[0]?.feedSeq).toBeGreaterThan(guessed[0]?.feedSeq ?? 0);
  });

  it('has fixtures that carry only the fields the v2 API returns', () => {
    const fixture = JSON.parse(
      readFileSync(join(serverRoot, 'fixtures/whoop/recovery.json'), 'utf8'),
    ) as { records: Record<string, unknown>[] };
    // Every record used to carry an invented `timezone_offset`, which is what
    // made the old recovery tests pass and hid the UTC date above.
    for (const record of fixture.records) {
      expect(Object.keys(record)).not.toContain('timezone_offset');
    }
  });
});

/* ------------------------------------------------------------------ 3 */

describe('a 403 from a data endpoint', () => {
  it('refreshes once and retries rather than throwing the grant away', async () => {
    await seedConnected();
    let cycleCalls = 0;
    stub = stubFetch((call) => {
      if (call.url === WHOOP_TOKEN_URL) return jsonResponse(tokenBody('rotated'));
      if (call.url.includes('/v2/cycle')) {
        cycleCalls += 1;
        if (cycleCalls === 1) return jsonResponse({ message: 'insufficient scope' }, 403);
        return jsonResponse({ records: [], next_token: null });
      }
      return jsonResponse({ records: [], next_token: null });
    });

    const result = await runWhoopSync(asDatabase(db), { now: NOW });

    const row = await connectionRow();
    // Only a 400 from the token endpoint means the grant is gone. A 401 or a
    // 403 from a data endpoint used to delete the refresh token and mark the
    // connection revoked, forcing a reconnect a refresh would have avoided.
    expect(row.refreshTokenCipher).not.toBeNull();
    expect(row.status).not.toBe('revoked');
    expect(result.lastError).not.toBe('needs_reauth');
    expect(stub.calls.some((call) => call.url === WHOOP_TOKEN_URL)).toBe(true);
  }, 30_000);

  it('keeps the refresh token even when the retry fails too', async () => {
    await seedConnected();
    stub = stubFetch((call) => {
      if (call.url === WHOOP_TOKEN_URL) return jsonResponse(tokenBody('rotated'));
      return jsonResponse({ message: 'insufficient scope' }, 403);
    });

    const result = await runWhoopSync(asDatabase(db), { now: NOW });
    expect(result.lastError).toBe('api_down');
    const row = await connectionRow();
    expect(row.refreshTokenCipher).not.toBeNull();
    expect(row.status).toBe('error');
  }, 30_000);
});

/* ------------------------------------------------------------------ 4 */

describe('revoke', () => {
  it('refreshes the access token before spending it on the DELETE', async () => {
    // An access token lives 3600 s; the owner presses Revoke hours later.
    await seedConnected(new Date(NOW.getTime() - 3_600_000));
    const seen: string[] = [];
    stub = stubFetch((call) => {
      seen.push(call.url);
      if (call.url === WHOOP_TOKEN_URL) return jsonResponse(tokenBody('rotated'));
      if (call.url.includes('/v2/user/access')) return new Response(null, { status: 204 });
      throw new Error(`unexpected call ${call.url}`);
    });

    const status = await revokeWhoop(asDatabase(db), NOW);

    // It used to send the stored access token straight off the row, take the
    // 401, swallow it, and still report a clean revoke while Whoop kept the
    // grant. The pair now rotates under the row lock first.
    expect(seen[0]).toBe(WHOOP_TOKEN_URL);
    expect(seen.some((url) => url.includes('/v2/user/access'))).toBe(true);
    expect(status.status).toBe('revoked');
    expect(status.lastError).toBeNull();
    expect((await connectionRow()).refreshTokenCipher).toBeNull();
  }, 30_000);

  it('says so when Whoop may still hold the grant', async () => {
    await seedConnected(new Date(NOW.getTime() - 3_600_000));
    stub = stubFetch((call) => {
      if (call.url === WHOOP_TOKEN_URL) return jsonResponse(tokenBody('rotated'));
      return jsonResponse({ message: 'Unauthorized' }, 401);
    });

    const status = await revokeWhoop(asDatabase(db), NOW);
    // The tokens go either way, but the status is honest about the failure
    // rather than promising a revoke that did not happen.
    expect(status.status).toBe('revoked');
    expect(status.lastError).toBe('api_down');
  }, 30_000);
});

/* ------------------------------------------------------------------ 5 */

describe('a 429 in the middle of a chunk', () => {
  it('keeps the pages this call already walked', async () => {
    await seedConnected();
    let cyclePages = 0;
    stub = stubFetch((call) => {
      if (!call.url.includes('/v2/cycle')) throw new Error(`unexpected call ${call.url}`);
      cyclePages += 1;
      if (cyclePages === 1) return jsonResponse(cyclePage([1, 2, 3], '25'));
      return jsonResponse({ message: 'rate limited' }, 429, { 'retry-after': '42' });
    });

    const result = await runWhoopSync(asDatabase(db), { now: NOW });
    expect(result.lastError).toBe('rate_limited');
    expect(result.nextRetryAt).toBe(new Date(NOW.getTime() + 42_000).toISOString());
    expect(await db.select({ id: whoopCycle.id }).from(whoopCycle)).toHaveLength(3);

    // The cursor used to be advanced in memory only, so a rate limit on page
    // three made the next attempt re-fetch pages one and two: exactly the
    // wrong answer to being rate limited.
    const row = await connectionRow();
    expect(row.backfillCursor).not.toBeNull();
    expect(JSON.parse(row.backfillCursor ?? '{}')).toMatchObject({ tokens: { cycle: '25' } });

    stub.restore();
    let secondRunFirstUrl = '';
    stub = stubFetch((call) => {
      if (secondRunFirstUrl === '') secondRunFirstUrl = call.url;
      return jsonResponse({ records: [], next_token: null });
    });
    await db
      .update(whoopConnection)
      .set({ status: 'importing', lastError: null, nextRetryAt: null })
      .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));
    await runWhoopSync(asDatabase(db), { now: NOW });
    expect(secondRunFirstUrl).toContain('/v2/cycle');
    expect(secondRunFirstUrl).toContain('nextToken=25');
  }, 30_000);

  it('honours an HTTP-date Retry-After, which RFC 9110 allows', async () => {
    const named = new Date('2026-09-05T00:30:00.000Z');
    expect(retryAt('Sat, 05 Sep 2026 00:30:00 GMT', NOW)).toBe(named.toISOString());
    expect(retryAt('42', NOW)).toBe(new Date(NOW.getTime() + 42_000).toISOString());
    // Neither form: a minute is the honest default.
    expect(retryAt('nonsense', NOW)).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(retryAt(null, NOW)).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    // A date already in the past does not name an instant worth waiting for.
    expect(retryAt('Fri, 04 Sep 2026 00:30:00 GMT', NOW)).toBe(
      new Date(NOW.getTime() + 60_000).toISOString(),
    );
  });
});

/* ------------------------------------------------------------------ 6 */

describe('the recovery mirror key', () => {
  it('keeps one row per cycle however late the sleep id arrives', async () => {
    const base = {
      cycle_id: '93851907',
      user_id: 100427,
      created_at: '2026-09-04T10:00:00.000Z',
      score_state: 'PENDING_SCORE',
    };
    const pending = toRecoveryRow({ ...base } as unknown as RecoveryV2, NOW.toISOString());
    const scored = toRecoveryRow(
      {
        ...base,
        sleep_id: 'c81d9e77-3a55-4a11-b0f3-2d4c6e8f1a02',
        score_state: 'SCORED',
        score: { user_calibrating: false, recovery_score: 71 },
      } as unknown as RecoveryV2,
      NOW.toISOString(),
    );
    // Keyed on `sleep_id ?? cycle_id`, the same physiological day became two
    // rows and the phone was handed two recoveries for one day.
    expect(pending.id).toBe('93851907');
    expect(scored.id).toBe('93851907');

    await upsertRecoveries(asDatabase(db), [pending]);
    await upsertRecoveries(asDatabase(db), [scored]);
    const rows = await db.select().from(whoopRecovery);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '93851907',
      cycleId: '93851907',
      sleepId: 'c81d9e77-3a55-4a11-b0f3-2d4c6e8f1a02',
      recoveryScore: 71,
    });
  }, 30_000);

  it('leaves an unknown calibration state unknown', () => {
    const row = toRecoveryRow(
      {
        cycle_id: '93851907',
        sleep_id: 'c81d9e77-3a55-4a11-b0f3-2d4c6e8f1a02',
        created_at: '2026-09-04T10:00:00.000Z',
        score_state: 'PENDING_SCORE',
      } as unknown as RecoveryV2,
      NOW.toISOString(),
    );
    expect(row.scoreState).toBe('PENDING_SCORE');
    expect(row.recoveryScore).toBeNull();
    // An unscored recovery carries no score object at all, so "not
    // calibrating" was an assertion nobody had made. Gaps stay gaps.
    expect(row.userCalibrating).toBeNull();
  });
});
