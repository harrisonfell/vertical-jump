/**
 * The single-use ticket that lets the phone open the Whoop start URL.
 *
 * `openAuthSessionAsync` hands a URL to the operating system's browser, which
 * cannot be given an Authorization header, so `/api/whoop/start` cannot be
 * reached with the device secret. Putting the secret in the query string would
 * write it into browser history and into every log the URL touches. So the
 * phone mints one of these with its Bearer and spends it in `?t=`.
 *
 * Signed, so a forged ticket is not a database read; stored, so a real one
 * works exactly once; and sixty seconds long, because the only thing that
 * happens between minting and spending is one navigation.
 */

import { and, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { WHOOP_START_TOKEN_SECONDS } from '../api-contract';
import { whoopStartTicket } from '../../db/tables/whoop';
import { randomSecret, sign, unsign } from '../crypto';

const ticketPayload = z.object({
  /** The device that asked. The start route becomes that principal. */
  d: z.string().min(1),
  n: z.string().min(8),
  /** Seconds since the epoch. */
  exp: z.number().int().positive(),
});

export interface MintedStartTicket {
  readonly token: string;
  readonly expiresAt: Date;
}

/** A ticket for one device, recorded so it can be spent exactly once. */
export async function mintStartTicket(
  db: Database,
  deviceId: string,
  secret: string,
  now: Date = new Date(),
): Promise<MintedStartTicket> {
  const expiresAt = new Date(now.getTime() + WHOOP_START_TOKEN_SECONDS * 1000);
  const token = sign(
    JSON.stringify({ d: deviceId, n: randomSecret(12), exp: Math.floor(expiresAt.getTime() / 1000) }),
    secret,
  );

  // Tickets are short lived and never read again, so the expired ones are
  // swept on the way past rather than left for a cron that runs once a day.
  await db.delete(whoopStartTicket).where(lt(whoopStartTicket.expiresAt, now));
  await db
    .insert(whoopStartTicket)
    .values({ token, deviceId, createdAt: now, expiresAt })
    .onConflictDoNothing();

  return { token, expiresAt };
}

/**
 * The device a ticket names, or null. Spending is an UPDATE guarded on
 * `used_at IS NULL`, so two tabs racing the same ticket produce one start.
 */
export async function spendStartTicket(
  db: Database,
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<string | null> {
  const raw = unsign(token, secret);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = ticketPayload.safeParse(parsed);
  if (!result.success || result.data.exp * 1000 <= now.getTime()) return null;

  const spent = await db
    .update(whoopStartTicket)
    .set({ usedAt: now })
    .where(and(eq(whoopStartTicket.token, token), isNull(whoopStartTicket.usedAt)))
    .returning({ deviceId: whoopStartTicket.deviceId, expiresAt: whoopStartTicket.expiresAt });

  const row = spent[0];
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) return null;
  return row.deviceId;
}
