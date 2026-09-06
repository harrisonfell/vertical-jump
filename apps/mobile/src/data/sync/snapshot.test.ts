import { describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../executor';
import { SCHEMA_VERSION } from '../migrate';
import { getAthlete, upsertAthlete } from '../store/athlete';
import { kvGet, kvSet } from '../store/kv';
import { enqueue, listPending } from '../store/sync';
import { openMigratedTestDb } from '../testing/testDb';
import type { SnapshotMeta } from './apiContract';
import {
  SNAPSHOT_KEYS,
  keepThisDevice,
  markSnapshotDirty,
  restoreSnapshot,
  snapshotLocal,
  syncSnapshot,
  useServerCopy,
  type SnapshotRemote,
  type UploadOptions,
  type UploadResult,
} from './snapshot';

/**
 * Two devices, one server, no network.
 *
 * The server here keeps the same promise the real one does: a save whose base
 * is not the newest version is refused with that version, a forced save
 * lands, and older copies stay. Everything else is the phone's own code over
 * two in-memory sql.js databases, so what these tests prove is the rule set
 * in snapshot.ts, end to end, on real SQLite files.
 */

interface Stored {
  readonly meta: SnapshotMeta;
  readonly bytes: Uint8Array;
}

class MemoryServer implements SnapshotRemote {
  readonly saved: Stored[] = [];
  schemaOverride: number | null = null;

  private latest(): Stored | null {
    return this.saved[this.saved.length - 1] ?? null;
  }

  async meta(): Promise<SnapshotMeta | null> {
    const latest = this.latest();
    if (latest === null) return null;
    return this.schemaOverride === null
      ? latest.meta
      : { ...latest.meta, schemaVersion: this.schemaOverride };
  }

  async download(version: number | null): Promise<Stored | null> {
    if (version === null) return this.latest();
    return this.saved.find((entry) => entry.meta.version === version) ?? null;
  }

  async upload(bytes: Uint8Array, options: UploadOptions): Promise<UploadResult> {
    const latest = this.latest();
    const current = latest === null ? null : latest.meta.version;
    if (!options.force && current !== options.baseVersion) {
      return { ok: false, current: latest === null ? null : latest.meta };
    }
    const meta: SnapshotMeta = {
      version: (current ?? 0) + 1,
      byteLength: bytes.byteLength,
      sha256: `sha-${bytes.byteLength}`,
      schemaVersion: options.schemaVersion,
      origin: 'device',
      deviceId: 'dev_test',
      baseVersion: options.baseVersion,
      createdAt: '2026-09-06T10:00:00.000Z',
    };
    this.saved.push({ meta, bytes: new Uint8Array(bytes) });
    return { ok: true, meta };
  }

  async versions(): Promise<SnapshotMeta[]> {
    return [...this.saved].reverse().map((entry) => entry.meta);
  }
}

async function deviceWithAthlete(sport: string): Promise<SqlExecutor> {
  const db = await openMigratedTestDb();
  await upsertAthlete(db, { sport, daysPerWeek: 4, timezone: 'America/New_York' });
  return db;
}

async function versionOn(db: SqlExecutor): Promise<number | null> {
  return (await snapshotLocal(db)).version;
}

describe('the first device and a fresh second one', () => {
  it('saves the first copy, and a fresh device adopts it whole', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('speed_climbing');

    const first = await syncSnapshot(phone, server, { reason: 'boot' });
    expect(first.kind).toBe('pushed');
    expect(server.saved).toHaveLength(1);
    expect(await versionOn(phone)).toBe(1);
    expect((await snapshotLocal(phone)).dirty).toBe(false);

    const laptop = await openMigratedTestDb();
    expect(await getAthlete(laptop)).toBeNull();
    const second = await syncSnapshot(laptop, server, { reason: 'boot' });
    expect(second.kind).toBe('pulled');
    expect((await getAthlete(laptop))?.sport).toBe('speed_climbing');
    expect(await versionOn(laptop)).toBe(1);

    await phone.closeAsync();
    await laptop.closeAsync();
  });

  it('does nothing on an empty device with an empty server', async () => {
    const server = new MemoryServer();
    const fresh = await openMigratedTestDb();
    expect((await syncSnapshot(fresh, server, { reason: 'boot' })).kind).toBe('noop');
    expect(server.saved).toHaveLength(0);
    await fresh.closeAsync();
  });

  it('keeps what belongs to the device when a copy is adopted', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('basketball');
    // The phone's own outbox travels in its file; the laptop must not inherit it.
    await enqueue(phone, { kind: 'athlete.upsert', entityId: 'athlete', payload: { sport: 'x' } });
    await syncSnapshot(phone, server, { reason: 'boot' });

    const laptop = await openMigratedTestDb();
    await enqueue(laptop, { kind: 'pain.clear', entityId: 'p1', payload: { id: 'p1' } });
    await kvSet(laptop, 'settings.units', 'kg');
    await kvSet(laptop, 'sync.mirrorCursor', 'cursor-7');

    expect((await syncSnapshot(laptop, server, { reason: 'boot' })).kind).toBe('pulled');

    const pending = await listPending(laptop);
    expect(pending.map((row) => row.op)).toEqual(['pain.clear']);
    expect(await kvGet(laptop, 'settings.units')).toBe('kg');
    expect(await kvGet(laptop, 'sync.mirrorCursor')).toBe('cursor-7');
    expect((await getAthlete(laptop))?.sport).toBe('basketball');

    await phone.closeAsync();
    await laptop.closeAsync();
  });
});

