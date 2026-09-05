import type { NextRequest } from 'next/server';
import { mirrorsQuery, parseMirrorKinds } from '../../../lib/api-contract';
import { database } from '../../../lib/routes/db';
import { guard } from '../../../lib/routes/guard';
import { badRequest, json } from '../../../lib/routes/respond';
import { mirrorsSince } from '../../../lib/sync/mirrors';

/**
 * The Whoop mirror feed, paged.
 *
 * The phone pulls this on every sync and applies each row to its own copy, so
 * the same page asked for twice has to be the same page: the cursor is the
 * last row's `feed_seq`, and it is named on every page that has rows so the
 * phone can persist where it got to. `next` is null only for an empty page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const url = new URL(request.url);
  const parsed = mirrorsQuery.safeParse({
    since: url.searchParams.get('since') ?? undefined,
    kinds: url.searchParams.get('kinds') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) return badRequest('The mirrors query is not a shape this path takes.');

  const since = parsed.data.since === undefined ? null : new Date(parsed.data.since);
  const page = await mirrorsSince(db, {
    since: since !== null && Number.isNaN(since.getTime()) ? null : since,
    kinds: parseMirrorKinds(parsed.data.kinds),
    limit: parsed.data.limit,
    cursor: parsed.data.cursor ?? null,
  });

  return json({ rows: page.rows, next: page.next, serverTime: new Date().toISOString() });
}
