import type { NextRequest } from 'next/server';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { json } from '../../../../lib/routes/respond';
import { readWhoopStatus } from '../../../../lib/whoop/sync';

/**
 * GET /api/whoop/status
 *
 * The one body the Settings screen renders, and the one Today polls while a
 * backfill runs. It never throws: a connection that has never been made reads
 * as 'disconnected' with zeros, which is a state and not an error.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  return json(await readWhoopStatus(db));
}
