/**
 * The database on the server: one copy, the newest wins, nothing lost in
 * silence.
 *
 * Every device keeps its own SQLite file, and the op feed carries patches
 * that could never rebuild a program on a second device. So the file itself
 * travels: a device saves its whole database to the server after it changes
 * and adopts the server's newest copy when it opens. The server numbers each
 * save, a device remembers the number it adopted last, and a save whose base
 * is not the newest number is a conflict the server names rather than a
 * silent overwrite.
 *
 * The rules, in the order they are checked:
 *
 *   - No copy on the server yet: a device with an athlete saves the first one.
 *   - Newer schema on the server than this build knows: do nothing and say so.
 *   - This device never adopted a copy but already holds an athlete: neither
 *     side is thrown away on a guess. The device records the conflict and
 *     Settings asks which copy to keep.
 *   - Server newer, nothing changed here: adopt it.
 *   - Server newer and this device changed too: this device's copy stands,
 *     because the athlete's latest act was here, and the copy it passed is
 *     recorded so Settings can bring it back.
 *   - Same version and this device changed: save.
 *
 * Adopting a copy keeps what belongs to this device and not to the athlete:
 * the outbox of ops not yet pushed, the pairing, and the key-value rows that
 * hold this device's own settings and cursors.
 *
 * Pure over the executor and a `SnapshotRemote`, so a test runs two devices
 * against one in-memory server and never touches the network.
 */

import type { SqlExecutor } from '../executor';
import { SCHEMA_VERSION, migrate } from '../migrate';
import { kvDelete, kvGet, kvSet } from '../store/kv';
import { nowIso } from '../store/rows';
import {
  API,
  SNAPSHOT_HEADERS,
  SNAPSHOT_MAX_BYTES,
  readSnapshotMeta,
  snapshotMetaFromHeaders,
  type SnapshotMeta,
} from './apiContract';
import { ApiRequestError, apiFetchBytes } from './transport';

/* ------------------------------------------------------------------ keys */

export const SNAPSHOT_KEYS = {
  /** The server version this database was adopted from or saved as. */
  version: 'snapshot.version',
  /** '1' after a local write the server has not been sent. */
  dirty: 'snapshot.dirty',
  pushedAt: 'snapshot.pushedAt',
  pulledAt: 'snapshot.pulledAt',
  /** A server copy this device's save passed over, until the athlete has seen it. */
  replaced: 'snapshot.replacedVersion',
  /** A server copy this never-synced device has not adopted, until the athlete decides. */
  conflict: 'snapshot.conflictVersion',
  lastError: 'snapshot.lastError',
} as const;

/**
 * Tables that belong to this device, not to the athlete. They are read before
 * a copy is adopted and written back after, so a pull never drops an unsent
 * op, the pairing, or this device's own settings, and never picks up another
 * device's outbox.
 */
export const DEVICE_TABLES = ['sync_queue', 'device_secret', 'kv'] as const;

/* ---------------------------------------------------------------- remote */

export type UploadResult =
  | { readonly ok: true; readonly meta: SnapshotMeta }
  | { readonly ok: false; readonly current: SnapshotMeta | null };

export interface UploadOptions {
  readonly schemaVersion: number;
  readonly baseVersion: number | null;
  readonly force: boolean;
}

