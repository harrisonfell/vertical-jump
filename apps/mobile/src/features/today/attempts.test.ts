import { describe, expect, it } from 'vitest';
import { inToMm } from '@vert/engine/units';
import {
  attemptRsi,
  attemptsLine,
  bestIn,
  canSave,
  emptyAttempts,
  gctError,
  heightError,
  liveReadout,
  spreadIn,
  usableAttempts,
  validateAttempts,
  type Attempt,
} from './attempts';

function attempt(index: number, heightIn: number | null, patch: Partial<Attempt> = {}): Attempt {
  return { index, heightIn, gctMs: null, flagged: false, ...patch };
}

describe('bounds', () => {
  it('accepts an empty field', () => {
    expect(heightError(null)).toBeNull();
  });

  it('refuses a height under the device floor', () => {
    expect(heightError(5.9)).toBe('The OVR Jump reads from 6 in. Check the number.');
  });

  it('refuses a height over 60 in', () => {
    expect(heightError(60.1)).toBe('Heights stop at 60 in. Check the number.');
  });

  it('accepts the boundaries themselves', () => {
    expect(heightError(6)).toBeNull();
    expect(heightError(60)).toBeNull();
  });

  it('refuses a contact time outside 100 to 1000 ms in RSI mode', () => {
    expect(gctError(99, true)).toBe('Contact time runs 100 to 1000 ms. Check the number.');
    expect(gctError(1001, true)).toBe('Contact time runs 100 to 1000 ms. Check the number.');
    expect(gctError(212, true)).toBeNull();
  });

  it('ignores contact time outside RSI mode', () => {
    expect(gctError(20, false)).toBeNull();
  });
});

describe('validateAttempts', () => {
  const attempts = [attempt(1, 31.8), attempt(2, 32.5), attempt(3, 32.1)];

  it('passes a clean grid', () => {
    expect(validateAttempts({ attempts, rsiMode: false })).toEqual([]);
  });

  it('warns without blocking on a jump larger than six inches', () => {
    const errors = validateAttempts({ attempts, rsiMode: false, lastBestMm: inToMm(20) });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.blocking).toBe(false);
    expect(errors[0]?.message).toContain('from your last test');
  });

  it('puts blocking errors first', () => {
    const errors = validateAttempts({
      attempts: [attempt(1, 3), attempt(2, 32.5)],
      rsiMode: false,
      lastBestMm: inToMm(20),
    });
    expect(errors[0]?.blocking).toBe(true);
  });
});

describe('canSave', () => {
  it('refuses an empty grid', () => {
    expect(canSave({ attempts: emptyAttempts(3), rsiMode: false })).toBe(false);
  });

  it('refuses a grid with an out-of-range attempt', () => {
    expect(canSave({ attempts: [attempt(1, 200)], rsiMode: false })).toBe(false);
  });

  it('allows a grid whose only problem is the soft warning', () => {
    expect(
      canSave({ attempts: [attempt(1, 32.5)], rsiMode: false, lastBestMm: inToMm(20) }),
    ).toBe(true);
  });
});

describe('best and spread', () => {
  const attempts = [attempt(1, 31.8), attempt(2, 32.5), attempt(3, 32.1)];

  it('takes the best unflagged attempt', () => {
    expect(bestIn(attempts)).toBe(32.5);
  });

  it('excludes a flagged attempt from the best', () => {
    const flagged = [attempt(1, 31.8), attempt(2, 40, { flagged: true })];
    expect(bestIn(flagged)).toBe(31.8);
    expect(usableAttempts(flagged)).toHaveLength(1);
  });

  it('measures best minus worst', () => {
    expect(spreadIn(attempts)).toBeCloseTo(0.7, 5);
  });

  it('has no spread with a single attempt', () => {
    expect(spreadIn([attempt(1, 31.8)])).toBeNull();
  });

  it('has no best with nothing typed', () => {
    expect(bestIn(emptyAttempts(3))).toBeNull();
  });
});

describe('derived RSI', () => {
  it('is height in metres over contact time in seconds', () => {
    const rsi = attemptRsi(attempt(1, 20, { gctMs: 250 }));
    expect(rsi).toBeCloseTo(0.508 / 0.25, 2);
  });

  it('is absent without a contact time', () => {
    expect(attemptRsi(attempt(1, 20))).toBeNull();
  });
});

describe('readouts', () => {
  it('lists the attempts and the count', () => {
    expect(attemptsLine([attempt(1, 31.8), attempt(2, 32.5)])).toBe('31.8 · 32.5 · best of 2');
  });

  it('teaches the empty grid rather than showing a zero', () => {
    expect(attemptsLine(emptyAttempts(3))).toBe('No attempts yet');
    expect(liveReadout(emptyAttempts(3))).toBe(
      'Best and spread appear once an attempt is entered',
    );
  });

  it('names best and spread once two attempts stand', () => {
    expect(liveReadout([attempt(1, 31.8), attempt(2, 32.5)])).toBe('Best 32.5 in · spread 0.7 in');
  });
});