describe('two devices taking turns', () => {
  it('carries a change from one device to the other', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('basketball');
    const laptop = await openMigratedTestDb();
    await syncSnapshot(phone, server, { reason: 'boot' });
    await syncSnapshot(laptop, server, { reason: 'boot' });

    await upsertAthlete(laptop, { sport: 'speed_climbing' });
    await markSnapshotDirty(laptop);
    const saved = await syncSnapshot(laptop, server, { reason: 'write' });
    expect(saved.kind).toBe('pushed');
    expect(await versionOn(laptop)).toBe(2);

    // Nothing changed on the phone, so it adopts the laptop's copy at its next open.
    const adopted = await syncSnapshot(phone, server, { reason: 'boot' });
    expect(adopted.kind).toBe('pulled');
    expect((await getAthlete(phone))?.sport).toBe('speed_climbing');
    expect(await versionOn(phone)).toBe(2);

    // And a pass with nothing to do is a no-op on both.
    expect((await syncSnapshot(phone, server, { reason: 'focus' })).kind).toBe('noop');
    expect((await syncSnapshot(laptop, server, { reason: 'focus' })).kind).toBe('noop');

    await phone.closeAsync();
    await laptop.closeAsync();
  });

  it('lets the device that changed last stand, and records the copy it passed', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('basketball');
    const laptop = await openMigratedTestDb();
    await syncSnapshot(phone, server, { reason: 'boot' });
    await syncSnapshot(laptop, server, { reason: 'boot' });

    // The laptop saves version 2 while the phone, still on 1, logs a change offline.
    await upsertAthlete(laptop, { sport: 'football' });
    await markSnapshotDirty(laptop);
    await syncSnapshot(laptop, server, { reason: 'write' });
    await upsertAthlete(phone, { sport: 'speed_climbing' });
    await markSnapshotDirty(phone);

    const result = await syncSnapshot(phone, server, { reason: 'boot' });
    expect(result.kind).toBe('replaced_server');
    if (result.kind !== 'replaced_server') return;
    expect(result.meta.version).toBe(3);
    expect(result.passed?.version).toBe(2);
    expect((await snapshotLocal(phone)).replaced).toBe(2);
    expect((await getAthlete(phone))?.sport).toBe('speed_climbing');

    // The laptop adopts the phone's copy; the copy it saved is still there.
    expect((await syncSnapshot(laptop, server, { reason: 'boot' })).kind).toBe('pulled');
    expect((await getAthlete(laptop))?.sport).toBe('speed_climbing');
    expect((await server.versions()).map((meta) => meta.version)).toEqual([3, 2, 1]);

    // Restoring the passed copy brings it back here and makes it the newest.
    const restored = await restoreSnapshot(phone, server, 2);
    expect(restored?.version).toBe(4);
    expect((await getAthlete(phone))?.sport).toBe('football');
    expect((await snapshotLocal(phone)).replaced).toBeNull();

    await phone.closeAsync();
    await laptop.closeAsync();
  });
});

