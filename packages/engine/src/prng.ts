/**
 * Seeded PRNG. Every choice among equals in the engine goes through this,
 * never `Math.random` and never `Date.now`, so a week regenerated from the
 * same snapshot is byte-identical.
 *
 * mulberry32: a 32-bit state, one multiply-xorshift round, uniform enough for
 * tie-breaking and fast enough to fork per decision site.
 */

/** A deterministic stream. Forks are independent and reproducible by label. */
export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Throws when maxExclusive < 1. */
  int(maxExclusive: number): number;
  /** Uniform choice from a non-empty list. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** A stable shuffle; the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * A child stream keyed by a label, so a decision site keeps its own
   * sequence no matter what other sites do.
   */
  fork(label: string): Prng;
}

/** FNV-1a over UTF-16 code units, returned as an unsigned 32-bit integer. */
export function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Build a deterministic stream from a 32-bit seed. */
export function mulberry32(seed: number): Prng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const prng: Prng = {
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new RangeError('maxExclusive must be an integer of at least 1');
      }
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('cannot pick from an empty list');
      const chosen = items[prng.int(items.length)];
      if (chosen === undefined) throw new RangeError('pick produced no item');
      return chosen;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let index = out.length - 1; index > 0; index -= 1) {
        const swap = prng.int(index + 1);
        const a = out[index];
        const b = out[swap];
        if (a === undefined || b === undefined) continue;
        out[index] = b;
        out[swap] = a;
      }
      return out;
    },
    fork(label: string): Prng {
      return mulberry32((seed ^ hashLabel(label)) >>> 0);
    },
  };

  return prng;
}
