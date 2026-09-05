import { describe, expect, it } from 'vitest';
import { recoveryBand, stripModel, type StripInput } from './strip';

/**
 * The three-slot strip, in every state it can honestly be in.
 *
 * The rule the owner asked for is that the strip never hides: Recovery, Sleep
 * and Strain are all three on screen whatever Whoop has, and each one says
 * which of the four things is true. A slot that disappeared on an unscored
 * night would read as a night with nothing wrong with it.
 */

const SCORED: StripInput = {
  connectionStatus: 'connected',
  backfillDaysDone: 90,
  backfillDaysTotal: 90,
  lastSyncAt: '2026-09-04T06:40:00.000Z',
  recoveryScore: 67,
  recoveryState: 'scored',
  sleepPerformance: 84,
  sleepHours: 7.2,
  sleepState: 'scored',
  strainToday: 13.4,
  strainYesterday: 13.2,
  strainState: 'scored',
  today: '2026-09-04',
};

function labels(input: StripInput): string[] {
  return stripModel(input).slots.map((slot) => slot.label);
}

describe('recoveryBand', () => {
  it('cuts where Whoop cuts, at 34 and 67', () => {
    expect(recoveryBand(33)).toBe('low');
    expect(recoveryBand(34)).toBe('moderate');
    expect(recoveryBand(66)).toBe('moderate');
    expect(recoveryBand(67)).toBe('high');
  });
});

describe('stripModel, three fixed slots', () => {
  it('always names Recovery, Sleep and Strain, in that order', () => {
    expect(labels(SCORED)).toEqual(['Recovery', 'Sleep', 'Strain']);
    expect(labels({ ...SCORED, connectionStatus: null })).toEqual([
      'Recovery',
      'Sleep',
      'Strain',
    ]);
    expect(
      labels({
        ...SCORED,
        recoveryState: 'missing',
        sleepState: 'missing',
        strainState: 'missing',
      }),
    ).toEqual(['Recovery', 'Sleep', 'Strain']);
  });

  it('shows the day the strap scored everything', () => {
    const model = stripModel(SCORED);
    expect(model.state).toBe('connected');
    // The clock is the device's own, so the assertion is that there is one.
    expect(model.syncedAt).not.toBeUndefined();
    expect(model.slots.map((slot) => slot.value)).toEqual(['67%', '84%', '13.4']);
    expect(model.slots[0]?.band).toBe('high');
    expect(model.slots[1]?.detail).toBe('7.2 h');
    expect(model.slots[2]?.detail).toBe('yday 13.2');
    expect(model.slots.every((slot) => slot.state === 'value')).toBe(true);
  });

  it('says pending while Whoop holds a cycle it has not scored', () => {
    const model = stripModel({
      ...SCORED,
      recoveryScore: null,
      recoveryState: 'pending',
      strainToday: null,
      strainState: 'pending',
    });
    expect(model.slots[0]).toEqual({ label: 'Recovery', value: null, state: 'pending' });
    expect(model.slots[2]?.state).toBe('pending');
    // The partial day: one channel pending, the one beside it fully scored.
    expect(model.slots[1]?.value).toBe('84%');
  });

  it('says no data when there is no cycle for the day at all', () => {
    const model = stripModel({
      ...SCORED,
      strainToday: null,
      strainYesterday: null,
      strainState: 'missing',
    });
    expect(model.slots[2]).toEqual({ label: 'Strain', value: null, state: 'noData' });
  });

  it('never shows a number the state does not back', () => {
    // A score left on the input while the state says pending is a bug upstream;
    // the model refuses it rather than printing a stale percent.
    const model = stripModel({ ...SCORED, recoveryState: 'pending' });
    expect(model.slots[0]?.value).toBeNull();
  });

  it('says not connected once, on all three, when the strap is not linked', () => {
    const model = stripModel({ ...SCORED, connectionStatus: null });
    expect(model.state).toBe('notConnected');
    expect(model.slots.every((slot) => slot.state === 'notConnected')).toBe(true);
    expect(model.slots.every((slot) => slot.value === null)).toBe(true);
  });

  it('treats a revoked or errored connection the same way', () => {
    for (const status of ['revoked', 'error']) {
      const model = stripModel({ ...SCORED, connectionStatus: status });
      expect(model.state).toBe('revoked');
      expect(model.slots.every((slot) => slot.state === 'notConnected')).toBe(true);
    }
  });

  it('keeps the numbers on screen when the sync went stale', () => {
    const model = stripModel({ ...SCORED, lastSyncAt: '2026-09-01T06:40:00.000Z' });
    expect(model.state).toBe('stale');
    expect(model.staleDays).toBe(3);
    expect(model.slots.map((slot) => slot.value)).toEqual(['67%', '84%', '13.4']);
  });

  it('counts the backfill while it runs and keeps whatever is already in', () => {
    const model = stripModel({ ...SCORED, backfillDaysDone: 40, backfillDaysTotal: 90 });
    expect(model.state).toBe('importing');
    expect(model.importedDays).toBe(40);
    expect(model.importTotalDays).toBe(90);
    expect(model.slots[0]?.value).toBe('67%');
  });

  it('assumes ninety days while a fresh connection is still opening', () => {
    const model = stripModel({
      ...SCORED,
      connectionStatus: 'connecting',
      backfillDaysDone: 0,
      backfillDaysTotal: 0,
    });
    expect(model.state).toBe('importing');
    expect(model.importTotalDays).toBe(90);
  });

  it('rounds percents the way Whoop shows them and strain to one decimal', () => {
    const model = stripModel({
      ...SCORED,
      recoveryScore: 66.6,
      sleepPerformance: 83.4,
      strainToday: 9,
      strainYesterday: 12,
    });
    expect(model.slots.map((slot) => slot.value)).toEqual(['67%', '83%', '9.0']);
    expect(model.slots[2]?.detail).toBe('yday 12.0');
    expect(model.slots[0]?.band).toBe('moderate');
  });
});
