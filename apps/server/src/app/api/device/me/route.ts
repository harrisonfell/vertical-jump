import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { deviceSecret } from '../../../../db/tables/account';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { fail, json } from '../../../../lib/routes/respond';

/**
 * What this device is, to the server. The phone calls it once after pairing to
 * confirm the secret it stored actually works, and the last-seen stamp is the
 * only place a device's liveness is written.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'bearer');
  if (!caller.ok) return caller.response;
  const principal = caller.principal;
  if (principal.kind !== 'device') {
    return fail(403, 'wrong_credential', 'This needs the paired app.');
  }

  const rows = await db
    .select()
    .from(deviceSecret)
    .where(eq(deviceSecret.id, principal.deviceId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return fail(401, 'unauthorized', 'This device is no longer paired.');

  await db
    .update(deviceSecret)
    .set({ lastSeenAt: new Date() })
    .where(eq(deviceSecret.id, row.id));

  return json({
    deviceId: row.id,
    deviceName: row.name,
    pairedAt: row.pairedAt.toISOString(),
  });
}
