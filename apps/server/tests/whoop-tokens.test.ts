/**
 * The token pair: rotated once, never lost.
 *
 * Whoop's refresh tokens rotate and are single use, so two concurrent
 * refreshes would lose the grant if both fired. The refresh lives inside
 * SELECT ... FOR UPDATE on the one connection row, so the second caller waits
 * and then finds a token it can simply use.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WHOOP_CONNECTION_ID, whoopConnection } from '../src/db/tables/whoop';
import { encryptToken } from '../src/lib/crypto';
import { WhoopApiError } from '../src/lib/whoop/api';
import { decryptStored, ensureAccessToken } from '../src/lib/whoop/tokens';
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

let db: TestDb;
let stub: FetchStub | null = null;

const NOW = new Date('2026-09-04T12:00:00.000Z');

async function seedConnection(expiresAt: Date, refresh = 'refresh-0'): Promise<void> {
  await db
    .insert(whoopConnection)
    .values({
      id: WHOOP_CONNECTION_ID,
      status: 'connected',
      whoopUserId: '100427',
      accessTokenCipher: encryptToken('access-0', TEST_ENCRYPTION_KEY),
      refreshTokenCipher: encryptToken(refresh, TEST_ENCRYPTION_KEY),
      expiresAt,
      scopes: 'offline',
      connectedAt: new Date('2026-08-01T07:00:00.000Z'),
      updatedAt: NOW,
    })
    .onConflictDoNothing();
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

beforeEach(async () => {
  setTestEnv();
  await resetDb(db);
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe('ensureAccessToken', () => {
  it('hands back the stored token while it is still fresh', async () => {
    await seedConnection(new Date(NOW.getTime() + 60 * 60 * 1000));
    stub = stubFetch(() => {
      throw new Error('a fresh token must not be refreshed');
    });

    expect(await ensureAccessToken(asDatabase(db), NOW)).toBe('access-0');
    expect(stub.calls).toHaveLength(0);
  });

  it('refreshes inside the five minute window and stores the rotated pair', async () => {
    await seedConnection(new Date(NOW.getTime() + 60_000));
    stub = stubFetch(() => jsonResponse(tokenBody('1')));

    expect(await ensureAccessToken(asDatabase(db), NOW)).toBe('access-1');
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.body).toContain('grant_type=refresh_token');

    const row = await connectionRow();
    expect(decryptStored(row.refreshTokenCipher ?? '')).toBe('refresh-1');
    expect(row.lastError).toBeNull();
    expect(row.rowVersion).toBe(1);
  });

  it('refreshes once for two concurrent callers, and the second reuses it', async () => {
    await seedConnection(new Date(NOW.getTime() + 60_000));
    let issued = 0;
    stub = stubFetch(async () => {
      issued += 1;
      const which = issued;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse(tokenBody(String(which)));
    });

    const [first, second] = await Promise.all([
      ensureAccessToken(asDatabase(db), NOW),
      ensureAccessToken(asDatabase(db), NOW),
    ]);

    // A second rotation would have killed the refresh token the first one won.
    expect(issued).toBe(1);
    expect(first).toBe('access-1');
    expect(second).toBe('access-1');
  });

  it('never overwrites the stored pair when the refresh fails', async () => {
    await seedConnection(new Date(NOW.getTime() + 60_000));
    stub = stubFetch(() => jsonResponse({ error: 'server_error' }, 500));

    await expect(ensureAccessToken(asDatabase(db), NOW)).rejects.toBeInstanceOf(WhoopApiError);

    const row = await connectionRow();
    expect(decryptStored(row.refreshTokenCipher ?? '')).toBe('refresh-0');
    expect(decryptStored(row.accessTokenCipher ?? '')).toBe('access-0');
    expect(row.status).toBe('connected');
    expect(row.lastError).toBe('api_down');
  });

  it('treats a 400 from the token endpoint as a dead grant', async () => {
    await seedConnection(new Date(NOW.getTime() + 60_000));
    stub = stubFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));

    await expect(ensureAccessToken(asDatabase(db), NOW)).rejects.toMatchObject({
      kind: 'needs_reauth',
    });

    const row = await connectionRow();
    expect(row.status).toBe('revoked');
    expect(row.lastError).toBe('needs_reauth');
  });

  it('refuses when there is nothing to refresh', async () => {
    await expect(ensureAccessToken(asDatabase(db), NOW)).rejects.toMatchObject({
      kind: 'needs_reauth',
    });
  });
});
