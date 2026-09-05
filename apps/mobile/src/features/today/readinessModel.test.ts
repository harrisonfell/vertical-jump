import { describe, expect, it } from 'vitest';
import { RULESET_V1, SUFFIX } from '@vert/engine';
import type { ReadinessTestConfig, ReadinessTestSession } from '@vert/engine';
import {
  bareAttemptText,
  bestLine,
  bestOf,
  isNoOpAdjustment,
  logLabel,
  readinessRowModel,
  saveLabel,
  testUnit,
  toEngineTest,
  toEngineTests,
  verdictLine,
  whoopChannel,
} from './readinessModel';

/**
 * The gate's two channels, as the row reads them.
 *
 * Every case here is a day the house rule names: both channels, one channel,
 * the other channel, and neither. Nothing asserts a colour, because the row
 * has none: the state is a sentence.
 */

const CONFIG: ReadinessTestConfig = { ...RULESET_V1.constants.climbing.readiness };

/** Nine steady throws, which is the median every case below is scored against. */
const HISTORY: ReadinessTestSession[] = [7.0, 7.2, 7.1, 7.0, 7.2, 7.1, 7.1, 7.2, 7.0].map(
  (best, index) => ({
    id: `throw-${index}`,
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    kind: 'seated_mb_throw',
    attempts: [best - 0.2, best - 0.1, best],
    best,
    unit: 'm',
  }),
);

function throwToday(best: number): ReadinessTestSession {
  return {
    id: 'throw-today',
    date: '2026-10-22',
    kind: 'seated_mb_throw',
    attempts: [best - 0.2, best - 0.1, best],
    best,
    unit: 'm',
  };
}

describe('both channels', () => {
  const model = readinessRowModel({
    config: CONFIG,
    whoop: whoopChannel({ date: '2026-10-22', score: 73 }),
    test: throwToday(7.15),
    history: HISTORY,
  });

  it('reads the strap in the strap’s own words, with the attribution', () => {
    expect(model.autonomicLine).toBe('Recovery 73% High. Data by WHOOP');
  });

  it('reads the throw against its own rolling median', () => {
    expect(model.neuromuscularLine).toBe('Throw 7.2 m (7-test median 7.1, within 5%).');
  });

  it('says what the two of them do, and never averages them', () => {
    expect(model.outcome?.state).toBe('both_high');
    expect(model.outcomeLine).toBe('Autonomic fine, neuromuscular fine: session as written.');
    expect(model.suffix).toBeNull();
  });

  it('offers to change the entry once it is in', () => {
    expect(model.logged).toBe(true);
    expect(model.actionLabel).toBe('Change');
  });
});

describe('one channel low', () => {
  it('holds the volume when only the autonomic channel is down', () => {
    const model = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: 31 }),
      test: throwToday(7.15),
      history: HISTORY,
    });
    expect(model.outcome?.state).toBe('autonomic_low');
    expect(model.outcomeLine).toBe(
      'Autonomic low, neuromuscular fine: session as written, volume held.',
    );
    expect(model.suffix).toBe(SUFFIX.readinessHeld);
  });

  it('drops a tier when only the neuromuscular channel is down', () => {
    const model = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: 73 }),
      test: throwToday(6.2),
      history: HISTORY,
    });
    expect(model.outcome?.state).toBe('neuromuscular_low');
    expect(model.outcomeLine).toContain('maximal jumps out');
    expect(model.suffix).toBe(SUFFIX.readinessTierDown);
  });

  it('offers the recovery day only when both are down', () => {
    const model = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: 31 }),
      test: throwToday(6.2),
      history: HISTORY,
    });
    expect(model.outcome?.state).toBe('both_low');
    expect(model.outcomeLine).toContain('You can move a recovery day here.');
    expect(model.suffix).toBe(SUFFIX.readinessTierDown);
  });
});

describe('one channel missing', () => {
  it('shows the recovery it has and asks for the throw it does not', () => {
    const model = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: 73 }),
      test: null,
      history: HISTORY,
    });
    expect(model.autonomicLine).toContain('73%');
    expect(model.neuromuscularLine).toBe('No throw logged today.');
    expect(model.outcome?.state).toBe('unknown');
    expect(model.logged).toBe(false);
    expect(model.actionLabel).toBe('Log throw');
    expect(model.suffix).toBeNull();
  });

  it('adjusts on the neuromuscular channel alone when the strap did not score', () => {
    const model = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: null }),
      test: throwToday(6.2),
      history: HISTORY,
    });
    expect(model.autonomicLine).toBe('No recovery score for today.');
    expect(model.outcome?.state).toBe('neuromuscular_low');
    expect(model.suffix).toBe(SUFFIX.readinessTierDown);
  });
});

