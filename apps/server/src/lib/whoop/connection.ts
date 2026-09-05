/**
 * The one connection row, and the status body the app reads.
 *
 * There is a single owner, so there is a single row, id 'owner'. Everything
 * the Settings screen renders comes from it: the state word, the backfill
 * counters, the last error and the instant of the next attempt. Nothing here
 * ever invents a number: a connection that has never been made reports zeros
 * and nulls rather than a made-up total.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { WHOOP_CONNECTION_ID, whoopConnection } from '../../db/tables/whoop';
import type { WhoopErrorKind, WhoopStatus, WhoopStatusResponse } from '../api-contract';
import { WHOOP_BACKFILL_DAYS } from '../api-contract';

export type ConnectionRow = typeof whoopConnection.$inferSelect;

/** What the app sees before anything has ever been connected. */
export const DISCONNECTED_STATUS: WhoopStatusResponse = {
  status: 'disconnected',
  whoopUserId: null,
  connectedAt: null,
  lastSyncAt: null,
  backfillDaysDone: 0,
  backfillDaysTotal: 0,
  lastError: null,
  nextRetryAt: null,
};

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toStatusResponse(row: ConnectionRow | null | undefined): WhoopStatusResponse {
  if (row === null || row === undefined) return DISCONNECTED_STATUS;
  return {
    status: row.status,
    whoopUserId: row.whoopUserId,
    connectedAt: iso(row.connectedAt),
    lastSyncAt: iso(row.lastSyncAt),
    backfillDaysDone: row.backfillDaysDone,
    backfillDaysTotal: row.backfillDaysTotal,
    lastError: row.lastError,
    nextRetryAt: iso(row.nextRetryAt),
  };
}

export async function readConnection(db: Database): Promise<ConnectionRow | null> {
  const rows = await db
    .select()
    .from(whoopConnection)
    .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));
  return rows[0] ?? null;
}

/** The row, creating an empty disconnected one the first time it is asked for. */
export async function ensureConnection(
  db: Database,
  now: Date = new Date(),
): Promise<ConnectionRow> {
  const existing = await readConnection(db);
  if (existing !== null) return existing;
  await db
    .insert(whoopConnection)
    .values({ id: WHOOP_CONNECTION_ID, status: 'disconnected', updatedAt: now })
    .onConflictDoNothing();
  const created = await readConnection(db);
  if (created === null) throw new Error('The Whoop connection row could not be created.');
  return created;
}

type ConnectionPatch = Partial<Omit<typeof whoopConnection.$inferInsert, 'id' | 'updatedAt'>>;

/** One write, bumping row_version so a stale writer can be spotted. */
export async function patchConnection(
  db: Database,
  patch: ConnectionPatch,
  now: Date = new Date(),
): Promise<ConnectionRow> {
  const row = await ensureConnection(db, now);
  await db
    .update(whoopConnection)
    .set({ ...patch, rowVersion: row.rowVersion + 1, updatedAt: now })
    .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));
  const updated = await readConnection(db);
  return updated ?? row;
}

/**
 * Whoop said no. `needs_reauth` means the grant is gone, which is a state the
 * owner has to act on; the other three are weather, so the status carries the
 * instant of the next attempt and the app says "retrying at 7:15".
 */
export async function markConnectionError(
  db: Database,
  kind: WhoopErrorKind,
  nextRetryAt: Date | null,
  now: Date = new Date(),
): Promise<ConnectionRow> {
  const revoked = kind === 'needs_reauth';
  return patchConnection(
    db,
    {
      status: revoked ? 'revoked' : 'error',
      lastError: kind,
      nextRetryAt,
      ...(revoked ? { revokedAt: now, accessTokenCipher: null, refreshTokenCipher: null } : {}),
    },
    now,
  );
}

/** The callback just stored a token pair: 90 days are now owed. */
export async function beginBackfill(
  db: Database,
  whoopUserId: string | null,
  now: Date = new Date(),
): Promise<ConnectionRow> {
  return patchConnection(
    db,
    {
      status: 'importing',
      whoopUserId,
      backfillCursor: null,
      backfillDaysDone: 0,
      backfillDaysTotal: WHOOP_BACKFILL_DAYS,
      lastError: null,
      nextRetryAt: null,
      revokedAt: null,
      connectedAt: now,
    },
    now,
  );
}

/** Forgets the token pair. The mirrors stay; only /api/whoop/data removes those. */
export async function clearTokens(
  db: Database,
  status: WhoopStatus,
  now: Date = new Date(),
): Promise<ConnectionRow> {
  return patchConnection(
    db,
    {
      status,
      accessTokenCipher: null,
      refreshTokenCipher: null,
      expiresAt: null,
      backfillCursor: null,
      lastError: null,
      nextRetryAt: null,
      revokedAt: status === 'revoked' ? now : null,
      ...(status === 'disconnected'
        ? { whoopUserId: null, connectedAt: null, backfillDaysDone: 0, backfillDaysTotal: 0 }
        : {}),
    },
    now,
  );
}
