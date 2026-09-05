import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { WEB_CONNECTED_REDIRECT, whoopCallbackQuery } from '../../../../lib/api-contract';
import { whoopOauthState } from '../../../../db/tables/whoop';
import { env } from '../../../../lib/env';
import { errorMessage, log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { WHOOP_PATHS, whoopFetchParsed } from '../../../../lib/whoop/api';
import { beginBackfill, ensureConnection, patchConnection } from '../../../../lib/whoop/connection';
import { readState, withParams } from '../../../../lib/whoop/oauth';
import { userProfileV2 } from '../../../../lib/whoop/records';
import { exchangeCode, storeExchangedTokens } from '../../../../lib/whoop/tokens';

/**
 * GET /api/whoop/callback
 *
 * Whoop sends the authorization code here, to an https URL, because a custom
 * scheme cannot be a registered redirect URI and because the phone must never
 * hold a Whoop token. The code is exchanged, the pair is encrypted and stored,
 * and the browser is bounced back to whoever started the connection.
 *
 * Backing out of Whoop's consent screen is not an error: the state is spent,
 * nothing is written, and the app says "Connection cancelled, nothing
 * changed."
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A 302 written by hand, because the phone's target is a custom scheme. */
function bounce(target: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { location: target, 'cache-control': 'no-store' },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const now = new Date();
  const url = new URL(request.url);
  const parsed = whoopCallbackQuery.safeParse({
    code: url.searchParams.get('code') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
    error: url.searchParams.get('error') ?? undefined,
  });

  if (!parsed.success) {
    return bounce(withParams(WEB_CONNECTED_REDIRECT, { cancelled: '1', reason: 'bad_state' }));
  }

  const config = env();
  const signed = readState(parsed.data.state, config.SESSION_SECRET, now);
  // Single use: the update matches nothing when the state is already spent.
  const spent = await db
    .update(whoopOauthState)
    .set({ usedAt: now })
    .where(and(eq(whoopOauthState.state, parsed.data.state), isNull(whoopOauthState.usedAt)))
    .returning({ redirect: whoopOauthState.redirect, expiresAt: whoopOauthState.expiresAt });

  const row = spent[0];
  if (signed === null || row === undefined || row.expiresAt.getTime() <= now.getTime()) {
    log.warn('whoop.callback_state', { signed: signed !== null, found: row !== undefined });
    return bounce(withParams(WEB_CONNECTED_REDIRECT, { cancelled: '1', reason: 'bad_state' }));
  }

  // Cancelled at Whoop, or an error from Whoop: nothing here changes.
  if (parsed.data.error !== undefined || parsed.data.code === undefined) {
    const connection = await ensureConnection(db, now);
    if (connection.status === 'connecting' && connection.refreshTokenCipher === null) {
      await patchConnection(db, { status: 'disconnected' }, now);
    }
    const reason = parsed.data.error ?? 'no_code';
    log.info('whoop.callback_cancelled', { reason });
    return bounce(withParams(row.redirect, { cancelled: '1', reason }));
  }

  try {
    const tokens = await exchangeCode(parsed.data.code, now);
    let whoopUserId: string | null = null;
    try {
      const profile = await whoopFetchParsed(
        { path: WHOOP_PATHS.profile, token: tokens.accessToken, now },
        userProfileV2,
      );
      whoopUserId = String(profile.user_id);
    } catch (cause) {
      // A profile read is a nicety; the connection is already real without it.
      log.warn('whoop.profile_failed', { message: errorMessage(cause) });
    }
    await storeExchangedTokens(db, tokens, whoopUserId, now);
    await beginBackfill(db, whoopUserId, now);
    log.info('whoop.connected', { whoopUserId });
    return bounce(withParams(row.redirect, { connected: '1' }));
  } catch (cause) {
    log.warn('whoop.exchange_failed', { message: errorMessage(cause) });
    const connection = await ensureConnection(db, now);
    if (connection.refreshTokenCipher === null) {
      await patchConnection(db, { status: 'disconnected', lastError: 'api_down' }, now);
    }
    return bounce(withParams(row.redirect, { cancelled: '1', reason: 'exchange_failed' }));
  }
}
