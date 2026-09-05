/**
 * The two shapes every handler answers with.
 *
 * A success body is whatever the contract names for that path. A failure body
 * is always `{ error, message, retryAfterS }`, which is a superset of the
 * narrower `pairClaimError` and `loginError` the app parses, so one helper
 * serves every path and the app never meets a second error shape. Nothing an
 * API answers is cacheable, so every response carries `no-store`.
 */

import { NextResponse } from 'next/server';

const NO_STORE: Readonly<Record<string, string>> = { 'cache-control': 'no-store' };

export function json<T>(
  body: T,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * A failure. `retryAfterS` above zero also sets the `retry-after` header,
 * because the app's client reads the header on a 429 and the body everywhere
 * else, and the two must never disagree.
 */
export function fail(
  status: number,
  error: string,
  message: string,
  retryAfterS: number | null = null,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  const extra: Record<string, string> = { ...headers };
  if (retryAfterS !== null && retryAfterS > 0) extra['retry-after'] = String(retryAfterS);
  return json({ error, message, retryAfterS }, status, extra);
}

/** A body that is not the shape the path asked for. Names the field. */
export function badRequest(message: string): NextResponse {
  return fail(400, 'invalid_request', message);
}

/** Text, for the CSV export. Content-Disposition names the file. */
export function textFile(
  body: string,
  mime: string,
  fileName: string,
  status = 200,
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      ...NO_STORE,
      'content-type': `${mime}; charset=utf-8`,
      'content-disposition': `attachment; filename="${fileName}"`,
    },
  });
}
