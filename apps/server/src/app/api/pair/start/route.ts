import type { NextRequest } from 'next/server';
import { mintPairCode } from '../../../../lib/auth';
import { log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { json } from '../../../../lib/routes/respond';

/**
 * The web review mints a one-time code and shows it; the phone claims it.
 *
 * Only a signed-in browser can start a pairing, because the code is the thing
 * that becomes a device secret: if a stranger could mint one they would only
 * need the athlete to read it out. The code is six digits, lives ten minutes,
 * and is single use.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'session');
  if (!caller.ok) return caller.response;

  const minted = await mintPairCode(db);
  log.info('pair.start', { expiresAt: minted.expiresAt.toISOString() });
  return json({ code: minted.code, expiresAt: minted.expiresAt.toISOString() });
}
