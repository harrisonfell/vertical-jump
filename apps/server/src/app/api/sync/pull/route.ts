import type { NextRequest } from 'next/server';
import { syncPullQuery } from '../../../../lib/api-contract';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { badRequest, json } from '../../../../lib/routes/respond';
import { changesSince } from '../../../../lib/sync/apply';

/**
 * Changes the server has that the caller may not: edits made on the web, links
 * made by a webhook, and the caller's own ops, which carry their origin so the
 * phone can skip its own echo rather than apply what it already did.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const url = new URL(request.url);
  const parsed = syncPullQuery.safeParse({
    since: url.searchParams.get('since') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) return badRequest('The pull query is not a shape this path takes.');

  const since = parsed.data.since === undefined ? null : new Date(parsed.data.since);
  const page = await changesSince(
    db,
    since !== null && Number.isNaN(since.getTime()) ? null : since,
    parsed.data.limit,
    parsed.data.cursor ?? null,
  );

  return json({ changes: page.changes, next: page.next, serverTime: new Date().toISOString() });
}
