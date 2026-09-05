/**
 * The file hash that makes a re-import a no-op.
 *
 * This is an idempotency key for a local table, never a signature, so a fast
 * 64-bit FNV-1a over the file's own text is the right tool: it needs no
 * crypto module, works identically in the web build and in the node test run,
 * and is deterministic without a platform check. Two different exports would
 * have to share a 64-bit digest to collide, which the athlete will not see.
 */

/** FNV-1a 64 offset basis, 0xcbf29ce484222325, in two halves. */
const OFFSET_LOW = 0x84222325;
const OFFSET_HIGH = 0xcbf29ce4;
/** FNV-1a 64 prime, 0x00000100000001b3, in 16-bit limbs. */
const PRIME_B0 = 0x01b3;
const PRIME_B2 = 0x0100;

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** FNV-1a 64, in 16-bit limbs so nothing leaves the exact integer range. */
function digest(length: number, unitAt: (index: number) => number): string {
  let low = OFFSET_LOW;
  let high = OFFSET_HIGH;

  for (let i = 0; i < length; i += 1) {
    low = (low ^ unitAt(i)) >>> 0;

    const a0 = low & 0xffff;
    const a1 = low >>> 16;
    const a2 = high & 0xffff;
    const a3 = high >>> 16;

    const c0 = a0 * PRIME_B0;
    const c1 = a1 * PRIME_B0 + Math.floor(c0 / 0x10000);
    const c2 = a2 * PRIME_B0 + a0 * PRIME_B2 + Math.floor(c1 / 0x10000);
    const c3 = a3 * PRIME_B0 + a1 * PRIME_B2 + Math.floor(c2 / 0x10000);

    low = (((c1 & 0xffff) << 16) | (c0 & 0xffff)) >>> 0;
    high = (((c3 & 0xffff) << 16) | (c2 & 0xffff)) >>> 0;
  }

  return `${hex32(high)}${hex32(low)}`;
}

/** The hash of a text file: its own characters, in order. */
export function fileHash(text: string): string {
  return digest(text.length, (index) => text.charCodeAt(index) & 0xffff);
}

/**
 * The hash of a workbook: its own bytes. A spreadsheet is a zip container, so
 * the same export saved twice is byte-identical and hashes the same, which is
 * what makes a re-import a no-op rather than a second copy of the season.
 */
export function bytesHash(bytes: Uint8Array): string {
  return digest(bytes.length, (index) => bytes[index] ?? 0);
}

/** A short, readable stamp for the batch row: "ovr-connect-1a2b3c4d". */
export function batchLabel(type: string, hash: string): string {
  return `${type}-${hash.slice(0, 8)}`;
}
