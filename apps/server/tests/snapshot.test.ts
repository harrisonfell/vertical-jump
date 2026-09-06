/**
 * The database snapshot: save, fetch, conflict, force, history, prune.
 *
 * The bytes here are not a real database beyond the sixteen-byte header the
 * route checks for; the phone's own tests cover what the file means. This
 * file is about the server's promises: a save whose base is stale is refused
 * with the copy that stands, a forced save lands and keeps the copy it passed,
 * and only the last SNAPSHOT_KEEP copies stay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as getSnapshot, PUT as putSnapshotRoute } from '../src/app/api/snapshot/route';
import { GET as getVersions } from '../src/app/api/snapshot/versions/route';
import type { Database } from '../src/db/client';
import { deviceSecret } from '../src/db/tables/account';
import {
  SNAPSHOT_HEADERS,
  SNAPSHOT_KEEP,
  type SnapshotConflict,
  type SnapshotMeta,
  type SnapshotMetaResponse,
  type SnapshotVersionsResponse,
} from '../src/lib/api-contract';
import { hashSecret } from '../src/lib/crypto';
import { listSnapshots, putSnapshot } from '../src/lib/snapshot/store';
import { bodyOf, harness, request, teardown } from './support/harness';

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
}, 60_000);

afterEach(() => {
  teardown();
});

/** A file that opens like SQLite and carries a marker so copies can be told apart. */
function sqliteBytes(marker: string): Uint8Array {
  const header = 'SQLite format 3\0';
  const bytes = new Uint8Array(header.length + 64 + marker.length);
  for (let index = 0; index < header.length; index += 1) bytes[index] = header.charCodeAt(index);
  for (let index = 0; index < marker.length; index += 1) {
    bytes[header.length + 64 + index] = marker.charCodeAt(index);
  }
  return bytes;
}

interface SaveOptions {
  readonly base?: number | 'none';
  readonly force?: boolean;
  readonly schema?: string;
  readonly bearer?: string | null;
}

function save(bytes: Uint8Array, options: SaveOptions = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/octet-stream' });
  if (options.bearer !== null) headers.set('authorization', `Bearer ${options.bearer ?? SECRET}`);
  headers.set(SNAPSHOT_HEADERS.schema, options.schema ?? '6');
  headers.set(SNAPSHOT_HEADERS.base, String(options.base ?? 'none'));
  if (options.force === true) headers.set(SNAPSHOT_HEADERS.force, '1');
  return new Request('https://vert.test/api/snapshot', {
    method: 'PUT',
    headers,
    body: bytes as BodyInit,
  }) as unknown as NextRequest;
}

async function saved(bytes: Uint8Array, options: SaveOptions = {}): Promise<SnapshotMeta> {
  const response = await putSnapshotRoute(save(bytes, options));
  expect(response.status).toBe(200);
  const body = await bodyOf<SnapshotMetaResponse>(response);
  if (body.snapshot === null) throw new Error('the save came back without a snapshot');
  return body.snapshot;
}