/** The server, as the sync reads it. The app's is over HTTP; tests keep one in memory. */
export interface SnapshotRemote {
  meta(): Promise<SnapshotMeta | null>;
  download(version: number | null): Promise<{ meta: SnapshotMeta; bytes: Uint8Array } | null>;
  upload(bytes: Uint8Array, options: UploadOptions): Promise<UploadResult>;
  versions(): Promise<SnapshotMeta[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The real server, over the byte transport. */
export function serverSnapshotRemote(): SnapshotRemote {
  return {
    async meta() {
      const response = await apiFetchBytes(API.snapshot, { query: { meta: 1 } });
      const body = isRecord(response.json) ? response.json : {};
      return readSnapshotMeta(body['snapshot']);
    },

    async download(version) {
      const response = await apiFetchBytes(API.snapshot, {
        query: version === null ? undefined : { version },
      });
      if (response.bytes === null) return null;
      const meta = snapshotMetaFromHeaders(response.header, response.bytes.byteLength);
      if (meta === null) throw new ApiRequestError('api_down', 'The snapshot came without its facts.');
      return { meta, bytes: response.bytes };
    },

    async upload(bytes, options) {
      const response = await apiFetchBytes(API.snapshot, {
        method: 'PUT',
        body: bytes,
        headers: {
          [SNAPSHOT_HEADERS.schema]: String(options.schemaVersion),
          [SNAPSHOT_HEADERS.base]: options.baseVersion === null ? 'none' : String(options.baseVersion),
          [SNAPSHOT_HEADERS.force]: options.force ? '1' : '0',
        },
      });
      const body = isRecord(response.json) ? response.json : {};
      if (response.status === 409) return { ok: false, current: readSnapshotMeta(body['current']) };
      const meta = readSnapshotMeta(body['snapshot']);
      if (meta === null) throw new ApiRequestError('api_down', 'The save came back without its facts.');
      return { ok: true, meta };
    },

    async versions() {
      const response = await apiFetchBytes(API.snapshotVersions);
      const body = isRecord(response.json) ? response.json : {};
      const raw = Array.isArray(body['versions']) ? body['versions'] : [];
      return raw.map(readSnapshotMeta).filter((entry): entry is SnapshotMeta => entry !== null);
    },
  };
}

/* ----------------------------------------------------------------- local */

export interface SnapshotLocal {
  readonly version: number | null;
  readonly dirty: boolean;
  readonly pushedAt: string | null;
  readonly pulledAt: string | null;
  readonly replaced: number | null;
  readonly conflict: number | null;
  readonly lastError: string | null;
}

function versionOf(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function snapshotLocal(db: SqlExecutor): Promise<SnapshotLocal> {
  const [version, dirty, pushedAt, pulledAt, replaced, conflict, lastError] = await Promise.all([
    kvGet(db, SNAPSHOT_KEYS.version),
    kvGet(db, SNAPSHOT_KEYS.dirty),
    kvGet(db, SNAPSHOT_KEYS.pushedAt),
    kvGet(db, SNAPSHOT_KEYS.pulledAt),
    kvGet(db, SNAPSHOT_KEYS.replaced),
    kvGet(db, SNAPSHOT_KEYS.conflict),
    kvGet(db, SNAPSHOT_KEYS.lastError),
  ]);
  return {
    version: versionOf(version),
    dirty: dirty === '1',
    pushedAt,
    pulledAt,
    replaced: versionOf(replaced),
    conflict: versionOf(conflict),
    lastError,
  };
}

/** Every local write calls this; the next sync knows there is something to save. */
export async function markSnapshotDirty(db: SqlExecutor): Promise<void> {
  await kvSet(db, SNAPSHOT_KEYS.dirty, '1');
}

/** True when this database holds an athlete, the least a copy worth keeping has. */
export async function hasOwnData(db: SqlExecutor): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM athlete');
  return (row?.n ?? 0) > 0;
}

/* --------------------------------------------------------------- adopt */

type Row = Record<string, string | number | null | Uint8Array>;

async function readTable(db: SqlExecutor, table: string): Promise<Row[]> {
  return db.getAllAsync<Row>(`SELECT * FROM ${table}`);
}

async function writeTable(db: SqlExecutor, table: string, rows: readonly Row[]): Promise<void> {
  await db.runAsync(`DELETE FROM ${table}`);
  for (const row of rows) {
    const columns = Object.keys(row);
    if (columns.length === 0) continue;
    await db.runAsync(
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => row[column] ?? null),
    );
  }
}

export interface AdoptOptions {
  /** Brings an older copy up to this build's schema. Defaults to the app's migrator. */
  readonly migrate?: (db: SqlExecutor) => Promise<unknown>;
}

/**
 * Makes this database the server's copy, keeping what is this device's own.
 * The caller invalidates everything cached above the executor afterwards.
 */
export async function adoptSnapshot(
  db: SqlExecutor,
  meta: SnapshotMeta,
  bytes: Uint8Array,
  options: AdoptOptions = {},
): Promise<void> {
  const kept = new Map<string, Row[]>();
  for (const table of DEVICE_TABLES) kept.set(table, await readTable(db, table));

  await db.replaceAsync(bytes);
  await (options.migrate ?? migrate)(db);

  await db.withTransactionAsync(async () => {
    for (const table of DEVICE_TABLES) await writeTable(db, table, kept.get(table) ?? []);
    await kvSet(db, SNAPSHOT_KEYS.version, String(meta.version));
    await kvSet(db, SNAPSHOT_KEYS.dirty, '0');
    await kvSet(db, SNAPSHOT_KEYS.pulledAt, nowIso());
    await kvDelete(db, SNAPSHOT_KEYS.conflict);
    await kvDelete(db, SNAPSHOT_KEYS.lastError);
  });
}

/* ------------------------------------------------------------------ push */

export type PushOutcome =
  | { readonly kind: 'pushed'; readonly meta: SnapshotMeta }
  | { readonly kind: 'conflict'; readonly current: SnapshotMeta | null }
  | { readonly kind: 'too_large'; readonly bytes: number };

export interface PushOptions {
  readonly force: boolean;
  readonly schemaVersion?: number;
}

/** Saves this database to the server as a new version. */
export async function pushSnapshot(
  db: SqlExecutor,
  remote: SnapshotRemote,
  options: PushOptions,
): Promise<PushOutcome> {
  const local = await snapshotLocal(db);
  const bytes = await db.serializeAsync();
  if (bytes.byteLength > SNAPSHOT_MAX_BYTES) return { kind: 'too_large', bytes: bytes.byteLength };
  const result = await remote.upload(bytes, {
    schemaVersion: options.schemaVersion ?? SCHEMA_VERSION,
    baseVersion: local.version,
    force: options.force,
  });
  if (!result.ok) return { kind: 'conflict', current: result.current };
  await kvSet(db, SNAPSHOT_KEYS.version, String(result.meta.version));
  await kvSet(db, SNAPSHOT_KEYS.dirty, '0');
  await kvSet(db, SNAPSHOT_KEYS.pushedAt, nowIso());
  await kvDelete(db, SNAPSHOT_KEYS.conflict);
  await kvDelete(db, SNAPSHOT_KEYS.lastError);
  return { kind: 'pushed', meta: result.meta };
}

/* ------------------------------------------------------------------ sync */

export type SnapshotSyncReason = 'boot' | 'focus' | 'write' | 'manual';

export type SnapshotSyncResult =
  | { readonly kind: 'noop' }
  | { readonly kind: 'pushed'; readonly meta: SnapshotMeta }
  | { readonly kind: 'pulled'; readonly meta: SnapshotMeta }
  /** Saved over a newer server copy; `passed` is the copy Settings can restore. */
  | { readonly kind: 'replaced_server'; readonly meta: SnapshotMeta; readonly passed: SnapshotMeta | null }
  /** This device holds its own data and never adopted a copy: Settings asks. */
  | { readonly kind: 'conflict'; readonly server: SnapshotMeta }
  | { readonly kind: 'app_outdated'; readonly server: SnapshotMeta }
  | { readonly kind: 'too_large'; readonly bytes: number }
  | { readonly kind: 'error'; readonly message: string; readonly reauth: boolean };

export interface SyncOptions {
  readonly reason: SnapshotSyncReason;
  readonly schemaVersion?: number;
  readonly migrate?: AdoptOptions['migrate'];
}

async function pull(
  db: SqlExecutor,
  remote: SnapshotRemote,
  version: number,
  options: SyncOptions,
): Promise<SnapshotSyncResult> {
  const got = await remote.download(version);
  if (got === null) return { kind: 'noop' };
  await adoptSnapshot(db, got.meta, got.bytes, { migrate: options.migrate });
  return { kind: 'pulled', meta: got.meta };
}

async function pushOrReplace(
  db: SqlExecutor,
  remote: SnapshotRemote,
  force: boolean,
  passed: SnapshotMeta | null,
  options: SyncOptions,
): Promise<SnapshotSyncResult> {
  const first = await pushSnapshot(db, remote, { force, schemaVersion: options.schemaVersion });
  if (first.kind === 'too_large') return first;
  if (first.kind === 'pushed') {
    if (passed === null) return first;
    await kvSet(db, SNAPSHOT_KEYS.replaced, String(passed.version));
    return { kind: 'replaced_server', meta: first.meta, passed };
  }
  // Someone saved between the look and the save. The athlete's latest act was
  // still here, so this copy stands and the one it passed is recorded.
  const second = await pushSnapshot(db, remote, { force: true, schemaVersion: options.schemaVersion });
  if (second.kind !== 'pushed') {
    return second.kind === 'too_large' ? second : { kind: 'noop' };
  }
  const overwritten = first.current ?? passed;
  if (overwritten !== null) await kvSet(db, SNAPSHOT_KEYS.replaced, String(overwritten.version));
  return { kind: 'replaced_server', meta: second.meta, passed: overwritten };
}

/**
 * One pass of the rules in the header. Safe to call on every trigger: a pass
 * with nothing to do costs one small request.
 */
export async function syncSnapshot(
  db: SqlExecutor,
  remote: SnapshotRemote,
  options: SyncOptions,
): Promise<SnapshotSyncResult> {
  const schemaVersion = options.schemaVersion ?? SCHEMA_VERSION;
  try {
    const local = await snapshotLocal(db);
    const server = await remote.meta();

    if (server === null) {
      if (!(await hasOwnData(db))) return { kind: 'noop' };
      return pushOrReplace(db, remote, false, null, options);
    }
    if (server.schemaVersion > schemaVersion) return { kind: 'app_outdated', server };

    if (local.version === null) {
      if (await hasOwnData(db)) {
        await kvSet(db, SNAPSHOT_KEYS.conflict, String(server.version));
        return { kind: 'conflict', server };
      }
      return pull(db, remote, server.version, options);
    }

    if (server.version > local.version) {
      if (!local.dirty) return pull(db, remote, server.version, options);
      return pushOrReplace(db, remote, true, server, options);
    }
    if (server.version < local.version) {
      // The server went backwards (a restore elsewhere, or a pruned copy). The
      // athlete's newest data is here; it becomes the newest copy again.
      return pushOrReplace(db, remote, true, server, options);
    }
    if (local.dirty) return pushOrReplace(db, remote, false, null, options);
    return { kind: 'noop' };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'The sync failed.';
    const reauth = caught instanceof ApiRequestError && caught.kind === 'needs_reauth';
    await kvSet(db, SNAPSHOT_KEYS.lastError, message).catch(() => undefined);
    return { kind: 'error', message, reauth };
  }
}

/* --------------------------------------------------------- decisions */

/** The first-sync conflict, answered "keep this device's data". */
export async function keepThisDevice(db: SqlExecutor, remote: SnapshotRemote): Promise<PushOutcome> {
  const outcome = await pushSnapshot(db, remote, { force: true });
  if (outcome.kind === 'pushed') await kvDelete(db, SNAPSHOT_KEYS.conflict);
  return outcome;
}

/** The first-sync conflict, answered "use the server's data". Drops what is here. */
export async function useServerCopy(
  db: SqlExecutor,
  remote: SnapshotRemote,
  options: AdoptOptions = {},
): Promise<SnapshotMeta | null> {
  const got = await remote.download(null);
  if (got === null) return null;
  await adoptSnapshot(db, got.meta, got.bytes, options);
  return got.meta;
}

/**
 * Brings an older copy back: adopts it here and saves it as the newest
 * version, so every other device adopts it too at its next open.
 */
export async function restoreSnapshot(
  db: SqlExecutor,
  remote: SnapshotRemote,
  version: number,
  options: AdoptOptions = {},
): Promise<SnapshotMeta | null> {
  const got = await remote.download(version);
  if (got === null) return null;
  await adoptSnapshot(db, got.meta, got.bytes, options);
  const pushed = await pushSnapshot(db, remote, { force: true });
  await kvDelete(db, SNAPSHOT_KEYS.replaced);
  return pushed.kind === 'pushed' ? pushed.meta : got.meta;
}

/** The athlete has seen which copy their save passed over. */
export async function dismissReplaced(db: SqlExecutor): Promise<void> {
  await kvDelete(db, SNAPSHOT_KEYS.replaced);
}