describe('the decisions the sync never takes alone', () => {
  it('asks when a never-synced device already holds data and the server has a copy', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('basketball');
    await syncSnapshot(phone, server, { reason: 'boot' });

    const laptop = await deviceWithAthlete('soccer');
    const asked = await syncSnapshot(laptop, server, { reason: 'boot' });
    expect(asked.kind).toBe('conflict');
    expect((await snapshotLocal(laptop)).conflict).toBe(1);
    // Nothing was thrown away on a guess, and nothing was saved either.
    expect((await getAthlete(laptop))?.sport).toBe('soccer');
    expect(server.saved).toHaveLength(1);
    // Asking again stays a conflict rather than saving behind the athlete's back.
    expect((await syncSnapshot(laptop, server, { reason: 'focus' })).kind).toBe('conflict');

    // "Keep this device's data": the laptop's copy becomes the newest.
    const kept = await keepThisDevice(laptop, server);
    expect(kept.kind).toBe('pushed');
    expect((await snapshotLocal(laptop)).conflict).toBeNull();
    expect(await versionOn(laptop)).toBe(2);
    expect((await syncSnapshot(phone, server, { reason: 'boot' })).kind).toBe('pulled');
    expect((await getAthlete(phone))?.sport).toBe('soccer');

    await phone.closeAsync();
    await laptop.closeAsync();
  });

  it('or takes the server\'s copy instead', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('basketball');
    await syncSnapshot(phone, server, { reason: 'boot' });

    const laptop = await deviceWithAthlete('soccer');
    expect((await syncSnapshot(laptop, server, { reason: 'boot' })).kind).toBe('conflict');
    const adopted = await useServerCopy(laptop, server);
    expect(adopted?.version).toBe(1);
    expect((await getAthlete(laptop))?.sport).toBe('basketball');
    expect((await snapshotLocal(laptop)).conflict).toBeNull();
    expect(await versionOn(laptop)).toBe(1);

    await phone.closeAsync();
    await laptop.closeAsync();
  });

  it('stops when the server copy was written by a newer app', async () => {
    const server = new MemoryServer();
    const phone = await deviceWithAthlete('basketball');
    await syncSnapshot(phone, server, { reason: 'boot' });
    server.schemaOverride = SCHEMA_VERSION + 1;

    const laptop = await openMigratedTestDb();
    const result = await syncSnapshot(laptop, server, { reason: 'boot' });
    expect(result.kind).toBe('app_outdated');
    expect(await getAthlete(laptop)).toBeNull();

    await phone.closeAsync();
    await laptop.closeAsync();
  });

  it('records a failure and leaves the database as it was', async () => {
    const server = new MemoryServer();
    const broken: SnapshotRemote = {
      meta: async () => {
        throw new Error('the wire went dead');
      },
      download: (version) => server.download(version),
      upload: (bytes, options) => server.upload(bytes, options),
      versions: () => server.versions(),
    };
    const phone = await deviceWithAthlete('basketball');
    const result = await syncSnapshot(phone, broken, { reason: 'boot' });
    expect(result.kind).toBe('error');
    expect(await kvGet(phone, SNAPSHOT_KEYS.lastError)).toBe('the wire went dead');
    expect((await getAthlete(phone))?.sport).toBe('basketball');
    await phone.closeAsync();
  });
});
