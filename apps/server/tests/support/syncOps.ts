/**
 * The pieces every push test needs: a paired device, an op builder, and one
 * set log worth pushing.
 *
 * They live here rather than at the top of a test file because two files
 * assert on the same wire (`sync.test.ts` for push, pull and the feed;
 * `sync.climbing.test.ts` for the house-rule ops), and duplicating the setup
 * would let the two drift apart.
 */

import { expect } from 'vitest';
import { POST as syncPush } from '../../src/app/api/sync/push/route';
import type { Database } from '../../src/db/client';
import { deviceSecret } from '../../src/db/tables/account';
import type { SyncPushResponse } from '../../src/lib/api-contract';
import { hashSecret } from '../../src/lib/crypto';
import { bodyOf, harness, request } from './harness';

/**
 * `<deviceId>.<random>`: the id in front of the dot is how the row is found,
 * so a bearer costs one scrypt rather than one per paired device.
 */
export const SECRET = 'dev_test.a-device-secret-long-enough-to-pass-the-contract';
export const CREATED = '2026-09-04T18:12:00.000Z';

/** A fresh database with one paired phone in it. */
export async function syncHarness(): Promise<Database> {
  const db = await harness();
  await db.insert(deviceSecret).values({
    id: 'dev_test',
    name: 'iPhone',
    secretHash: hashSecret(SECRET),
    pairedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
  return db;
}

export interface OpInput {
  readonly id: string;
  readonly kind: string;
  readonly entityId: string | null;
  readonly payload: unknown;
  readonly createdAt?: string;
}

export async function push(ops: readonly OpInput[]): Promise<SyncPushResponse> {
  const response = await syncPush(
    request('/api/sync/push', {
      method: 'POST',
      bearer: SECRET,
      body: { ops: ops.map((op) => ({ createdAt: CREATED, ...op })) },
    }),
  );
  expect(response.status).toBe(200);
  return bodyOf<SyncPushResponse>(response);
}

export function aSetLog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'log-1',
    sessionId: 'session-1',
    sessionExerciseId: 'ex-1',
    setNumber: 1,
    repsDone: 5,
    loadKg: 93.0,
    entrySource: 'typed',
    completedAt: CREATED,
    offsetDays: 0,
    idempotencyKey: 'ex-1:1',
    createdAt: CREATED,
    ...overrides,
  };
}
