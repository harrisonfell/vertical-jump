/**
 * Getting in: the phone's pairing handshake and the web build's single-owner
 * passphrase. Both end in a credential the rest of the contract assumes.
 */

import { z } from 'zod';
import { isoTimestamp } from './primitives';


/**
 * The web review starts a pairing and shows a six digit code; the phone claims
 * it. The secret comes back once, lives in expo-secure-store from then on, and
 * travels as `Authorization: Bearer <secret>`.
 */
export const pairStartResponse = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: isoTimestamp,
});
export type PairStartResponse = z.infer<typeof pairStartResponse>;

export const pairClaimRequest = z.object({
  code: z.string().regex(/^\d{6}$/),
  deviceName: z.string().min(1).max(64),
});
export type PairClaimRequest = z.infer<typeof pairClaimRequest>;

export const pairClaimResponse = z.object({
  /** Shown once, never returned again. 32 random bytes, base64url. */
  deviceSecret: z.string().min(32),
  deviceId: z.string().min(1),
  pairedAt: isoTimestamp,
});
export type PairClaimResponse = z.infer<typeof pairClaimResponse>;

/** 401 from claim. Five failures earn a 60 s wait counted server-side. */
export const pairClaimError = z.object({
  error: z.enum(['wrong_code', 'expired', 'locked']),
  retryAfterS: z.number().int().nonnegative(),
});
export type PairClaimError = z.infer<typeof pairClaimError>;

export const deviceMeResponse = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string(),
  pairedAt: isoTimestamp,
});
export type DeviceMeResponse = z.infer<typeof deviceMeResponse>;

/* ------------------------------------------------------------------ login */

/** The web build's single-owner passphrase. No accounts, one owner. */
export const loginRequest = z.object({ passphrase: z.string().min(1).max(512) });
export type LoginRequest = z.infer<typeof loginRequest>;

export const loginResponse = z.object({ ok: z.literal(true), expiresAt: isoTimestamp });
export type LoginResponse = z.infer<typeof loginResponse>;

/** 401 from login. The screen keeps the typed value and counts down. */
export const loginError = z.object({
  error: z.enum(['wrong_passphrase', 'locked']),
  retryAfterS: z.number().int().nonnegative(),
});
export type LoginError = z.infer<typeof loginError>;

export const SESSION_COOKIE = 'vert_session';
/** Failures before the wait, and how long it lasts. Mirrors the app's pairing.ts. */
export const LOCKOUT_AFTER = 5;
export const LOCKOUT_SECONDS = 60;
