import type { SqlExecutor } from '../executor';
import { nowIso } from './rows';

/**
 * Small durable strings: settings, the last sync stamp, and the coach marks
 * the athlete has dismissed. Anything with structure gets a table.
 */

export const KV_KEYS = {
  lastSyncedAt: 'sync.lastSyncedAt',
  coachMarks: 'coachMarks.dismissed',
  unitPreference: 'settings.units',
  fixtureSeededAt: 'fixture.seededAt',
  restTimer: 'session.restTimer',
} as const;

export async function kvGet(db: SqlExecutor, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function kvSet(db: SqlExecutor, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, nowIso()],
  );
}

export async function kvDelete(db: SqlExecutor, key: string): Promise<void> {
  await db.runAsync('DELETE FROM kv WHERE key = ?', [key]);
}

export async function kvGetAll(db: SqlExecutor): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM kv');
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/* ----------------------------------------------------------- coach marks */

async function readMarks(db: SqlExecutor): Promise<string[]> {
  const raw = await kvGet(db, KV_KEYS.coachMarks);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function listDismissedCoachMarks(db: SqlExecutor): Promise<string[]> {
  return readMarks(db);
}

export async function isCoachMarkDismissed(db: SqlExecutor, mark: string): Promise<boolean> {
  return (await readMarks(db)).includes(mark);
}

/** Dismissal persists: a coach mark is shown once, then never again. */
export async function dismissCoachMark(db: SqlExecutor, mark: string): Promise<string[]> {
  const marks = await readMarks(db);
  if (marks.includes(mark)) return marks;
  const next = [...marks, mark];
  await kvSet(db, KV_KEYS.coachMarks, JSON.stringify(next));
  return next;
}

export async function resetCoachMarks(db: SqlExecutor): Promise<void> {
  await kvDelete(db, KV_KEYS.coachMarks);
}
