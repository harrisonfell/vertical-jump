import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  localDay,
  msUntilNextRollover,
  todayLocal,
  weekdayOf,
  zoneParts,
} from './localDay';

const NY = 'America/New_York';
const LDN = 'Europe/London';

describe('localDay', () => {
  it('reads the instant in the athlete zone, not UTC', () => {
    // 02:30 UTC on 15 Jan is still 21:30 on 14 Jan in New York.
    expect(localDay('2026-01-15T02:30:00Z', NY, 0)).toBe('2026-01-14');
    expect(localDay('2026-01-15T02:30:00Z', 'UTC', 0)).toBe('2026-01-15');
  });

  it('attributes anything before the rollover hour to the day before', () => {
    // A 1 a.m. finish after a late session belongs to the training day before.
    expect(localDay('2026-03-10T01:15:00-04:00', NY, 4)).toBe('2026-03-09');
    expect(localDay('2026-03-10T03:59:00-04:00', NY, 4)).toBe('2026-03-09');
    expect(localDay('2026-03-10T04:00:00-04:00', NY, 4)).toBe('2026-03-10');
  });

  it('handles the spring-forward gap without skipping a day', () => {
    // US DST starts 08 Mar 2026: 02:00 becomes 03:00 local.
    expect(localDay('2026-03-08T06:59:00Z', NY, 0)).toBe('2026-03-08'); // 01:59 EST
    expect(localDay('2026-03-08T07:00:00Z', NY, 0)).toBe('2026-03-08'); // 03:00 EDT
    // With a 4 a.m. rollover both of those are still the 7th's training day.
    expect(localDay('2026-03-08T06:59:00Z', NY, 4)).toBe('2026-03-07');
    expect(localDay('2026-03-08T07:00:00Z', NY, 4)).toBe('2026-03-07');
    expect(localDay('2026-03-08T08:00:00Z', NY, 4)).toBe('2026-03-08'); // 04:00 EDT
  });

  it('handles the autumn fall-back hour without repeating a day', () => {
    // US DST ends 01 Nov 2026: 01:00 EDT and 01:00 EST are both "01:00".
    expect(localDay('2026-11-01T05:30:00Z', NY, 0)).toBe('2026-11-01'); // 01:30 EDT
    expect(localDay('2026-11-01T06:30:00Z', NY, 0)).toBe('2026-11-01'); // 01:30 EST
    expect(localDay('2026-11-01T05:30:00Z', NY, 4)).toBe('2026-10-31');
    expect(localDay('2026-11-01T06:30:00Z', NY, 4)).toBe('2026-10-31');
    expect(localDay('2026-11-01T08:00:00Z', NY, 4)).toBe('2026-10-31'); // 03:00 EST
    expect(localDay('2026-11-01T09:00:00Z', NY, 4)).toBe('2026-11-01'); // 04:00 EST
  });

  it('crosses a month and a year boundary backwards', () => {
    expect(localDay('2026-01-01T02:00:00Z', 'UTC', 4)).toBe('2025-12-31');
    expect(localDay('2026-03-01T01:00:00Z', 'UTC', 4)).toBe('2026-02-28');
    expect(localDay('2028-03-01T01:00:00Z', 'UTC', 4)).toBe('2028-02-29');
  });

  it('works east of Greenwich and across a British summer-time change', () => {
    expect(localDay('2026-03-29T00:30:00Z', LDN, 4)).toBe('2026-03-28');
    expect(localDay('2026-03-29T02:30:00Z', LDN, 4)).toBe('2026-03-28'); // 03:30 BST
    expect(localDay('2026-03-29T04:00:00Z', LDN, 4)).toBe('2026-03-29'); // 05:00 BST
  });

  it('rejects a bad rollover hour and a bad timestamp', () => {
    expect(() => localDay('2026-01-01T00:00:00Z', 'UTC', 24)).toThrow(RangeError);
    expect(() => localDay('2026-01-01T00:00:00Z', 'UTC', -1)).toThrow(RangeError);
    expect(() => localDay('not a date', 'UTC', 0)).toThrow(RangeError);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(localDay(new Date('2026-06-01T12:00:00Z'), 'UTC', 0)).toBe('2026-06-01');
  });

  it('reports wall-clock parts in the zone', () => {
    const parts = zoneParts('2026-07-04T16:45:00Z', NY);
    expect(parts).toEqual({ year: 2026, month: 7, day: 4, hour: 12, minute: 45 });
  });
});

describe('calendar helpers', () => {
  it('adds days without a timezone anywhere near it', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7);
    expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7);
    // A DST week is still seven days.
    expect(daysBetween('2026-03-07', '2026-03-14')).toBe(7);
    expect(daysBetween('2026-10-31', '2026-11-07')).toBe(7);
  });

  it('knows the weekday, Sunday first', () => {
    expect(weekdayOf('2026-09-07')).toBe(1); // a Monday
    expect(weekdayOf('2026-09-06')).toBe(0); // a Sunday
  });

  it('rejects anything that is not a YYYY-MM-DD date', () => {
    expect(() => addDays('7 Sep 2026', 1)).toThrow(RangeError);
    expect(() => daysBetween('2026-09-07', '')).toThrow(RangeError);
  });

  it('reads today from a supplied clock', () => {
    expect(todayLocal(NY, 4, new Date('2026-09-08T05:00:00Z'))).toBe('2026-09-07');
    expect(todayLocal(NY, 4, new Date('2026-09-08T13:00:00Z'))).toBe('2026-09-08');
  });

  describe('msUntilNextRollover', () => {
    const minutes = (ms: number): number => (ms - 1_000) / 60_000;

    it('counts the wall-clock minutes to the next midnight', () => {
      // 22:30 in New York on 8 Sep 2026 is 02:30 UTC on the 9th.
      expect(minutes(msUntilNextRollover(NY, 0, new Date('2026-09-09T02:30:00Z')))).toBe(90);
    });

    it('counts to a rollover hour later today', () => {
      // 01:00 in New York, rollover at 04:00: three hours away, same date.
      expect(minutes(msUntilNextRollover(NY, 4, new Date('2026-09-09T05:00:00Z')))).toBe(180);
    });

    it('rolls to tomorrow once the hour has passed', () => {
      // 05:00 in New York, rollover at 04:00: 23 hours to the next one.
      expect(minutes(msUntilNextRollover(NY, 4, new Date('2026-09-09T09:00:00Z')))).toBe(23 * 60);
    });

    it('always returns a positive interval, so a timer never fires in a loop', () => {
      for (const hour of [0, 4, 12, 23]) {
        expect(msUntilNextRollover(NY, hour, new Date('2026-09-09T09:00:00Z'))).toBeGreaterThan(0);
      }
    });
  });
});
