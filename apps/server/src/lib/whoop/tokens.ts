/**
 * The Whoop token pair: exchanged once, encrypted at rest, refreshed lazily.
 *
 * Whoop's refresh tokens rotate and are single use, so two concurrent
 * refreshes lose: every refresh happens inside SELECT ... FOR UPDATE on the
 * one connection row, and a call that finds the access token within five
 * minutes of expiry refreshes it there and then. That is why nothing depends
 * on cron frequency, which matters because Vercel Hobby runs cron once a day
 * with an hour of jitter.
 *
 * Two rules the rest of the server relies on: a failed refresh never
 * overwrites the stored pair, and a 400 from the token endpoint means the
 * grant is gone, so the connection goes to 'revoked' and the app says
 * "Reconnect" instead of retrying forever.
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client';
import type { WhoopStatus } from '../api-contract';
import { WHOOP_CONNECTION_ID, whoopConnection } from '../../db/tables/whoop';
import { decryptToken, encryptToken } from '../crypto';
import { env } from '../env';
import { errorMessage, log } from '../logger';
import { WHOOP_PATHS, WHOOP_TOKEN_URL, WhoopApiError, whoopFetchParsed } from './api';

/** Refresh once the access token is this close to dying. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export interface WhoopTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly scopes: string | null;
}

function toTokens(body: z.infer<typeof tokenResponse>, now: Date): WhoopTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(now.getTime() + body.expires_in * 1000),
    scopes: body.scope ?? null,
  };
}

/* ------------------------------------------------------------- exchange */

/** The authorization code, once, at the callback. */
export async function exchangeCode(code: string, now: Date = new Date()): Promise<WhoopTokens> {
  const config = env();
  const body = await whoopFetchParsed(
    {
      path: WHOOP_TOKEN_URL,
      form: {
        grant_type: 'authorization_code',
        code,
        client_id: config.WHOOP_CLIENT_ID,
        client_secret: config.WHOOP_CLIENT_SECRET,
        redirect_uri: config.WHOOP_REDIRECT_URI,
      },
      now,
    },
    tokenResponse,
  );
  return toTokens(body, now);
}

/** One rotation. The old refresh token is dead the moment this returns. */
export async function refreshTokens(
  refreshToken: string,
  now: Date = new Date(),
): Promise<WhoopTokens> {
  const config = env();
  const body = await whoopFetchParsed(
    {
      path: WHOOP_TOKEN_URL,
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.WHOOP_CLIENT_ID,
        client_secret: config.WHOOP_CLIENT_SECRET,
        scope: 'offline',
      },
      now,
    },
    tokenResponse,
  );
  return toTokens(body, now);
}

/** DELETE /v2/user/access: Whoop forgets us too. Disconnect only forgets here. */
export async function revokeAccess(accessToken: string): Promise<void> {
  const { whoopFetch } = await import('./api');
  await whoopFetch({ path: WHOOP_PATHS.access, method: 'DELETE', token: accessToken });
}

/* ---------------------------------------------------------------- store */

export function encryptPair(tokens: WhoopTokens): {
  accessTokenCipher: string;
  refreshTokenCipher: string;
} {
  const key = env().TOKEN_ENCRYPTION_KEY;
  return {
    accessTokenCipher: encryptToken(tokens.accessToken, key),
    refreshTokenCipher: encryptToken(tokens.refreshToken, key),
  };
}

export function decryptStored(cipher: string): string {
  const config = env();
  return decryptToken(
    cipher,
    config.TOKEN_ENCRYPTION_KEY,
    config.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? null,
  );
}

/**
 * Writes a freshly exchanged pair and marks the connection connected. Used by
 * the callback; the refresh path writes through `ensureAccessToken` instead.
 */
export async function storeExchangedTokens(
  db: Database,
  tokens: WhoopTokens,
  whoopUserId: string | null,
  now: Date = new Date(),
): Promise<void> {
  const pair = encryptPair(tokens);
  await db
    .insert(whoopConnection)
    .values({
      id: WHOOP_CONNECTION_ID,
      status: 'connecting',
      whoopUserId,
      accessTokenCipher: pair.accessTokenCipher,
      refreshTokenCipher: pair.refreshTokenCipher,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      connectedAt: now,
      revokedAt: null,
      lastError: null,
      nextRetryAt: null,
      rowVersion: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: whoopConnection.id,
      set: {
        status: 'connecting',
        whoopUserId,
        accessTokenCipher: pair.accessTokenCipher,
        refreshTokenCipher: pair.refreshTokenCipher,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        connectedAt: now,
        revokedAt: null,
        lastError: null,
        nextRetryAt: null,
        updatedAt: now,
      },
    });
}

