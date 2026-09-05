/**
 * Whoop's webhooks: verify, dedupe, then upsert or delete.
 *
 * The signature is base64(HMAC-SHA256(timestamp + raw body, client secret)),
 * so the handler must read the body as text and pass those bytes through
 * unchanged. Whoop wants a 2xx inside a second and retries five times over an
 * hour, so the trace id is the dedupe key and the work after the insert is
 * deliberately small: one record, one write.
 *
 * v2 recovery events carry the sleep UUID, so a recovery resolves sleep to
 * cycle to recovery before it can be written. Creates arrive as "updated",
 * which is why every write is an upsert.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import type { WhoopWebhookBody } from '../api-contract';
import { verifyWhoopSignature } from '../crypto';
import { errorMessage, log } from '../logger';
import { webhookEvent } from '../../db/tables/whoop';
import { cycleRecoveryPath, sleepPath, whoopFetchParsed, workoutPath } from './api';
import { relinkAroundWorkout } from './match';
import {
  deleteMirror,
  findSleepCycleId,
  upsertRecoveries,
  upsertSleeps,
  upsertWorkouts,
} from './mirrors';
import { recoveryV2, sleepV2, toRecoveryRow, toSleepRow, toWorkoutRow, workoutV2 } from './records';
import { ensureAccessToken } from './tokens';

/** Deliveries older than this are refused, so a captured body cannot replay. */
export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export interface WebhookVerification {
  readonly ok: boolean;
  readonly reason: 'ok' | 'missing_headers' | 'bad_signature' | 'stale';
}

/** Signature and freshness, on the raw bytes. No database, no side effects. */
export function verifyWebhook(
  rawBody: string,
  headers: Headers,
  clientSecret: string,
  now: Date = new Date(),
): WebhookVerification {
  const signature = headers.get('x-whoop-signature');
  const timestamp = headers.get('x-whoop-signature-timestamp');
  if (signature === null || timestamp === null) return { ok: false, reason: 'missing_headers' };

  // Written as a refusal rather than an acceptance: the old reading was "if
  // this parses as a finite number and is too old, refuse", so a timestamp of
  // "1e999" or "not-a-number" skipped the freshness check entirely and left the
  // signature as the only control on the one unauthenticated public route.
  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(now.getTime() - sentAt) > WEBHOOK_MAX_AGE_MS) {
    return { ok: false, reason: 'stale' };
  }
  if (!verifyWhoopSignature(timestamp, rawBody, clientSecret, signature)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, reason: 'ok' };
}

/* ---------------------------------------------------------------- apply */

async function applyUpdated(
  db: Database,
  entity: 'recovery' | 'workout' | 'sleep',
  id: string,
  now: Date,
): Promise<void> {
  const token = await ensureAccessToken(db, now);
  const at = now.toISOString();

  if (entity === 'workout') {
    const record = await whoopFetchParsed({ path: workoutPath(id), token, now }, workoutV2);
    await upsertWorkouts(db, [toWorkoutRow(record, at)]);
    await relinkAroundWorkout(db, record.id, now);
    return;
  }

  if (entity === 'sleep') {
    const record = await whoopFetchParsed({ path: sleepPath(id), token, now }, sleepV2);
    await upsertSleeps(db, [toSleepRow(record, at)]);
    return;
  }

  // A v2 recovery event names the sleep, not the cycle, so sleep resolves to
  // cycle and the cycle resolves to the recovery.
  let cycleId = await findSleepCycleId(db, id);
  if (cycleId === null) {
    const sleep = await whoopFetchParsed({ path: sleepPath(id), token, now }, sleepV2);
    await upsertSleeps(db, [toSleepRow(sleep, at)]);
    cycleId = sleep.cycle_id ?? null;
  }
  if (cycleId === null) {
    log.warn('whoop.webhook_unresolved', { entity, id });
    return;
  }
  const recovery = await whoopFetchParsed(
    { path: cycleRecoveryPath(cycleId), token, now },
    recoveryV2,
  );
  await upsertRecoveries(db, [toRecoveryRow(recovery, at)]);
}

async function applyDeleted(
  db: Database,
  entity: 'recovery' | 'workout' | 'sleep',
  id: string,
  now: Date,
): Promise<void> {
  // A deleted workout also loses its session link, inside deleteMirror.
  await deleteMirror(db, entity, id, now);
}

/**
 * Inserts the trace id, which is what makes a retry a no-op, and applies the
 * event. A delivery that failed before it was applied is allowed through
 * again: `processed_at` and not the row's existence is what "seen" means.
 */
export async function handleWebhookEvent(
  db: Database,
  body: WhoopWebhookBody,
  now: Date = new Date(),
): Promise<{ applied: boolean; duplicate: boolean }> {
  const id = String(body.id);
  const [rawEntity, rawAction] = body.type.split('.');
  const entity = rawEntity as 'recovery' | 'workout' | 'sleep';
  const action = rawAction as 'updated' | 'deleted';

  const inserted = await db
    .insert(webhookEvent)
    .values({
      traceId: body.trace_id,
      type: body.type,
      entityId: id,
      whoopUserId: String(body.user_id),
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ traceId: webhookEvent.traceId });

  if (inserted.length === 0) {
    const existing = await db
      .select({ processedAt: webhookEvent.processedAt })
      .from(webhookEvent)
      .where(eq(webhookEvent.traceId, body.trace_id));
    if (existing[0]?.processedAt != null) {
      log.debug('whoop.webhook_duplicate', { type: body.type });
      return { applied: false, duplicate: true };
    }
  }

  try {
    if (action === 'deleted') await applyDeleted(db, entity, id, now);
    else await applyUpdated(db, entity, id, now);
  } catch (cause) {
    await db
      .update(webhookEvent)
      .set({ error: errorMessage(cause) })
      .where(eq(webhookEvent.traceId, body.trace_id));
    throw cause;
  }

  await db
    .update(webhookEvent)
    .set({ processedAt: now, error: null })
    .where(eq(webhookEvent.traceId, body.trace_id));

  log.info('whoop.webhook', { type: body.type });
  return { applied: true, duplicate: false };
}
