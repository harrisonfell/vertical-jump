import { describe, expect, it } from 'vitest';
import {
  clampDate,
  dateFieldText,
  dateToLocalDate,
  formatFullDate,
  localDateToDate,
  pickerStart,
  todayFromClock,
} from './dateFieldModel';

const TARGET = '2026-11-29';
const TODAY = '2026-09-05';

describe('formatFullDate', () => {
  it('writes the target date the way a calendar does', () => {
    expect(formatFullDate(TARGET)).toBe('Sun 29 Nov 2026');
  });

  it('agrees with Settings on every weekday name', () => {
    expect(formatFullDate('2026-10-12')).toBe('Mon 12 Oct 2026');
    expect(formatFullDate('2026-09-05')).toBe('Sat 5 Sep 2026');
    expect(formatFullDate('2027-01-01')).toBe('Fri 1 Jan 2027');
  });
});

describe('dateFieldText', () => {
  it('falls back to the empty word with nothing chosen', () => {
    expect(dateFieldText('', 'Not set')).toBe('Not set');
    expect(dateFieldText('   ', 'Not set')).toBe('Not set');
  });

  it('reads a stored day back as a calendar day', () => {
    expect(dateFieldText(TARGET, 'Not set')).toBe('Sun 29 Nov 2026');
  });

  it('shows a half-typed value exactly as it stands', () => {
    expect(dateFieldText('2026-11', 'Not set')).toBe('2026-11');
    expect(dateFieldText('2026-02-30', 'Not set')).toBe('2026-02-30');
  });
});

describe('the picker crossing', () => {
  it('lands the picker on the day the field holds, not the day before', () => {
    const instant = localDateToDate(TARGET);
    expect(instant.getFullYear()).toBe(2026);
    expect(instant.getMonth()).toBe(10);
    expect(instant.getDate()).toBe(29);
  });

  it('sits at local noon, so no daylight-saving shift can move the day', () => {
    expect(localDateToDate(TARGET).getHours()).toBe(12);
  });

  it('round-trips every day of a year in the runner zone', () => {
    let date = '2026-01-01';
    for (let index = 0; index < 365; index += 1) {
      expect(dateToLocalDate(localDateToDate(date))).toBe(date);
      const next = localDateToDate(date);
      next.setDate(next.getDate() + 1);
      date = dateToLocalDate(next);
    }
    expect(date).toBe('2027-01-01');
  });

  it('reads the picker back off its calendar parts, never off its instant', () => {
    expect(dateToLocalDate(new Date(2026, 10, 29, 23, 30))).toBe('2026-11-29');
    expect(dateToLocalDate(new Date(2026, 10, 29, 0, 15))).toBe('2026-11-29');
    expect(dateToLocalDate(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('pads a single-digit month and day', () => {
    expect(dateToLocalDate(new Date(2026, 8, 5, 12))).toBe('2026-09-05');
  });

  it('reads the device clock as a plain day', () => {
    expect(todayFromClock(new Date(2026, 8, 5, 6, 30))).toBe('2026-09-05');
  });
});

describe('clampDate', () => {
  it('leaves a day inside the range alone', () => {
    expect(clampDate(TARGET, TODAY, '2027-01-01')).toBe(TARGET);
  });

  it('lifts a day below the minimum, which is the two-week floor', () => {
    expect(clampDate('2026-09-01', '2026-09-19')).toBe('2026-09-19');
  });

  it('pulls a day past the maximum back, which is a set done today or earlier', () => {
    expect(clampDate('2026-09-30', undefined, TODAY)).toBe(TODAY);
  });

  it('passes anything through with neither bound', () => {
    expect(clampDate(TARGET)).toBe(TARGET);
  });
});

describe('pickerStart', () => {
  it('opens on the day the field holds', () => {
    expect(pickerStart({ value: TARGET, fallback: TODAY })).toBe(TARGET);
  });

  it('opens on the offered default when the field is empty', () => {
    expect(pickerStart({ value: '', fallback: TODAY })).toBe(TODAY);
  });

  it('opens on the default when what is there is not a date', () => {
    expect(pickerStart({ value: '29 Nov', fallback: TODAY })).toBe(TODAY);
    expect(pickerStart({ value: '2026-13-01', fallback: TODAY })).toBe(TODAY);
  });

  it('never opens on a day it would refuse', () => {
    expect(pickerStart({ value: '', fallback: TODAY, minimumDate: '2026-09-19' })).toBe(
      '2026-09-19',
    );
    expect(pickerStart({ value: '2026-12-25', fallback: TODAY, maximumDate: TODAY })).toBe(TODAY);
  });

  it('ignores surrounding space in a stored day', () => {
    expect(pickerStart({ value: ` ${TARGET} `, fallback: TODAY })).toBe(TARGET);
  });
});
