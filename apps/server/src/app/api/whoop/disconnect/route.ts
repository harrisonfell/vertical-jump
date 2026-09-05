import type { NextRequest } from 'next/server';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { json } from '../../../../lib/routes/respond';
import { disconnectWhoop } from '../../../../lib/whoop/sync';

/**
 * POST /api/whoop/disconnect
 *
 * Forgets the connection here: the token pair is wiped and the state goes back
 * to 'disconnected'. Whoop keeps the grant, which is why /api/whoop/revoke
 * exists beside this, and the mirrors stay until /api/whoop/data removes them.
 * The confirm sheet says exactly that before this is called.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  return json(await disconnectWhoop(db));
}
