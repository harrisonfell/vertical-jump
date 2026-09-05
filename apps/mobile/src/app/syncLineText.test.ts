import { describe, expect, it } from 'vitest';
import {
  changeCount,
  formatClock,
  serverConfigured,
  serverUrl,
  syncLineText,
  waitingDays,
  type SyncLineInput,
} from './syncLineText';

const NOW = new Date('2026-10-22T18:41:00.000Z');

function line(patch: Partial<SyncLineInput> = {}): string | null {
  return syncLineText({
    serverConfigured: true,
    online: true,
    pending: 0,
    oldestPendingAt: null,
    lastSyncedAt: null,
    now: NOW,
    ...patch,
  });
}

describe('server configuration', () => {
  it('treats an unset or blank URL as no server', () => {
    expect(serverUrl(undefined)).toBeNull();
    expect(serverUrl('   ')).toBeNull();
    expect(serverUrl('https://vert.example')).toBe('https://vert.example');
    expect(serverConfigured(undefined)).toBe(false);
    expect(serverConfigured('https://vert.example')).toBe(true);
  });
});

describe('counting', () => {
  it('says one change, not 1 changes', () => {
    expect(changeCount(1)).toBe('1 change');
    expect(changeCount(4)).toBe('4 changes');
  });

  it('counts whole waiting days and shrugs off a broken stamp', () => {
    expect(waitingDays(null, NOW)).toBe(0);
    expect(waitingDays('2026-10-20T18:41:00.000Z', NOW)).toBe(2);
    expect(waitingDays('2026-10-22T06:00:00.000Z', NOW)).toBe(0);
    expect(waitingDays('not a date', NOW)).toBe(0);
    // A stamp from the future never counts backwards.
    expect(waitingDays('2026-11-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it('returns null rather than a wrong clock', () => {
    expect(formatClock('not a date')).toBeNull();
    expect(formatClock('2026-10-22T18:41:00.000Z')).toMatch(/\d/);
  });
});

describe('syncLineText', () => {
  it('renders nothing when there is no server to sync to', () => {
    expect(line({ serverConfigured: false, pending: 4 })).toBeNull();
  });

  it('renders nothing when the queue is empty and nothing has ever synced', () => {
    expect(line()).toBeNull();
  });

  it('reports the last sync when the queue is empty', () => {
    const text = line({ lastSyncedAt: '2026-10-22T18:41:00.000Z' });
    expect(text).not.toBeNull();
    expect(text?.startsWith('Synced ')).toBe(true);
  });

  it('names the offline case with the count', () => {
    expect(line({ online: false, pending: 4, oldestPendingAt: '2026-10-22T17:00:00.000Z' })).toBe(
      'Offline · 4 changes saved on this phone',
    );
    expect(line({ online: false, pending: 1, oldestPendingAt: '2026-10-22T17:00:00.000Z' })).toBe(
      'Offline · 1 change saved on this phone',
    );
  });

  it('drops the offline word once the phone is back on', () => {
    expect(line({ pending: 4, oldestPendingAt: '2026-10-22T17:00:00.000Z' })).toBe(
      '4 changes saved on this phone',
    );
  });

  it('escalates after two days, online or not', () => {
    const stale = { pending: 4, oldestPendingAt: '2026-10-20T10:00:00.000Z' };
    expect(line(stale)).toBe('4 changes not synced for 2 days');
    expect(line({ ...stale, online: false })).toBe('4 changes not synced for 2 days');
    expect(line({ pending: 1, oldestPendingAt: '2026-10-19T10:00:00.000Z' })).toBe(
      '1 change not synced for 3 days',
    );
  });
});
