/**
 * Turning one pushed op into rows.
 *
 * The phone sends patches, not rows: `session.patch` carries only what
 * changed, `week.upsert` carries `{ w }`, `setLog.upsert` carries the whole
 * saved log. So every projection here is patch-or-insert.
 *
 * A patch too thin to fill every column still creates the row. It used to
 * wait for a fuller op instead, and no fuller op exists in the app: every
 * `program.create`, `week.upsert`, `week.generated`, `session.patch` and
 * `session.move` was accepted, recorded as applied, and projected nothing, so
 * the server's copy of the program, the weeks and the sessions stayed empty
 * for ever while the phone marked its queue rows synced. The columns the phone
 * never sends are nullable now, so the row lands with what is known and a
 * later op fills the rest. What genuinely cannot be invented (the athlete, the
 * program a week hangs on) is derived from the single owner's own rows, and an
 * op that still cannot be honoured is rejected by name rather than dropped in
 * silence.
 *
 * A projection that cannot be honoured throws `Rejected`, which rolls its
 * transaction back and names the reason the push response carries. Nothing
 * here commits: the caller owns the transaction, so an op lands whole or not
 * at all.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { SyncOp } from '../api-contract';
import { importBatch } from '../../db/tables/account';
import {
  athlete,
  jumpRep,
  jumpTestSession,
  painStatus,
  program,
  session,
  sessionEvent,
  setLog,
  week,
} from '../../db/tables/mirror';
import { applyReadinessOutcome, applyReadinessTest } from './projectReadiness';
import { sessionWorkoutLink } from '../../db/tables/whoop';
import {
  IMPORT_BATCH_REQUIRED,
  JUMP_TEST_REQUIRED,
  PAIN_REQUIRED,
  PROGRAM_REQUIRED,
  SET_LOG_REQUIRED,
  athletePatch,
  hasAll,
  importBatchPatch,
  jumpTestPatch,
  painPatch,
  programPatch,
  sessionPatch,
  setLogPatch,
  undoSetPayload,
  weekPatch,
  whoopLinkPayload,
  type Patch,
} from './payloads';
import {
  Rejected,
  forTable,
  isUniqueViolation,
  ownerAthleteId,
  parseOr,
  programIdFor,
  record,
  requireEntity,
  type Tx,
} from './projectContext';

export { Rejected, type Tx } from './projectContext';

/* ------------------------------------------------------------ projections */

async function upsertAthlete(tx: Tx, id: string, patch: Patch, op: SyncOp, now: Date): Promise<void> {
  const existing = await tx.select({ id: athlete.id }).from(athlete).where(eq(athlete.id, id)).limit(1);
  if (existing.length > 0) {
    await tx
      .update(athlete)
      .set(forTable({ ...patch, updatedAt: op.createdAt, serverUpdatedAt: now }))
      .where(eq(athlete.id, id));
    return;
  }
  await tx.insert(athlete).values(
    forTable<typeof athlete.$inferInsert>({
      id,
      createdAt: op.createdAt,
      updatedAt: op.createdAt,
      serverUpdatedAt: now,
      ...patch,
    }),
  );
}

async function applyPainReport(tx: Tx, id: string, op: SyncOp): Promise<void> {
  const patch = parseOr(painPatch, op.payload);
  if (!hasAll(patch, PAIN_REQUIRED)) {
    throw new Rejected('invalid_payload', 'A pain report needs a location, a severity, and an onset.');
  }
  const athleteId = typeof patch['athleteId'] === 'string' ? patch['athleteId'] : await ownerAthleteId(tx);
  const reportedAt = typeof patch['reportedAt'] === 'string' ? patch['reportedAt'] : op.createdAt;

  // The phone closes any open row for the same site before opening a new one,
  // so the two copies never disagree about how many sites are live.
  await tx
    .update(painStatus)
    .set({ clearedAt: reportedAt })
    .where(
      and(
        eq(painStatus.athleteId, athleteId),
        eq(painStatus.location, String(patch['location'])),
        isNull(painStatus.clearedAt),
      ),
    );

  await tx
    .insert(painStatus)
    .values(forTable<typeof painStatus.$inferInsert>({ ...patch, id, athleteId, reportedAt }))
    .onConflictDoUpdate({
      target: painStatus.id,
      set: forTable({ ...patch, athleteId, reportedAt }),
    });
}

