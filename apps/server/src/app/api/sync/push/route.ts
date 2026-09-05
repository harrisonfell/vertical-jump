import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { syncOp, syncOpKind, type SyncOp } from '../../../../lib/api-contract';
import { log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { deviceIdOf, guard, originOf } from '../../../../lib/routes/guard';
import { badRequest, json } from '../../../../lib/routes/respond';
import { applyOps } from '../../../../lib/sync/apply';

/**
 * The phone's outbox, drained.
 *
 * The ops are read one at a time rather than as one strict array, because one
 * op this build does not know must not throw away the 199 beside it. A kind
 * that is not in the union comes back as `unknown_kind` and the rest apply, in
 * the order the phone queued them.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_OPS = 200;

const envelope = z.object({ ops: z.array(z.unknown()).min(1).max(MAX_OPS) });

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('The request body is not JSON.');
  }
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return badRequest(`A push carries 1 to ${MAX_OPS} ops.`);

  const ops: SyncOp[] = [];
  const rejected: { id: string; reason: 'unknown_kind' | 'invalid_payload'; message: string }[] = [];

  for (const raw of parsed.data.ops) {
    const op = syncOp.safeParse(raw);
    if (op.success) {
      ops.push(op.data);
      continue;
    }
    const id =
      typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : '';
    if (id === '') continue;
    const kind = (raw as { kind?: unknown }).kind;
    const known = typeof kind === 'string' && syncOpKind.safeParse(kind).success;
    rejected.push(
      known
        ? { id, reason: 'invalid_payload', message: 'The op is not the shape a push takes.' }
        : { id, reason: 'unknown_kind', message: 'This server does not know that op kind.' },
    );
  }

  const applied = await applyOps(db, ops, {
    deviceId: deviceIdOf(caller.principal),
    origin: originOf(caller.principal),
  });

  log.info('sync.push', {
    ops: parsed.data.ops.length,
    accepted: applied.accepted.length,
    rejected: applied.rejected.length + rejected.length,
  });

  return json({
    accepted: applied.accepted,
    rejected: [...applied.rejected, ...rejected],
    serverTime: applied.serverTime,
  });
}
