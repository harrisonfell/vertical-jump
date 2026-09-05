/**
 * The contract, the crypto, and the record mapping, without a database.
 *
 * These are the pieces the app depends on being exactly right: a status body
 * the app can parse, a token that survives a round trip, and a local date
 * taken from the record's own offset rather than from UTC.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseMirrorKinds,
  syncPushResponse,
  whoopStatusResponse,
  whoopSyncResponse,
} from '../src/lib/api-contract';
import {
  decryptToken,
  encryptToken,
  hashSecret,
  verifySecret,
  verifyWhoopSignature,
  whoopSignature,
} from '../src/lib/crypto';
import { localDateFor, offsetMinutes, recoveryV2, toRecoveryRow } from '../src/lib/whoop/records';
import { pageSchema } from '../src/lib/whoop/api';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'whoop');

describe('the api contract', () => {
  it('accepts the connected status body the app renders', () => {
    const parsed = whoopStatusResponse.parse({
      status: 'connected',
      whoopUserId: '100427',
      connectedAt: '2026-08-01T07:00:00.000Z',
      lastSyncAt: '2026-09-04T10:41:00.000Z',
      backfillDaysDone: 88,
      backfillDaysTotal: 90,
      lastError: null,
      nextRetryAt: null,
    });
    expect(parsed.status).toBe('connected');
  });

  it('carries the rate limit as an instant, so the copy can name a time', () => {
    const parsed = whoopSyncResponse.parse({
      status: 'error',
      whoopUserId: '100427',
      connectedAt: '2026-08-01T07:00:00.000Z',
      lastSyncAt: null,
      backfillDaysDone: 40,
      backfillDaysTotal: 90,
      lastError: 'rate_limited',
      nextRetryAt: '2026-09-04T11:02:00.000Z',
      daysImported: 0,
      imported: 0,
      nextCursor: 'page-3',
      done: false,
    });
    expect(parsed.nextRetryAt).toBe('2026-09-04T11:02:00.000Z');
    expect(parsed.done).toBe(false);
  });

  it('reads the kinds query, and defaults to all four mirrors', () => {
    expect(parseMirrorKinds(undefined)).toEqual(['cycle', 'recovery', 'sleep', 'workout']);
    expect(parseMirrorKinds('recovery, workout')).toEqual(['recovery', 'workout']);
    expect(parseMirrorKinds('nonsense')).toEqual([]);
  });

  it('rejects a push response that is not a push response', () => {
    expect(syncPushResponse.safeParse({ accepted: 'all' }).success).toBe(false);
  });
});

describe('crypto', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a token through AES-256-GCM', () => {
    const packed = encryptToken('whoop-refresh-token', key);
    expect(packed).not.toContain('whoop-refresh-token');
    expect(decryptToken(packed, key)).toBe('whoop-refresh-token');
  });

  it('refuses a token encrypted under another key', () => {
    const packed = encryptToken('secret', key);
    expect(() => decryptToken(packed, randomBytes(32).toString('base64'))).toThrow();
  });

  it('verifies a scrypt hash and rejects a wrong value', () => {
    const stored = hashSecret('a long owner passphrase');
    expect(verifySecret('a long owner passphrase', stored)).toBe(true);
    expect(verifySecret('a long owner passphras', stored)).toBe(false);
    expect(verifySecret('anything', 'not-a-hash')).toBe(false);
  });

  it('signs a webhook the way Whoop does: timestamp then raw body', () => {
    const body = '{"user_id":100427,"id":"abc","type":"workout.updated","trace_id":"t-1"}';
    const signature = whoopSignature('1788550000000', body, 'client-secret');
    expect(verifyWhoopSignature('1788550000000', body, 'client-secret', signature)).toBe(true);
    expect(verifyWhoopSignature('1788550000001', body, 'client-secret', signature)).toBe(false);
  });
});

describe('whoop records', () => {
  it('reads an offset east and west of UTC', () => {
    expect(offsetMinutes('-04:00')).toBe(-240);
    expect(offsetMinutes('+05:30')).toBe(330);
    expect(offsetMinutes(null)).toBeNull();
  });

  it('takes the local date from the record own offset, not from UTC', () => {
    // 00:40 UTC on the 4th is still the evening of the 3rd in New York.
    expect(localDateFor('2026-09-04T00:40:00.000Z', '-04:00')).toBe('2026-09-03');
    expect(localDateFor('2026-09-04T00:40:00.000Z', null)).toBe('2026-09-04');
  });

  it('maps the recorded recovery fixture into a mirror row', async () => {
    const raw = JSON.parse(await readFile(join(fixtures, 'recovery.json'), 'utf8')) as unknown;
    const page = pageSchema(recoveryV2).parse(raw);
    // 90 recorded days, newest first, because Whoop has no sandbox.
    expect(page.records.length).toBeGreaterThanOrEqual(90);

    const byCycle = (id: string) => page.records.find((record) => record.cycle_id === id);

    const scored = toRecoveryRow(byCycle('93845123')!, '2026-09-04T12:00:00.000Z');
    expect(scored.recoveryScore).toBe(71);
    expect(scored.userCalibrating).toBe(false);
    expect(scored.localDate).toBe('2026-09-03');

    const pending = toRecoveryRow(byCycle('93851907')!, '2026-09-04T12:00:00.000Z');
    expect(pending.scoreState).toBe('PENDING_SCORE');
    expect(pending.recoveryScore).toBeNull();
    expect(pending.hrvRmssdMilli).toBeNull();
  });
});
