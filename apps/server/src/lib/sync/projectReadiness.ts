/**
 * The two projections the climbing readiness gate adds
 * (`house.sc.readiness_gate`).
 *
 * They live beside project.ts rather than inside it because that file is a
 * list of projections and is already at its reading length; nothing here is
 * different in kind from what is in there.
 */


import type { SyncOp } from '../api-contract';
import { readinessOutcome, readinessTestSession } from '../../db/tables/mirror';
import {
  READINESS_OUTCOME_REQUIRED,
  READINESS_TEST_REQUIRED,
  hasAll,
  readinessOutcomePatch,
  readinessTestPatch,
} from './payloads';
import { Rejected, forTable, ownerAthleteId, parseOr, type Tx } from './projectContext';

/**
 * The gate's neuromuscular test (`house.sc.readiness_gate`).
 *
 * Keyed on the phone's own id, so re-logging the day (the phone replaces the
 * day's row rather than adding one) lands on the same row here.
 */
export async function applyReadinessTest(tx: Tx, id: string, op: SyncOp): Promise<void> {
  const patch = parseOr(readinessTestPatch, op.payload);
  if (!hasAll(patch, READINESS_TEST_REQUIRED)) {
    throw new Rejected('invalid_payload', 'A readiness test needs a local date and a kind.');
  }
  const values = {
    ...patch,
    id,
    athleteId: typeof patch['athleteId'] === 'string' ? patch['athleteId'] : await ownerAthleteId(tx),
    createdAt: typeof patch['createdAt'] === 'string' ? patch['createdAt'] : op.createdAt,
  };
  await tx
    .insert(readinessTestSession)
    .values(forTable<typeof readinessTestSession.$inferInsert>(values))
    .onConflictDoUpdate({ target: readinessTestSession.id, set: forTable(patch) });
}

/** The gate's answer for one session. One row a session: today replaces today. */
export async function applyReadinessOutcome(tx: Tx, sessionId: string, op: SyncOp): Promise<void> {
  const patch = parseOr(readinessOutcomePatch, op.payload);
  if (!hasAll(patch, READINESS_OUTCOME_REQUIRED)) {
    throw new Rejected('invalid_payload', 'A readiness outcome needs a local date and a state.');
  }
  const values = {
    ...patch,
    sessionId,
    appliedAt: typeof patch['appliedAt'] === 'string' ? patch['appliedAt'] : op.createdAt,
  };
  await tx
    .insert(readinessOutcome)
    .values(forTable<typeof readinessOutcome.$inferInsert>(values))
    .onConflictDoUpdate({ target: readinessOutcome.sessionId, set: forTable(values) });
}
