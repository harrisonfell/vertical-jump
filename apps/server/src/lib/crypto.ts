/**
 * Every cryptographic primitive the server uses, from node:crypto only.
 *
 * Three jobs: encrypt the Whoop tokens at rest (AES-256-GCM, required by
 * Whoop's terms), hash the passphrase and the device secrets (scrypt, so a
 * dumped table hands no one a Bearer token), and sign the session cookie and
 * the OAuth state (HMAC-SHA256, so neither can be forged or replayed).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/* ------------------------------------------------------- tokens at rest */

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The first byte of every stored ciphertext.
 *
 * Without it a rotated TOKEN_ENCRYPTION_KEY would make every stored token
 * permanently undecryptable rather than degrading: nothing in the packed bytes
 * would say which key made them. With it, a decrypt can try the current key,
 * fall back to the previous one, and the next write comes back under the new
 * key on its own.
 */
const VERSION = 1;

export function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
  }
  return key;
}

/** base64 of version || iv || tag || ciphertext. One string, one column. */
export function encryptToken(plain: string, base64Key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(base64Key), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), body]).toString('base64');
}

function openWith(raw: Buffer, base64Key: string): string {
  const iv = raw.subarray(1, 1 + IV_BYTES);
  const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = raw.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(base64Key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** The plaintext back. A previous key is tried second, so rotation degrades. */
export function decryptToken(
  packed: string,
  base64Key: string,
  previousBase64Key: string | null = null,
): string {
  const raw = Buffer.from(packed, 'base64');
  if (raw.length <= 1 + IV_BYTES + TAG_BYTES) throw new Error('Stored token is truncated.');
  if (raw[0] !== VERSION) throw new Error('Stored token was written by a version this build cannot read.');
  try {
    return openWith(raw, base64Key);
  } catch (cause) {
    if (previousBase64Key === null) throw cause;
    return openWith(raw, previousBase64Key);
  }
}

/* ------------------------------------------------------------- hashing */

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

/** "scrypt$N$r$p$salt$hash", all base64. The format APP_PASSPHRASE_HASH uses. */
export function hashSecret(value: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(value, salt, KEY_LENGTH, { ...SCRYPT });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

/** Constant time, and false rather than a throw on a malformed stored hash. */
export function verifySecret(value: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(rawSalt ?? '', 'base64');
  const expected = Buffer.from(rawHash ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = scryptSync(value, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return timingSafeEqual(derived, expected);
}

/* ------------------------------------------------------------- signing */

/** "<payload>.<signature>", payload base64url of the JSON, signature HMAC. */
export function sign(payload: string, secret: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** The payload back, or null when the signature does not match. */
export function unsign(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const given = Buffer.from(mac, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return Buffer.from(body, 'base64url').toString('utf8');
}

/**
 * Whoop's own webhook signature: base64(HMAC-SHA256(timestamp + raw body,
 * client secret)). The raw body, byte for byte, never a re-serialized object.
 */
export function whoopSignature(timestamp: string, rawBody: string, clientSecret: string): string {
  return createHmac('sha256', clientSecret).update(`${timestamp}${rawBody}`).digest('base64');
}

export function verifyWhoopSignature(
  timestamp: string,
  rawBody: string,
  clientSecret: string,
  given: string,
): boolean {
  const expected = Buffer.from(whoopSignature(timestamp, rawBody, clientSecret), 'utf8');
  const supplied = Buffer.from(given, 'utf8');
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}

/* -------------------------------------------------------------- random */

/** 32 random bytes, base64url. The device secret and the OAuth state. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** A six digit pairing code, uniform over 000000 to 999999. */
export function randomPairCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
