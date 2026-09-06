/**
 * A server without a Whoop app still serves everything that is not Whoop.
 *
 * The three Whoop values used to be required by the environment check, so a
 * deploy without them answered 500 on every path, sync and sign-in included.
 * Now they are optional: the Whoop paths say "not set up", the rest run.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as whoopStart } from '../src/app/api/whoop/start/route';
import { POST as webhook } from '../src/app/api/whoop/webhook/route';
import { GET as getSnapshot } from '../src/app/api/snapshot/route';
import type { Database } from '../src/db/client';
import { deviceSecret } from '../src/db/tables/account';
import { hashSecret } from '../src/lib/crypto';
import { WhoopNotConfiguredError, env, resetEnvCache, whoopConfigured, whoopEnv } from '../src/lib/env';
import { harness, request, teardown } from './support/harness';

const SECRET = 'dev_test.a-device-secret-long-enough-to-pass-the-contract';

let db: Database;

beforeEach(async () => {
  db = await harness();
  await db.insert(deviceSecret).values({
    id: 'dev_test',
    name: 'iPhone',
    secretHash: hashSecret(SECRET),
    pairedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
  delete process.env['WHOOP_CLIENT_ID'];
  delete process.env['WHOOP_CLIENT_SECRET'];
  delete process.env['WHOOP_REDIRECT_URI'];
  resetEnvCache();
}, 60_000);

afterEach(() => {
  teardown();
});

describe('a server with no Whoop app yet', () => {
  it('passes the environment check with the Whoop values unset', () => {
    expect(() => env()).not.toThrow();
    expect(whoopConfigured()).toBe(false);
    expect(() => whoopEnv()).toThrow(WhoopNotConfiguredError);
  });

  it('reads an empty dashboard value as unset', () => {
    process.env['WHOOP_CLIENT_ID'] = '  ';
    process.env['WHOOP_CLIENT_SECRET'] = 'secret';
    process.env['WHOOP_REDIRECT_URI'] = 'https://vert.test/api/whoop/callback';
    resetEnvCache();
    expect(whoopConfigured()).toBe(false);
  });

  it('answers 503 on the Whoop paths and keeps serving the rest', async () => {
    const start = await whoopStart(request('/api/whoop/start?response=json', { bearer: SECRET }));
    expect(start.status).toBe(503);

    const delivery = await webhook(request('/api/whoop/webhook', { method: 'POST', body: {} }));
    expect(delivery.status).toBe(503);

    const snapshot = await getSnapshot(request('/api/snapshot', { bearer: SECRET }));
    expect(snapshot.status).toBe(204);
  });
});
