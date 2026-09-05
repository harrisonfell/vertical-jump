import type { NextRequest } from 'next/server';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { json } from '../../../../lib/routes/respond';
import { revokeWhoop } from '../../../../lib/whoop/sync';

/**
 * POST /api/whoop/revoke
 *
 * DELETE /v2/user/access on Whoop, then 'revoked' here with the tokens wiped.
 * Whoop's terms require a disconnect that revokes, and this is it: afterwards
 * the only way back is the consent screen.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  return json(await revokeWhoop(db));
}