describe('neither channel', () => {
  const model = readinessRowModel({
    config: CONFIG,
    whoop: null,
    test: null,
    history: [],
  });

  it('is one caption line and adjusts nothing', () => {
    expect(model.outcome).toBeNull();
    expect(model.outcomeLine).toBeNull();
    expect(model.suffix).toBeNull();
    expect(model.caption).toBe('No recovery score for today. No throw logged today.');
  });
});

describe('a baseline still calibrating', () => {
  it('reads unknown rather than cutting a session on two throws', () => {
    const model = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: 73 }),
      test: throwToday(4.0),
      history: HISTORY.slice(0, 2),
    });
    expect(model.neuromuscularLine).toContain('calibrating, 2 of 3 tests');
    expect(model.outcome?.state).toBe('unknown');
    expect(model.suffix).toBeNull();
  });
});

describe('the channel A band', () => {
  it('uses Whoop’s own cuts and never invents one for a missing score', () => {
    expect(whoopChannel({ date: '2026-10-22', score: 20 })?.band).toBe('low');
    expect(whoopChannel({ date: '2026-10-22', score: 50 })?.band).toBe('moderate');
    expect(whoopChannel({ date: '2026-10-22', score: 90 })?.band).toBe('high');
    expect(whoopChannel({ date: '2026-10-22', score: null })?.band).toBeNull();
    expect(whoopChannel(null)).toBeNull();
  });
});

describe('the stored row as the engine reads it', () => {
  const row = {
    id: 'rt-1',
    athleteId: 'owner',
    localDate: '2026-10-22',
    kind: 'seated_mb_throw' as const,
    metric: 'distance_m' as const,
    attempts: [6.9, 7.0, 7.15],
    best: 7.15,
    unit: 'm',
    whoopRecoverySnapshot: null,
    entrySource: 'typed' as const,
    createdAt: '2026-10-22T12:00:00.000Z',
  };

  it('carries the day, the attempts and the best', () => {
    expect(toEngineTest(row)).toEqual({
      id: 'rt-1',
      date: '2026-10-22',
      kind: 'seated_mb_throw',
      attempts: [6.9, 7.0, 7.15],
      best: 7.15,
      unit: 'm',
    });
  });

  it('is not a test when nothing usable was logged', () => {
    expect(toEngineTest({ ...row, best: null })).toBeNull();
    expect(toEngineTest(null)).toBeNull();
    expect(toEngineTests([{ ...row, best: null }, row])).toHaveLength(1);
  });
});

describe('the entry', () => {
  it('prints the bare number, so what it shows can be typed back', () => {
    expect(bareAttemptText(7.15, CONFIG)).toBe('7.2');
    expect(bareAttemptText(0, CONFIG)).toBe('0.0');
  });

  it('takes the best of what was typed and counts nothing else', () => {
    expect(bestOf([6.9, null, 7.2])).toBe(7.2);
    expect(bestOf([null, null, null])).toBeNull();
    expect(bestLine([6.9, null, 7.2], CONFIG)).toBe('Best 7.2 m of 2 attempts');
    expect(bestLine([null, null, null], CONFIG)).toBe('Best of 3 attempts');
  });

  it('names the test the same way in both labels and in the record', () => {
    expect(logLabel(CONFIG)).toBe('Log throw');
    expect(saveLabel(CONFIG)).toBe('Save throw');
    expect(testUnit(CONFIG)).toBe('m');
    expect(testUnit({ ...CONFIG, kind: 'rsi', metric: 'rsi' })).toBe('RSI');
  });
});

describe('an adjustment that changes nothing', () => {
  it('is the one the session may re-derive from', () => {
    expect(isNoOpAdjustment(RULESET_V1.constants.climbing.readinessAdjustments.both_high)).toBe(
      true,
    );
    expect(isNoOpAdjustment(RULESET_V1.constants.climbing.readinessAdjustments.unknown)).toBe(true);
    expect(isNoOpAdjustment(RULESET_V1.constants.climbing.readinessAdjustments.both_low)).toBe(
      false,
    );
    // Holding today's volume raise is not a reduction of what is on screen.
    expect(
      isNoOpAdjustment(RULESET_V1.constants.climbing.readinessAdjustments.autonomic_low),
    ).toBe(true);
  });
});

describe('the verdict', () => {
  it('is the engine’s own second half, so the row and the notice agree', () => {
    const outcome = readinessRowModel({
      config: CONFIG,
      whoop: whoopChannel({ date: '2026-10-22', score: 31 }),
      test: throwToday(6.2),
      history: HISTORY,
    }).outcome;
    expect(outcome).not.toBeNull();
    if (outcome === null) return;
    expect(outcome.line.endsWith(verdictLine(outcome))).toBe(true);
  });
});
