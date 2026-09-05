import { describe, expect, it } from 'vitest';
import { programHeaderLine } from '../plan/header';
import {
  DEFAULT_PROGRAM_WEEKS,
  defaultTargetDate,
  defaultTargetLabel,
  programStart,
  startAndTargetLine,
} from './startLine';

/**
 * "Starts Mon 7 Sep · 12 weeks to Sun 29 Nov".
 *
 * The owner is setting this up on a Saturday and wants to know which day week
 * 1 begins, which is not the same question as how long the cycle runs. Day 0
 * is the engine's rule and nothing else: the first picked weekday on or after
 * today.
 */

const SATURDAY = '2026-09-05';
const MONDAY = '2026-09-07';
/** Mon, Tue, Wed, Fri: the owner's four days. */
const OWNER_DAYS = [1, 2, 3, 5] as const;

describe('programStart', () => {
  it('waits for the first picked weekday on or after today', () => {
    expect(programStart(SATURDAY, OWNER_DAYS)).toBe(MONDAY);
  });

  it('starts today when today is already day 0', () => {
    expect(programStart(MONDAY, OWNER_DAYS)).toBe(MONDAY);
  });

  it('starts today when no weekday has been picked yet', () => {
    expect(programStart(SATURDAY, [])).toBe(SATURDAY);
  });
});

describe('defaultTargetDate', () => {
  it('offers twelve weeks of training, ending the day before week 13', () => {
    expect(DEFAULT_PROGRAM_WEEKS).toBe(12);
    expect(defaultTargetDate(SATURDAY, OWNER_DAYS)).toBe('2026-11-29');
    expect(defaultTargetDate(MONDAY, OWNER_DAYS)).toBe('2026-11-29');
  });

  it('names the date it offers, the way the Plan writes one', () => {
    expect(defaultTargetLabel(SATURDAY, OWNER_DAYS)).toBe('Use Sun 29 Nov');
  });
});

describe('startAndTargetLine', () => {
  it('says the start day and the span, from a Saturday', () => {
    expect(startAndTargetLine({ today: SATURDAY, weekdays: OWNER_DAYS, targetDate: '' })).toBe(
      'Starts Mon 7 Sep · 12 weeks to Sun 29 Nov',
    );
  });

  it('says the same thing from the Monday itself', () => {
    expect(startAndTargetLine({ today: MONDAY, weekdays: OWNER_DAYS, targetDate: '' })).toBe(
      'Starts Mon 7 Sep · 12 weeks to Sun 29 Nov',
    );
  });

  it('reads the date the athlete typed over the one on offer', () => {
    expect(
      startAndTargetLine({
        today: SATURDAY,
        weekdays: OWNER_DAYS,
        targetDate: '2026-12-06',
      }),
    ).toBe('Starts Mon 7 Sep · 13 weeks to Sun 6 Dec');
  });

  it('falls back to the offer when the typed date is not a date yet', () => {
    expect(
      startAndTargetLine({ today: SATURDAY, weekdays: OWNER_DAYS, targetDate: '2026-11' }),
    ).toBe('Starts Mon 7 Sep · 12 weeks to Sun 29 Nov');
  });

  it('says nothing before a weekday is picked', () => {
    // "Starts Sat 5 Sep" counted from the day the form happened to be opened
    // is what an unread athlete row used to produce. With no picks there is no
    // day 0, so there is no sentence either.
    expect(startAndTargetLine({ today: SATURDAY, weekdays: [], targetDate: '' })).toBeNull();
    expect(
      startAndTargetLine({ today: SATURDAY, weekdays: [], targetDate: '2026-11-29' }),
    ).toBeNull();
  });

  it('says nothing when the typed date lands before the start', () => {
    expect(
      startAndTargetLine({ today: SATURDAY, weekdays: OWNER_DAYS, targetDate: '2026-09-06' }),
    ).toBeNull();
  });
});

describe('the Plan header carries the same range', () => {
  it('writes the start and the end the way setup promised them', () => {
    const line = programHeaderLine({
      weeks: 12,
      daysPerWeek: 4,
      sport: 'speed_climbing',
      trainingAgeYears: 5,
      startDate: MONDAY,
      endDate: defaultTargetDate(SATURDAY, OWNER_DAYS),
    });
    expect(line).toContain('12 weeks');
    expect(line).toContain('Mon 7 Sep to Sun 29 Nov');
    expect(line).toContain('Speed climbing');
  });
});
