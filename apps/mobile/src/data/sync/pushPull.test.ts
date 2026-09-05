import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from '../executor';
import { openMigratedTestDb } from '../testing/testDb';
import { KV_KEYS, kvGet } from '../store/kv';
import { enqueue, getSyncStatus, listPending } from '../store/sync';
import { getRecoveryForDay, getWorkout } from '../store/whoop';
import { API } from './apiContract';
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffDelayMs,
  nextAttemptAt,
  MIRROR_CURSOR_KEY,
  resetBackoff,
  runSync,
} from './pushPull';
import { memoryCredentialStore, setCredentialStore } from './transport';

const SERVER = 'https://vert.example';
const NOW = Date.parse('2026-10-22T07:00:00.000Z');

/** Any version, any variant: what matters is that it is not a row number. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let db: SqlExecutor;
let requests: { url: string; body: unknown }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers each path from a table, so a test names only what it cares about. */
function route(table: Readonly<Record<string, () => Response>>): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const path = url.slice(SERVER.length).split('?')[0] ?? '';
    requests.push({
      url,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    });
    const handler = table[path];
    if (handler === undefined) return Promise.resolve(json({ rows: [], next: null }));
    return Promise.resolve(handler());
  });
}

const NO_MIRRORS = (): Response =>
  json({ rows: [], next: null, serverTime: '2026-10-22T07:00:00.000Z' });

function pushedOps(): { id: string; kind: string }[] {
  const push = requests.find((entry) => entry.url.includes(API.syncPush));
  const body = push?.body as { ops?: { id: string; kind: string }[] } | undefined;
  return body?.ops ?? [];
}

const RECOVERY_ROW = {
  id: 'rec-1',
  scoreState: 'SCORED',
  timezoneOffset: '-04:00',
  localDate: '2026-10-21',
  raw: { recovery_score: 71 },
  updatedAt: '2026-10-22T06:00:00.000Z',
  cycleId: 'cyc-1',
  sleepId: 'slp-1',
  userCalibrating: false,
  recoveryScore: 71,
  restingHeartRate: 48,
  hrvRmssdMilli: 92.4,
  spo2Percentage: null,
  skinTempCelsius: null,
};

const WORKOUT_ROW = {
  id: 'wk-1',
  scoreState: 'SCORED',
  timezoneOffset: '-04:00',
  localDate: '2026-10-21',
  raw: { sport_name: 'strength trainer' },
  updatedAt: '2026-10-22T06:00:00.000Z',
  sportName: 'strength trainer',
  startAt: '2026-10-21T16:00:00.000Z',
  endAt: '2026-10-21T17:05:00.000Z',
  strain: 9.4,
  averageHeartRate: 118,
  maxHeartRate: 162,
  percentRecorded: 100,
  zoneDurations: { zone_two_milli: 900000 },
};