async function applyWorkingMax(tx: Tx, exerciseId: string, op: SyncOp, now: Date): Promise<void> {
  const rows = await tx.select({ id: athlete.id, workingMax: athlete.workingMax }).from(athlete).limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Rejected('missing_entity', 'There is no athlete to hang a working max on yet.');
  }
  const current =
    typeof row.workingMax === 'object' && row.workingMax !== null && !Array.isArray(row.workingMax)
      ? row.workingMax
      : {};
  await tx
    .update(athlete)
    .set({
      workingMax: { ...current, [exerciseId]: op.payload },
      updatedAt: op.createdAt,
      serverUpdatedAt: now,
    })
    .where(eq(athlete.id, row.id));
}

async function upsertProgram(tx: Tx, id: string, op: SyncOp): Promise<void> {
  const patch = parseOr(programPatch, op.payload);
  const existing = await tx.select({ id: program.id }).from(program).where(eq(program.id, id)).limit(1);
  if (existing.length > 0) {
    if (Object.keys(patch).length > 0) {
      await tx.update(program).set(forTable({ ...patch, updatedAt: op.createdAt })).where(eq(program.id, id));
    }
    return;
  }
  const filled = { ...patch, athleteId: patch['athleteId'] ?? (await ownerAthleteId(tx)) };
  if (!hasAll(filled, PROGRAM_REQUIRED)) {
    throw new Rejected('invalid_payload', 'A new program needs its seed and its start and end dates.');
  }
  await tx.insert(program).values(
    forTable<typeof program.$inferInsert>({
      id,
      createdAt: op.createdAt,
      updatedAt: op.createdAt,
      ...filled,
    }),
  );
}

async function upsertWeek(tx: Tx, id: string, patch: Patch): Promise<void> {
  const existing = await tx.select({ id: week.id }).from(week).where(eq(week.id, id)).limit(1);
  if (existing.length > 0) {
    if (Object.keys(patch).length > 0) await tx.update(week).set(forTable(patch)).where(eq(week.id, id));
    return;
  }
  const programId = await programIdFor(tx, patch);
  await tx.insert(week).values(forTable<typeof week.$inferInsert>({ id, ...patch, programId }));
}

async function upsertSession(tx: Tx, id: string, patch: Patch, op: SyncOp): Promise<void> {
  const existing = await tx.select({ id: session.id }).from(session).where(eq(session.id, id)).limit(1);
  if (existing.length > 0) {
    await tx
      .update(session)
      .set(forTable({ ...patch, updatedAt: op.createdAt }))
      .where(eq(session.id, id));
    return;
  }
  const programId = await programIdFor(tx, patch);
  await tx.insert(session).values(
    forTable<typeof session.$inferInsert>({
      id,
      createdAt: op.createdAt,
      updatedAt: op.createdAt,
      ...patch,
      programId,
    }),
  );
}

async function applySessionEvent(
  tx: Tx,
  sessionId: string,
  kind: 'complete' | 'uncomplete',
  op: SyncOp,
): Promise<void> {
  // The op id is the event id, so a replay that slipped past the sync_op check
  // still cannot write the same finish twice.
  await tx
    .insert(sessionEvent)
    .values({ id: op.id, sessionId, kind, at: op.createdAt, createdAt: op.createdAt })
    .onConflictDoNothing();
}

async function upsertSetLog(tx: Tx, id: string, op: SyncOp): Promise<void> {
  const patch = parseOr(setLogPatch, op.payload);
  const existing = await tx.select({ id: setLog.id }).from(setLog).where(eq(setLog.id, id)).limit(1);
  if (existing.length > 0) {
    await tx.update(setLog).set(forTable(patch)).where(eq(setLog.id, id));
    return;
  }
  if (!hasAll(patch, SET_LOG_REQUIRED)) {
    throw new Rejected('invalid_payload', 'A new set log needs its session, its set number, and its key.');
  }
  // No `onConflictDoNothing` here. It used to swallow both unique constraints
  // alike, so a second log for the same set under a different row id was
  // discarded while the push answered "accepted" and the phone marked its
  // queue row synced. A clash is reported as the conflict it is.
  try {
    await tx
      .insert(setLog)
      .values(forTable<typeof setLog.$inferInsert>({ id, createdAt: op.createdAt, ...patch }));
  } catch (caught) {
    if (isUniqueViolation(caught)) {
      throw new Rejected('conflict', 'That set is already logged on the server.');
    }
    throw caught;
  }
}