describe('saving a snapshot', () => {
  it('needs a credential', async () => {
    const response = await putSnapshotRoute(save(sqliteBytes('a'), { bearer: null }));
    expect(response.status).toBe(401);
    const fetched = await getSnapshot(request('/api/snapshot'));
    expect(fetched.status).toBe(401);
  });

  it('answers 204 before the first save, then the bytes with their facts', async () => {
    const empty = await getSnapshot(request('/api/snapshot', { bearer: SECRET }));
    expect(empty.status).toBe(204);

    const meta = await saved(sqliteBytes('first'));
    expect(meta.version).toBe(1);
    expect(meta.baseVersion).toBeNull();
    expect(meta.origin).toBe('device');
    expect(meta.deviceId).toBe('dev_test');
    expect(meta.schemaVersion).toBe(6);
    expect(meta.byteLength).toBe(sqliteBytes('first').byteLength);

    const fetched = await getSnapshot(request('/api/snapshot', { bearer: SECRET }));
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('application/octet-stream');
    expect(fetched.headers.get(SNAPSHOT_HEADERS.version)).toBe('1');
    expect(fetched.headers.get(SNAPSHOT_HEADERS.schema)).toBe('6');
    expect(fetched.headers.get(SNAPSHOT_HEADERS.base)).toBe('none');
    expect(fetched.headers.get(SNAPSHOT_HEADERS.sha256)).toBe(meta.sha256);
    const bytes = new Uint8Array(await fetched.arrayBuffer());
    expect(bytes).toEqual(sqliteBytes('first'));

    const facts = await getSnapshot(request('/api/snapshot?meta=1', { bearer: SECRET }));
    expect(facts.status).toBe(200);
    expect((await bodyOf<SnapshotMetaResponse>(facts)).snapshot?.version).toBe(1);
  });

  it('refuses a save whose base is not the newest copy, and names the copy', async () => {
    await saved(sqliteBytes('one'));
    const stale = await putSnapshotRoute(save(sqliteBytes('two'), { base: 'none' }));
    expect(stale.status).toBe(409);
    const body = await bodyOf<SnapshotConflict>(stale);
    expect(body.error).toBe('snapshot_conflict');
    expect(body.current?.version).toBe(1);

    const next = await saved(sqliteBytes('two'), { base: 1 });
    expect(next.version).toBe(2);
    expect(next.baseVersion).toBe(1);

    const behind = await putSnapshotRoute(save(sqliteBytes('three'), { base: 1 }));
    expect(behind.status).toBe(409);
    expect((await bodyOf<SnapshotConflict>(behind)).current?.version).toBe(2);
  });

  it('lands a forced save and keeps the copy it passed', async () => {
    await saved(sqliteBytes('one'));
    await saved(sqliteBytes('two'), { base: 1 });
    const forced = await saved(sqliteBytes('mine'), { base: 1, force: true });
    expect(forced.version).toBe(3);
    expect(forced.baseVersion).toBe(1);

    const list = await getVersions(request('/api/snapshot/versions', { bearer: SECRET }));
    const body = await bodyOf<SnapshotVersionsResponse>(list);
    expect(body.versions.map((entry) => entry.version)).toEqual([3, 2, 1]);

    const passed = await getSnapshot(request('/api/snapshot?version=2', { bearer: SECRET }));
    expect(passed.status).toBe(200);
    expect(new Uint8Array(await passed.arrayBuffer())).toEqual(sqliteBytes('two'));
  });

  it('refuses a body that is not SQLite, a missing schema, and a bad version', async () => {
    const notSqlite = new TextEncoder().encode('{"not":"a database"}');
    expect((await putSnapshotRoute(save(notSqlite))).status).toBe(400);

    const headers = new Headers({
      authorization: `Bearer ${SECRET}`,
      'content-type': 'application/octet-stream',
    });
    const noSchema = new Request('https://vert.test/api/snapshot', {
      method: 'PUT',
      headers,
      body: sqliteBytes('x') as BodyInit,
    }) as unknown as NextRequest;
    expect((await putSnapshotRoute(noSchema)).status).toBe(400);

    const badVersion = await getSnapshot(request('/api/snapshot?version=abc', { bearer: SECRET }));
    expect(badVersion.status).toBe(400);
    const missing = await getSnapshot(request('/api/snapshot?version=99', { bearer: SECRET }));
    expect(missing.status).toBe(204);
  });

  it('keeps only the last SNAPSHOT_KEEP copies', async () => {
    let base: number | null = null;
    for (let index = 0; index < SNAPSHOT_KEEP + 3; index += 1) {
      const result = await putSnapshot(db, {
        bytes: sqliteBytes(`copy ${index}`),
        schemaVersion: 6,
        baseVersion: base,
        force: false,
        origin: 'web',
        deviceId: null,
      });
      if (!result.ok) throw new Error('an in-order save was refused');
      base = result.meta.version;
    }
    const kept = await listSnapshots(db);
    expect(kept).toHaveLength(SNAPSHOT_KEEP);
    expect(kept[0]?.version).toBe(SNAPSHOT_KEEP + 3);
    expect(kept[kept.length - 1]?.version).toBe(4);
  });
});
