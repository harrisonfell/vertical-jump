import { NextResponse, type NextRequest } from 'next/server';
import { whoopWebhookBody } from '../../../../lib/api-contract';
import { whoopConfigured, whoopEnv } from '../../../../lib/env';
import { errorMessage, log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { fail } from '../../../../lib/routes/respond';
import { handleWebhookEvent, verifyWebhook } from '../../../../lib/whoop/webhook';

/**
 * POST /api/whoop/webhook
 *
 * Whoop wants a 2xx inside a second and retries five times over an hour, so
 * this handler does the smallest honest amount of work: verify the signature
 * over the raw bytes, dedupe on the trace id, fetch the one record the event
 * names, upsert it, answer 204.
 *
 * The body is read as text and passed through unchanged, because the signature
 * is base64(HMAC-SHA256(timestamp + raw body, client secret)) and a
 * re-serialized object is a different string.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest): Promise<Response> {
  const now = new Date();
  const rawBody = await request.text();
  if (!whoopConfigured()) {
    return fail(503, 'whoop_not_configured', 'Whoop is not set up on this server yet.');
  }
  const config = whoopEnv();

  const check = verifyWebhook(rawBody, request.headers, config.WHOOP_CLIENT_SECRET, now);
  if (!check.ok) {
    log.warn('whoop.webhook_rejected', { reason: check.reason });
    return fail(401, check.reason, 'That delivery could not be verified.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return fail(400, 'invalid_request', 'That delivery was not JSON.');
  }

  const body = whoopWebhookBody.safeParse(parsed);
  if (!body.success) {
    // An event type this server does not handle is not worth a retry: Whoop
    // would send it four more times for nothing.
    log.warn('whoop.webhook_ignored', { issues: body.error.issues.length });
    return noContent();
  }

  try {
    await handleWebhookEvent(database(), body.data, now);
  } catch (cause) {
    // A non-2xx is what asks Whoop to try again, which is right when the
    // record could not be fetched or written.
    log.error('whoop.webhook_failed', { message: errorMessage(cause) });
    return fail(500, 'server_error', 'That delivery could not be applied. Send it again.');
  }
  return noContent();
}