async function applyJumpTest(tx: Tx, id: string, op: SyncOp): Promise<void> {
  const patch = parseOr(jumpTestPatch, op.payload);
  if (!hasAll(patch, JUMP_TEST_REQUIRED)) {
    throw new Rejected('invalid_payload', 'A jump test needs a local date and an instrument.');
  }
  const attempts = Array.isArray(patch['attempts']) ? patch['attempts'] : [];
  delete patch['attempts'];

  const values = {
    ...patch,
    id,
    athleteId: typeof patch['athleteId'] === 'string' ? patch['athleteId'] : await ownerAthleteId(tx),
    performedAt: typeof patch['performedAt'] === 'string' ? patch['performedAt'] : op.createdAt,
    createdAt: op.createdAt,
    updatedAt: op.createdAt,
  };
  await tx
    .insert(jumpTestSession)
    .values(forTable<typeof jumpTestSession.$inferInsert>(values))
    .onConflictDoUpdate({ target: jumpTestSession.id, set: forTable({ ...patch, updatedAt: op.createdAt }) });

  for (const attempt of attempts) {
    if (typeof attempt !== 'object' || attempt === null) continue;
    const rep = attempt as Record<string, unknown>;
    const attemptIndex = rep['attemptIndex'];
    if (typeof attemptIndex !== 'number') continue;
    await tx
      .insert(jumpRep)
      .values(
        forTable<typeof jumpRep.$inferInsert>({
          ...rep,
          id: typeof rep['id'] === 'string' ? rep['id'] : `${id}:${attemptIndex}`,
          jumpTestSessionId: id,
          createdAt: op.createdAt,
        }),
      )
      // Named, so only a replay of the same attempt is a no-op.
      .onConflictDoNothing({ target: jumpRep.id });
  }
}

async function upsertImportBatch(tx: Tx, id: string, op: SyncOp): Promise<void> {
  const patch = parseOr(importBatchPatch, op.payload);
  const existing = await tx
    .select({ id: importBatch.id })
    .from(importBatch)
    .where(eq(importBatch.id, id))
    .limit(1);
  if (existing.length > 0) {
    if (Object.keys(patch).length > 0) {
      await tx.update(importBatch).set(forTable(patch)).where(eq(importBatch.id, id));
    }
    return;
  }
  if (!hasAll(patch, IMPORT_BATCH_REQUIRED)) return;
  // The file hash is the idempotency key: the same export imported twice on
  // two surfaces is one batch, not two.
  await tx
    .insert(importBatch)
    .values(forTable<typeof importBatch.$inferInsert>({ id, createdAt: op.createdAt, ...patch }))
    // The file hash is the only conflict this is allowed to swallow.
    .onConflictDoNothing({ target: importBatch.fileHash });
}

async function applyWhoopLink(tx: Tx, sessionId: string, op: SyncOp, now: Date): Promise<void> {
  const parsed = whoopLinkPayload.safeParse(op.payload);
  if (!parsed.success) throw new Rejected('invalid_payload', 'A link needs the Whoop workout id.');
  const values = {
    sessionId,
    whoopWorkoutId: parsed.data.whoopWorkoutId,
    matchSource: parsed.data.matchSource,
    overlapS: parsed.data.overlapS,
    linkedAt: parsed.data.linkedAt ?? op.createdAt,
    updatedAt: now,
  };
  await tx
    .insert(sessionWorkoutLink)
    .values(values)
    .onConflictDoUpdate({ target: sessionWorkoutLink.sessionId, set: values });
}

/* ------------------------------------------------------------- dispatch */

