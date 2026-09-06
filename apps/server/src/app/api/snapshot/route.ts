import { NextResponse, type NextRequest } from 'next/server';
import { SNAPSHOT_HEADERS, SNAPSHOT_MAX_BYTES, type SnapshotMeta } from '../../../lib/api-contract';
import { log } from '../../../lib/logger';
import { database } from '../../../lib/routes/db';
import { deviceIdOf, guard, originOf } from '../../../lib/routes/guard';
import { badRequest, fail, json } from '../../../lib/routes/respond';
import { isSqliteFile, latestSnapshot, putSnapshot, readSnapshot } from '../../../lib/snapshot/store';

/**
 * The athlete's database, whole.
 *
 * GET hands back the newest copy as raw bytes with its facts in headers, a
 * specific one with `?version=`, and only the facts with `?meta=1`. 204 means
 * no copy has been saved yet, which a fresh install reads as "push yours".
 *
 * PUT saves a copy. The `x-snapshot-base` header names the version the device
 * adopted last; when a newer copy landed since, the save is refused with 409
 * and that copy's facts, and the device decides. `x-snapshot-force: 1` saves
 * anyway; the copy it passed stays restorable.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = 'no-store';

function metaHeaders(meta: SnapshotMeta): Record<string, string> {
  return {
    [SNAPSHOT_HEADERS.version]: String(meta.version),
    [SNAPSHOT_HEADERS.schema]: String(meta.schemaVersion),
    [SNAPSHOT_HEADERS.createdAt]: meta.createdAt,
    [SNAPSHOT_HEADERS.origin]: meta.origin,
    [SNAPSHOT_HEADERS.device]: meta.deviceId ?? '',
    [SNAPSHOT_HEADERS.sha256]: meta.sha256,
    [SNAPSHOT_HEADERS.base]: meta.baseVersion === null ? 'none' : String(meta.baseVersion),
  };
}

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const url = new URL(request.url);
  const versionParam = url.searchParams.get('version');
  const version = positiveInt(versionParam);
  if (versionParam !== null && version === null) {
    return badRequest('A snapshot version is a positive whole number.');
  }

  if (url.searchParams.get('meta') === '1') {
    const meta = version === null ? await latestSnapshot(db) : (await readSnapshot(db, version))?.meta;
    return json({ snapshot: meta ?? null });
  }

  const found = await readSnapshot(db, version);
  if (found === null) {
    return new NextResponse(null, { status: 204, headers: { 'cache-control': NO_STORE } });
  }
  return new NextResponse(found.bytes as BodyInit, {
    status: 200,
    headers: {
      'cache-control': NO_STORE,
      'content-type': 'application/octet-stream',
      'content-length': String(found.bytes.byteLength),
      ...metaHeaders(found.meta),
    },
  });
}

export async function PUT(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const schemaVersion = positiveInt(request.headers.get(SNAPSHOT_HEADERS.schema));
  if (schemaVersion === null) {
    return badRequest(`A save names its schema version in ${SNAPSHOT_HEADERS.schema}.`);
  }
  const baseHeader = request.headers.get(SNAPSHOT_HEADERS.base);
  const baseVersion = baseHeader === null || baseHeader === 'none' ? null : positiveInt(baseHeader);
  if (baseHeader !== null && baseHeader !== 'none' && baseVersion === null) {
    return badRequest(`${SNAPSHOT_HEADERS.base} is a version number or "none".`);
  }
  const force = request.headers.get(SNAPSHOT_HEADERS.force) === '1';

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return badRequest('The body is empty.');
  if (bytes.byteLength > SNAPSHOT_MAX_BYTES) {
    return fail(413, 'too_large', `A snapshot is at most ${SNAPSHOT_MAX_BYTES} bytes.`);
  }
  if (!isSqliteFile(bytes)) return badRequest('The body is not a SQLite database.');

  const result = await putSnapshot(db, {
    bytes,
    schemaVersion,
    baseVersion,
    force,
    origin: originOf(caller.principal) === 'web' ? 'web' : 'device',
    deviceId: deviceIdOf(caller.principal),
  });

  if (!result.ok) {
    log.info('snapshot.conflict', {
      base: baseVersion,
      current: result.current?.version ?? null,
      origin: originOf(caller.principal),
    });
    return json(
      {
        error: 'snapshot_conflict',
        message: 'Another device saved a newer copy.',
        retryAfterS: null,
        current: result.current,
      },
      409,
    );
  }

  log.info('snapshot.saved', {
    version: result.meta.version,
    bytes: result.meta.byteLength,
    origin: result.meta.origin,
    force,
  });
  return json({ snapshot: result.meta });
}
