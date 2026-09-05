/**
 * The two credentials the security probes keep needing: a signed-in web
 * session and a paired phone.
 *
 * Shared so `fixed-security.test.ts` and `fixed-security.whoop.test.ts` prove
 * the same handshake rather than two copies of it.
 */

import { expect } from 'vitest';
import { POST as login } from '../../src/app/api/login/route';
import type { Database } from '../../src/db/client';
import { claimPairCode, mintPairCode } from '../../src/lib/auth';
import { cookieFrom, request, TEST_PASSPHRASE } from './harness';

/** The session cookie a successful login sets. */
export async function signIn(): Promise<string> {
  const response = await login(
    request('/api/login', { method: 'POST', body: { passphrase: TEST_PASSPHRASE } }),
  );
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

/** A paired phone, and the Bearer it holds. */
export async function pairPhone(db: Database): Promise<string> {
  const minted = await mintPairCode(db);
  const claimed = await claimPairCode(db, { code: minted.code, deviceName: 'iPhone' });
  if (!claimed.ok) throw new Error('the phone did not pair');
  return claimed.deviceSecret;
}