export async function project(tx: Tx, op: SyncOp, now: Date): Promise<void> {
  const entityId = requireEntity(op);

  switch (op.kind) {
    case 'athlete.upsert':
      return upsertAthlete(tx, entityId, parseOr(athletePatch, op.payload), op, now);

    case 'athlete.clearance': {
      // The payload is either an athlete patch carrying `clearance` or the
      // clearance document itself; both mean the same thing here.
      const body = record(op.payload);
      const clearance = 'clearance' in body ? body['clearance'] : body;
      return upsertAthlete(tx, entityId, { clearance }, op, now);
    }

    case 'pain.report':
      return applyPainReport(tx, entityId, op);

    case 'pain.clear': {
      const cleared = await tx
        .update(painStatus)
        .set({ clearedAt: op.createdAt })
        .where(and(eq(painStatus.id, entityId), isNull(painStatus.clearedAt)))
        .returning({ id: painStatus.id });
      if (cleared.length === 0) {
        const known = await tx
          .select({ id: painStatus.id })
          .from(painStatus)
          .where(eq(painStatus.id, entityId))
          .limit(1);
        // Already cleared is the same outcome; a site we never heard of is not.
        if (known.length === 0) throw new Rejected('missing_entity', 'No pain report with that id.');
      }
      return;
    }

    case 'workingMax.set':
      return applyWorkingMax(tx, entityId, op, now);

    case 'program.create':
      return upsertProgram(tx, entityId, op);

    case 'week.upsert':
      return upsertWeek(tx, entityId, parseOr(weekPatch, op.payload));

    case 'week.generated': {
      const patch = parseOr(weekPatch, op.payload);
      return upsertWeek(tx, entityId, { generatedAt: op.createdAt, ...patch });
    }

    case 'session.patch':
      return upsertSession(tx, entityId, parseOr(sessionPatch, op.payload), op);

    case 'session.move': {
      const body = record(op.payload);
      const toDate = body['toDate'] ?? body['scheduledDate'];
      if (typeof toDate !== 'string') {
        throw new Rejected('invalid_payload', 'A move needs the day to move to.');
      }
      return upsertSession(tx, entityId, { scheduledDate: toDate }, op);
    }

    case 'session.finish':
      return applySessionEvent(tx, entityId, 'complete', op);

    case 'session.unfinish':
      return applySessionEvent(tx, entityId, 'uncomplete', op);

    case 'setLog.upsert':
      return upsertSetLog(tx, entityId, op);

    case 'setLog.edit': {
      const patch = parseOr(setLogPatch, op.payload);
      const edited = await tx
        .update(setLog)
        .set(forTable({ ...patch, editedAt: op.createdAt }))
        .where(eq(setLog.id, entityId))
        .returning({ id: setLog.id });
      if (edited.length === 0) throw new Rejected('missing_entity', 'No set log with that id.');
      return;
    }

    case 'setLog.delete': {
      // Undo deletes the row rather than flagging it, exactly as the phone
      // does, so the two copies count the same logged sets.
      const parsed = undoSetPayload.safeParse(op.payload);
      if (!parsed.success) throw new Rejected('invalid_payload', 'An undo needs the exercise and the set.');
      await tx
        .delete(setLog)
        .where(
          and(
            eq(setLog.sessionExerciseId, parsed.data.sessionExerciseId),
            eq(setLog.setNumber, parsed.data.setNumber),
          ),
        );
      return;
    }

    case 'jumpTest.create':
    // A single-leg pair is the same row shape in its own mode, so it projects
    // the same way; the kind exists so the two never share an invalidation on
    // the phone (`house.sc.asymmetry_tracking`).
    case 'jumpTest.single_leg':
      return applyJumpTest(tx, entityId, op);

    case 'readiness_test.create':
      return applyReadinessTest(tx, entityId, op);

    case 'readiness_outcome.set':
      return applyReadinessOutcome(tx, entityId, op);

    case 'jumpTest.delete': {
      const removed = await tx
        .update(jumpTestSession)
        .set({ deletedAt: op.createdAt, updatedAt: op.createdAt })
        .where(eq(jumpTestSession.id, entityId))
        .returning({ id: jumpTestSession.id });
      if (removed.length === 0) throw new Rejected('missing_entity', 'No jump test with that id.');
      return;
    }

    case 'import.commit':
      return upsertImportBatch(tx, entityId, op);

    case 'whoop.link':
      return applyWhoopLink(tx, entityId, op, now);

    case 'whoop.unlink':
      await tx.delete(sessionWorkoutLink).where(eq(sessionWorkoutLink.sessionId, entityId));
      return;
  }
}
