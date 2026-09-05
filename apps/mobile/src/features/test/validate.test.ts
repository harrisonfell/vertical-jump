import { describe, expect, it } from 'vitest';
import { inToMm } from '@vert/engine/units';
import {
  blankAttempt,
  derivedRsi,
  draftAttempts,
  isRsiMode,
  readDraft,
  summaryLine,
  type Attempt,
  type TestDraft,
} from './validate';

function attempt(heightIn: number | null, overrides: Partial<Attempt> = {}): Attempt {
  return { heightIn, gctMs: null, flagged: false, ...overrides };
}

function draft(attempts: readonly Attempt[], overrides: Partial<TestDraft> = {}): TestDraft {
  return {
    instrument: 'ovr_jump_regular',
    attempts,
    bodyweightLb: 181,
    boxHeightIn: null,
    notes: '',
    canonical: true,
    ...overrides,
  };
}

describe('bounds', () => {
  it('blocks a reading under the device floor and names the fix', () => {
    const reading = readDraft(draft([attempt(4.8), attempt(31.2), attempt(30.9)]), 31);
    expect(reading.canSave).toBe(false);
    expect(reading.issues[0]?.message).toBe(
      'Attempt 1 reads 4.8 in. The device does not record under 6.0 in. Check the number, or flag the attempt.',
    );
  });

  it('lets a flagged low reading through, because that is what the flag is for', () => {
    const reading = readDraft(
      draft([attempt(4.8, { flagged: true }), attempt(31.2), attempt(30.9)]),
      31,
    );
    expect(reading.canSave).toBe(true);
    expect(reading.bestIn).toBe(31.2);
    expect(reading.counted).toBe(2);
  });

  it('blocks a reading over the ceiling', () => {
    const reading = readDraft(draft([attempt(62), attempt(31), attempt(30)]), null);
    expect(reading.canSave).toBe(false);
    expect(reading.issues[0]?.message).toContain('over the 60.0 in ceiling');
  });

  it('warns on a jump of more than 6 in without blocking the save', () => {
    const reading = readDraft(draft([attempt(39), attempt(31.2), attempt(30.9)]), 31);
    expect(reading.canSave).toBe(true);
    const warning = reading.issues.find((issue) => !issue.blocking);
    expect(warning?.message).toBe(
      'Attempt 1 is 8.0 in above your last test. Check the number, or save it if it is right.',
    );
  });

  it('stays quiet about a big change when there is no last test to compare with', () => {
    const reading = readDraft(draft([attempt(39), attempt(31.2), attempt(30.9)]), null);
    expect(reading.issues).toHaveLength(0);
  });

  it('needs at least one attempt that is not flagged', () => {
    const reading = readDraft(
      draft([attempt(30, { flagged: true }), attempt(31, { flagged: true })]),
      null,
    );
    expect(reading.canSave).toBe(false);
    expect(reading.issues.at(-1)?.message).toBe('Enter at least one attempt that is not flagged.');
  });
});

describe('RSI mode', () => {
  const rsiDraft = (attempts: readonly Attempt[]): TestDraft =>
    draft(attempts, { instrument: 'ovr_jump_rsi', boxHeightIn: 18 });

  it('blocks a contact time outside 100 to 1000 ms', () => {
    const low = readDraft(rsiDraft([attempt(24, { gctMs: 60 })]), null);
    expect(low.canSave).toBe(false);
    expect(low.issues[0]?.message).toBe(
      'Attempt 1 contact time 60 ms. Contact time reads between 100 and 1000 ms. Check the number.',
    );

    const high = readDraft(rsiDraft([attempt(24, { gctMs: 1200 })]), null);
    expect(high.canSave).toBe(false);
  });

  it('asks for a contact time before it will save an RSI attempt', () => {
    const reading = readDraft(rsiDraft([attempt(24)]), null);
    expect(reading.canSave).toBe(false);
    expect(reading.issues[0]?.message).toContain('needs a contact time');
  });

  it('derives RSI as height in metres over contact time in seconds', () => {
    // 24 in is 0.6096 m; over 0.2 s that is 3.048 m/s.
    expect(derivedRsi(24, 200)).toBeCloseTo(3.048, 3);
    expect(derivedRsi(24, null)).toBeNull();
    expect(derivedRsi(24, 0)).toBeNull();
  });

  it('starts an RSI attempt with a contact time and a regular one without', () => {
    expect(blankAttempt('ovr_jump_rsi').heightIn).toBeNull();
    expect(blankAttempt('ovr_jump_rsi').gctMs).toBe(200);
    expect(blankAttempt('ovr_jump_regular').gctMs).toBeNull();
    expect(isRsiMode('ovr_jump_rsi')).toBe(true);
    expect(isRsiMode('vertec_reach_touch')).toBe(false);
  });
});