beforeEach(async () => {
  db = await openMigratedTestDb();
  requests = [];
  resetBackoff();
  process.env['EXPO_PUBLIC_SERVER_URL'] = SERVER;
  setCredentialStore(memoryCredentialStore({ deviceId: 'dev1', deviceSecret: 'sekrit' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['EXPO_PUBLIC_SERVER_URL'];
  resetBackoff();
});

describe('runSync with no server', () => {
  it('does nothing at all rather than pretending to sync', async () => {
    delete process.env['EXPO_PUBLIC_SERVER_URL'];
    vi.stubGlobal('fetch', () => {
      throw new Error('should not be called');
    });
    const result = await runSync(db);
    expect(result.skipped).toBe('no_server');
    expect(result.ok).toBe(false);
  });
});

describe('push', () => {
  it("sends every queued op keyed by the row's own uuid, and clears the ones taken", async () => {
    await enqueue(db, {
      kind: 'setLog.upsert',
      entityId: 'set-1',
      payload: { reps: 5 },
    });
    await enqueue(db, {
      kind: 'athlete.clearance',
      entityId: 'athlete',
      payload: { attested: true },
    });
    const queued = (await listPending(db)).map((row) => row.uuid);

    route({
      [API.syncPush]: () =>
        json({
          accepted: queued,
          rejected: [],
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
      [API.mirrors]: NO_MIRRORS,
    });

    const result = await runSync(db, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(2);
    expect(result.accepted).toBe(2);

    const ops = pushedOps();
    expect(ops.map((op) => op.id)).toEqual(queued);
    // The idempotency key belongs to the op, not to a local autoincrement a
    // reinstall would hand out again.
    for (const id of queued) expect(id).toMatch(UUID);
    // The clearance kind is one the server's first draft did not list.
    expect(ops.map((op) => op.kind)).toContain('athlete.clearance');

    expect(await listPending(db)).toHaveLength(0);
    const status = await getSyncStatus(db);
    expect(status.pending).toBe(0);
    expect(status.lastSyncedAt).not.toBeNull();
  });

  it('leaves a rejected op in the queue and records why', async () => {
    const id = await enqueue(db, { kind: 'week.upsert', entityId: 'w1', payload: {} });
    route({
      [API.syncPush]: () =>
        json({
          accepted: [],
          rejected: [{ id: `dev1:${id}`, reason: 'invalid_payload', message: 'Week 1 has no start.' }],
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
      [API.mirrors]: NO_MIRRORS,
    });

    const result = await runSync(db, { now: NOW });
    expect(result.rejected).toBe(1);
    const pending = await listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.lastError).toBe('Week 1 has no start.');
  });

  it('does not let a kind this build does not know wedge the queue', async () => {
    await db.runAsync(
      'INSERT INTO sync_queue (op, entity_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, 0)',
      ['future.thing', 'x', '{}', '2026-10-22T06:00:00.000Z'],
    );
    const known = await enqueue(db, { kind: 'session.finish', entityId: 's1', payload: {} });

    route({
      [API.syncPush]: () =>
        json({ accepted: [`dev1:${known}`], rejected: [], serverTime: '2026-10-22T07:00:00.000Z' }),
      [API.mirrors]: NO_MIRRORS,
    });

    const result = await runSync(db, { now: NOW });
    expect(result.pushed).toBe(1);
    expect(pushedOps().map((op) => op.kind)).toEqual(['session.finish']);
    const pending = await listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.op).toBe('future.thing');
    expect(pending[0]?.attempts).toBe(1);
  });

  it('skips the push entirely when the outbox is empty', async () => {
    route({ [API.mirrors]: NO_MIRRORS });
    const result = await runSync(db, { now: NOW });
    expect(result.pushed).toBe(0);
    expect(requests.some((entry) => entry.url.includes(API.syncPush))).toBe(false);
  });
});

describe('pull', () => {
  it('writes a pulled recovery into the mirror the recovery panel reads', async () => {
    route({
      [API.mirrors]: () =>
        json({
          rows: [
            {
              kind: 'recovery',
              id: 'rec-1',
              updatedAt: '2026-10-22T06:00:00.000Z',
              deleted: false,
              row: RECOVERY_ROW,
            },
          ],
          next: null,
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
    });

    const result = await runSync(db, { now: NOW });
    expect(result.applied).toBe(1);

    const recovery = await getRecoveryForDay(db, '2026-10-21');
    expect(recovery?.recoveryScore).toBe(71);
    expect(recovery?.scoreState).toBe('SCORED');
    expect(recovery?.timezoneOffset).toBe('-04:00');
    expect(recovery?.userCalibrating).toBe(false);
  });

  it('applies a deletion and takes the session link with it', async () => {
    route({
      [API.mirrors]: () =>
        json({
          rows: [
            { kind: 'workout', id: 'wk-1', updatedAt: '2026-10-22T06:00:00.000Z', deleted: false, row: WORKOUT_ROW },
          ],
          next: null,
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
    });
    await runSync(db, { now: NOW });
    expect(await getWorkout(db, 'wk-1')).not.toBeNull();

    requests = [];
    route({
      [API.mirrors]: () =>
        json({
          rows: [
            { kind: 'workout', id: 'wk-1', updatedAt: '2026-10-22T08:00:00.000Z', deleted: true, row: null },
          ],
          next: null,
          serverTime: '2026-10-22T08:00:00.000Z',
        }),
    });
    const result = await runSync(db, { now: NOW, force: true });
    expect(result.applied).toBe(1);
    expect(await getWorkout(db, 'wk-1')).toBeNull();
    // deleteWhoopWorkout drops the session link in the same transaction, so a
    // session can never point at a workout the server has taken away.
    const links = await db.getAllAsync(
      'SELECT * FROM session_workout_link WHERE whoop_workout_id = ?',
      ['wk-1'],
    );
    expect(links).toHaveLength(0);
  });

  it('follows the cursor across pages and remembers where it stopped', async () => {
    let page = 0;
    vi.stubGlobal('fetch', (url: string) => {
      requests.push({ url, body: null });
      if (!url.includes(API.mirrors)) return Promise.resolve(json({}));
      page += 1;
      if (page === 1) {
        return Promise.resolve(
          json({
            rows: [
              { kind: 'recovery', id: 'rec-1', updatedAt: '2026-10-22T06:00:00.000Z', deleted: false, row: RECOVERY_ROW },
            ],
            next: 'cursor-2',
            serverTime: '2026-10-22T07:00:00.000Z',
          }),
        );
      }
      return Promise.resolve({ ...json({ rows: [], next: null, serverTime: '2026-10-22T07:00:00.000Z' }) } as Response);
    });

    const result = await runSync(db, { now: NOW });
    expect(result.pulled).toBe(1);
    expect(requests.filter((entry) => entry.url.includes(API.mirrors))).toHaveLength(2);
    expect(requests[1]?.url).toContain('cursor=cursor-2');
  });

  /**
   * The position is written for the rows that were applied, and a last page
   * that names none of its own does not take the stored one down with it.
   * The loop used to drop the cursor on the floor there, which was harmless
   * only because it broke out of the loop in the same breath; nothing about
   * the run said so, and the next edit to the loop would have replayed the
   * whole feed from the head.
   */
  it('keeps the position the server last named when the final page names none', async () => {
    let page = 0;
    vi.stubGlobal('fetch', (url: string) => {
      requests.push({ url, body: null });
      if (!url.includes(API.mirrors)) return Promise.resolve(json({}));
      page += 1;
      const rows = [
        {
          kind: 'recovery',
          id: `rec-${page}`,
          updatedAt: '2026-10-22T06:00:00.000Z',
          deleted: false,
          row: { ...RECOVERY_ROW, id: `rec-${page}` },
        },
      ];
      return Promise.resolve(
        json({
          rows,
          next: page === 1 ? 'cursor-2' : null,
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
      );
    });

    const first = await runSync(db, { now: NOW, force: true });
    expect(first.applied).toBe(2);
    expect(await kvGet(db, MIRROR_CURSOR_KEY)).toBe('cursor-2');

    // The next run resumes there rather than starting again at the head.
    requests = [];
    page = 1;
    await runSync(db, { now: NOW, force: true });
    const pulls = requests.filter((entry) => entry.url.includes(API.mirrors));
    expect(pulls[0]?.url).toContain('cursor=cursor-2');
  });

  /**
   * The residual that used to be here is gone.
   *
   * `/api/mirrors` used to mint `next` only while there was a page behind the
   * one it was answering, so a feed that fitted inside a single page came back
   * with no position at all. The phone cannot mint one, because the cursor is
   * the row's `feed_seq` and no row on the wire carries it, so that whole feed
   * was pulled again and re-applied on every run. The server now names the
   * last row's position on every page that has rows, and a null `next` means
   * only that the page was empty.
   */
  it('remembers the position a single last page names', async () => {
    let page = 0;
    vi.stubGlobal('fetch', (url: string) => {
      requests.push({ url, body: null });
      if (!url.includes(API.mirrors)) return Promise.resolve(json({}));
      page += 1;
      if (page > 1) {
        return Promise.resolve(json({ rows: [], next: null, serverTime: '2026-10-22T07:00:00.000Z' }));
      }
      return Promise.resolve(
        json({
          rows: [
            {
              kind: 'recovery',
              id: 'rec-1',
              updatedAt: '2026-10-22T06:00:00.000Z',
              deleted: false,
              row: RECOVERY_ROW,
            },
          ],
          next: 'cursor-1',
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
      );
    });

    await runSync(db, { now: NOW, force: true });
    expect(await kvGet(db, MIRROR_CURSOR_KEY)).toBe('cursor-1');

    // The next run resumes there rather than replaying the whole feed.
    requests = [];
    page = 1;
    await runSync(db, { now: NOW, force: true });
    const pulls = requests.filter((entry) => entry.url.includes(API.mirrors));
    expect(pulls[0]?.url).toContain('cursor=cursor-1');
  });

  it('skips a malformed row instead of throwing the whole run away', async () => {
    route({
      [API.mirrors]: () =>
        json({
          rows: [
            { kind: 'recovery', id: 'rec-bad', updatedAt: '2026-10-22T06:00:00.000Z', deleted: false, row: { id: 'rec-bad' } },
            { kind: 'recovery', id: 'rec-1', updatedAt: '2026-10-22T06:00:00.000Z', deleted: false, row: RECOVERY_ROW },
          ],
          next: null,
          serverTime: '2026-10-22T07:00:00.000Z',
        }),
    });
    const result = await runSync(db, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.pulled).toBe(2);
    expect(result.applied).toBe(1);
  });
});

describe('backoff', () => {
  it('doubles from 5 s and stops at 5 min', () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffDelayMs(3)).toBe(BACKOFF_BASE_MS * 4);
    expect(backoffDelayMs(20)).toBe(BACKOFF_MAX_MS);
  });

  it('waits after a failure, and a forced run goes anyway', async () => {
    await enqueue(db, { kind: 'session.patch', entityId: 's1', payload: {} });
    route({ [API.syncPush]: () => json({ error: 'down', message: 'nope' }, 500) });

    const failed = await runSync(db, { now: NOW });
    expect(failed.ok).toBe(false);
    expect(failed.error?.kind).toBe('api_down');
    expect(nextAttemptAt()).toBe(NOW + BACKOFF_BASE_MS);

    const skipped = await runSync(db, { now: NOW + 1000 });
    expect(skipped.skipped).toBe('backoff');

    route({
      [API.syncPush]: () => json({ accepted: [], rejected: [], serverTime: '2026-10-22T07:00:00.000Z' }),
      [API.mirrors]: NO_MIRRORS,
    });
    const forced = await runSync(db, { now: NOW + 1000, force: true });
    expect(forced.ok).toBe(true);
    // A round trip that worked clears the wait.
    expect(nextAttemptAt()).toBe(0);
  });

  it('honours a rate limit instant over its own curve', async () => {
    await enqueue(db, { kind: 'session.patch', entityId: 's1', payload: {} });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'rate_limited', message: 'slow', nextRetryAt: '2026-10-22T07:30:00.000Z' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const result = await runSync(db, { now: NOW });
    expect(result.error?.kind).toBe('rate_limited');
    expect(nextAttemptAt()).toBe(Date.parse('2026-10-22T07:30:00.000Z'));
  });

  it('leaves the queue untouched when the push never lands', async () => {
    await enqueue(db, { kind: 'setLog.upsert', entityId: 'set-1', payload: { reps: 5 } });
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    const result = await runSync(db, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');
    expect(await listPending(db)).toHaveLength(1);
    expect(await kvGet(db, KV_KEYS.lastSyncedAt)).toBeNull();
  });
});

describe('one run at a time', () => {
  it('collapses two concurrent runs into one push', async () => {
    const id = await enqueue(db, { kind: 'session.finish', entityId: 's1', payload: {} });
    route({
      [API.syncPush]: () =>
        json({ accepted: [`dev1:${id}`], rejected: [], serverTime: '2026-10-22T07:00:00.000Z' }),
      [API.mirrors]: NO_MIRRORS,
    });

    const [a, b] = await Promise.all([runSync(db, { now: NOW }), runSync(db, { now: NOW })]);
    expect(a).toBe(b);
    expect(requests.filter((entry) => entry.url.includes(API.syncPush))).toHaveLength(1);
  });
});
