import type { NextRequest } from 'next/server';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { json } from '../../../../lib/routes/respond';
import { deleteWhoopMirrors, readWhoopStatus } from '../../../../lib/whoop/sync';

/**
 * DELETE /api/whoop/data
 *
 * Every Whoop mirror row, gone, with a tombstone for each so the phone deletes
 * its own copy on the next pull. The connection row stays: deleting the data is
 * not the same request as disconnecting, and the counts come back so the
 * confirm sheet can say what actually went.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const deleted = await deleteWhoopMirrors(db);
  return json({ deleted, status: await readWhoopStatus(db) });
}