/**
 * Marks the stored access token as spent, so the next `ensureAccessToken`
 * rotates the pair. Used when Whoop rejects a token the row still believes in.
 */
export async function markAccessTokenStale(db: Database, now: Date = new Date()): Promise<void> {
  await db
    .update(whoopConnection)
    .set({ expiresAt: now, updatedAt: now })
    .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));
}

/* -------------------------------------------------------------- refresh */

/**
 * The access token every Whoop call uses.
 *
 * Takes the row lock, refreshes if the token is inside the five minute
 * window, writes the rotated pair under the same lock, and hands back a live
 * token. Throws WhoopApiError('needs_reauth') when there is nothing to
 * refresh or the grant is gone; the caller turns that into status 'revoked'.
 */
/** What a refresh failure has to remember once the transaction is over. */
interface RefreshFailure {
  readonly cause: unknown;
  readonly revoked: boolean;
  readonly nextAt: Date | null;
  readonly status: WhoopStatus;
  readonly revokedAt: Date | null;
  readonly rowVersion: number;
}

type Attempt = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly failure: RefreshFailure };

export async function ensureAccessToken(db: Database, now: Date = new Date()): Promise<string> {
  const attempt = await db.transaction(async (tx): Promise<Attempt> => {
    const rows = await tx
      .select()
      .from(whoopConnection)
      .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID))
      .for('update');

    const row = rows[0];
    if (row === undefined || row.refreshTokenCipher === null) {
      throw new WhoopApiError('needs_reauth', 'Whoop is not connected.', 0, null, 'token');
    }

    const fresh =
      row.accessTokenCipher !== null &&
      row.expiresAt !== null &&
      row.expiresAt.getTime() - now.getTime() > REFRESH_WINDOW_MS;

    if (fresh && row.accessTokenCipher !== null) {
      return { ok: true, token: decryptStored(row.accessTokenCipher) };
    }

    let rotated: WhoopTokens;
    try {
      rotated = await refreshTokens(decryptStored(row.refreshTokenCipher), now);
    } catch (cause) {
      // The failure is reported after this transaction, not inside it: a throw
      // here would roll the write back and the connection would forget that
      // Whoop ever said no.
      return {
        ok: false,
        failure: {
          cause,
          revoked: cause instanceof WhoopApiError && cause.status === 400,
          nextAt: cause instanceof WhoopApiError && cause.nextAt !== null ? new Date(cause.nextAt) : null,
          status: row.status,
          revokedAt: row.revokedAt,
          rowVersion: row.rowVersion,
        },
      };
    }

    const pair = encryptPair(rotated);
    await tx
      .update(whoopConnection)
      .set({
        accessTokenCipher: pair.accessTokenCipher,
        refreshTokenCipher: pair.refreshTokenCipher,
        expiresAt: rotated.expiresAt,
        scopes: rotated.scopes ?? row.scopes,
        lastError: null,
        nextRetryAt: null,
        rowVersion: row.rowVersion + 1,
        updatedAt: now,
      })
      .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));

    log.info('whoop.refreshed', { expiresAt: rotated.expiresAt.toISOString() });
    return { ok: true, token: rotated.accessToken };
  });

  if (attempt.ok) return attempt.token;

  // Never overwrite a stored pair with a failed response. A 400 means the
  // grant is gone; anything else is Whoop being unwell, so the pair stays.
  const { failure } = attempt;
  await db
    .update(whoopConnection)
    .set({
      status: failure.revoked ? 'revoked' : failure.status,
      revokedAt: failure.revoked ? now : failure.revokedAt,
      lastError: failure.revoked ? 'needs_reauth' : 'api_down',
      nextRetryAt: failure.nextAt,
      rowVersion: failure.rowVersion + 1,
      updatedAt: now,
    })
    .where(eq(whoopConnection.id, WHOOP_CONNECTION_ID));

  log.warn('whoop.refresh_failed', {
    revoked: failure.revoked,
    message: errorMessage(failure.cause),
  });
  if (failure.revoked) {
    throw new WhoopApiError('needs_reauth', 'The Whoop grant was revoked.', 400, null, 'token');
  }
  throw failure.cause;
}
