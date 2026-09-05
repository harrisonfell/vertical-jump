/**
 * What every projection needs before it can write a row.
 *
 * The rejection type, the two ways an op fails its own shape, and the three
 * things the phone leaves out because there is only one of them: the athlete,
 * the current program, and the transaction handle they are read through.
 *
 * It lives beside project.ts rather than inside it so that file stays a list
 * of projections and nothing else.
 */

import { desc, eq } from 'drizzle-orm';
import type { SyncOp, SyncRejectReason } from '../api-contract';
import type { Database } from '../../db/client';
import { athlete, program } from '../../db/tables/mirror';
import { OWNER_ATHLETE_ID, readPatch, type Patch } from './payloads';

/** The transaction handle drizzle hands the callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Thrown by a projection to roll its transaction back with a named reason. */
export class Rejected extends Error {
  readonly reason: SyncRejectReason;

  constructor(reason: SyncRejectReason, message: string) {
    super(message);
    this.name = 'Rejected';
    this.reason = reason;
  }
}

/**
 * Postgres 23505: a unique constraint, whichever one it was.
 *
 * The driver's error is wrapped by drizzle, so the cause chain is walked
 * rather than the top object read: the code is what says "unique", and a
 * message match would break the day a locale changes.
 */
export function isUniqueViolation(caught: unknown): boolean {
  let current: unknown = caught;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The patch was parsed from a schema that mirrors the table column for column,
 * so naming it as the table's own insert type is a rename, not a leap.
 */
export function forTable<T>(patch: Patch): T {
  return patch as T;
}

export function parseOr(
  schema: Parameters<typeof readPatch>[0],
  payload: SyncOp['payload'],
): Patch {
  const patch = readPatch(schema, payload);
  if (patch === null) {
    throw new Rejected('invalid_payload', 'The payload is not the shape this op takes.');
  }
  return patch;
}

export function requireEntity(op: SyncOp): string {
  if (op.entityId === null || op.entityId === '') {
    throw new Rejected('missing_entity', 'The op names no entity to apply it to.');
  }
  return op.entityId;
}

export function record(value: SyncOp['payload']): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Rejected('invalid_payload', 'The payload is not an object.');
  }
  return value as Record<string, unknown>;
}

/** The athlete an op belongs to: the row that is there, else the phone's id. */
export async function ownerAthleteId(tx: Tx): Promise<string> {
  const rows = await tx.select({ id: athlete.id }).from(athlete).limit(1);
  return rows[0]?.id ?? OWNER_ATHLETE_ID;
}

/**
 * The program a week or a session hangs on.
 *
 * There is one owner and one live program, and the phone's `week.upsert` and
 * `session.patch` name neither, so the current program is read rather than
 * invented.
 */
async function currentProgramId(tx: Tx): Promise<string | null> {
  const active = await tx
    .select({ id: program.id })
    .from(program)
    .where(eq(program.status, 'active'))
    .orderBy(desc(program.startDate))
    .limit(1);
  if (active[0] !== undefined) return active[0].id;
  const any = await tx
    .select({ id: program.id })
    .from(program)
    .orderBy(desc(program.startDate))
    .limit(1);
  return any[0]?.id ?? null;
}

/**
 * The program id a patch names, or the current one, or null.
 *
 * Null rather than a rejection: a week or a session that reaches the server
 * before the program it belongs to is still worth keeping, and the column is
 * filled in by the next op that names it.
 */
export async function programIdFor(tx: Tx, patch: Patch): Promise<string | null> {
  const named = patch['programId'];
  if (typeof named === 'string' && named !== '') return named;
  return currentProgramId(tx);
}