describe('the live reading', () => {
  it('reports best, spread, and the count that fed them', () => {
    const reading = readDraft(draft([attempt(31.2), attempt(32.5), attempt(31.9)]), 31);
    expect(reading.bestIn).toBe(32.5);
    expect(reading.spreadIn).toBeCloseTo(1.3, 5);
    expect(summaryLine(reading)).toBe('Best 32.5 in · spread 1.3 in · 3 attempts');
  });

  it('has no spread from one attempt', () => {
    const reading = readDraft(draft([attempt(31.2)]), null);
    expect(reading.spreadIn).toBeNull();
    expect(summaryLine(reading)).toBe('Best 31.2 in · 1 attempt');
  });

  it('says so before anything counts', () => {
    const reading = readDraft(draft([attempt(30, { flagged: true })]), null);
    expect(summaryLine(reading)).toBe('No attempt counted yet.');
  });
});

describe('what a save writes', () => {
  it('converts to millimetres and carries the flag and its reason', () => {
    const rows = draftAttempts(
      draft([attempt(32.5), attempt(30, { flagged: true })], { instrument: 'ovr_jump_regular' }),
    );
    expect(rows[0]).toEqual({
      attemptIndex: 1,
      heightMm: inToMm(32.5),
      gctMs: null,
      rsiCalc: null,
      flagged: false,
      rejectReason: null,
    });
    expect(rows[1]?.flagged).toBe(true);
    expect(rows[1]?.rejectReason).toBe('landed outside the field');
  });

  it('stores the RSI it computed beside the contact time', () => {
    const rows = draftAttempts(
      draft([attempt(24, { gctMs: 200 })], { instrument: 'ovr_jump_rsi' }),
    );
    expect(rows[0]?.gctMs).toBe(200);
    expect(rows[0]?.rsiCalc).toBeCloseTo(3.048, 3);
  });
});

describe('rows nobody typed into', () => {
  const OPENING = (instrument: TestDraft['instrument'] = 'ovr_jump_regular') =>
    draft([attempt(32.5), blankAttempt(instrument), blankAttempt(instrument)], { instrument });

  it('starts every attempt empty, so an untouched row is not a jump', () => {
    const blank = blankAttempt('ovr_jump_regular');
    expect(blank.heightIn).toBeNull();
    const reading = readDraft(draft([blank, blank, blank]), null);
    expect(reading.counted).toBe(0);
    expect(reading.canSave).toBe(false);
    expect(reading.issues).toHaveLength(1);
    expect(reading.issues[0]?.message).toBe('Enter at least one attempt that is not flagged.');
  });

  it('counts one typed attempt beside two blanks, with no spread', () => {
    const reading = readDraft(OPENING(), null);
    expect(reading.canSave).toBe(true);
    expect(reading.counted).toBe(1);
    expect(reading.bestIn).toBe(32.5);
    expect(reading.spreadIn).toBeNull();
    expect(summaryLine(reading)).toBe('Best 32.5 in · 1 attempt');
  });

  it('writes only the rows that carry a reading, renumbered', () => {
    const rows = draftAttempts(OPENING());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attemptIndex).toBe(1);
    expect(rows[0]?.heightMm).toBe(inToMm(32.5));
  });

  it('does not ask an empty RSI row for a contact time', () => {
    const reading = readDraft(
      draft([attempt(24, { gctMs: 200 }), blankAttempt('ovr_jump_rsi')], {
        instrument: 'ovr_jump_rsi',
        boxHeightIn: 18,
      }),
      null,
    );
    expect(reading.canSave).toBe(true);
    expect(reading.issues).toHaveLength(0);
  });

  it('has no RSI for a row with no height', () => {
    expect(derivedRsi(null, 200)).toBeNull();
  });
});
