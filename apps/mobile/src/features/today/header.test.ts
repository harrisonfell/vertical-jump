import { describe, expect, it } from 'vitest';
import { headerDate, headerDuration, headerTitle, restDayTitle } from './header';
import { missedLine, needsReentry, reassessmentDue, reentryTitle } from './cards';

describe('headerTitle', () => {
  it('names the week, the block, and the day', () => {
    expect(
      headerTitle({
        w: 7,
        W: 12,
        blockType: 'power',
        dayType: 'Power + Speed',
        suffixes: [],
      }),
    ).toBe('Week 7 of 12 · Power block · Power + Speed');
  });

  it('appends the engine suffixes without re-punctuating them', () => {
    expect(
      headerTitle({
        w: 5,
        W: 12,
        blockType: 'strength',
        dayType: 'Lower Strength',
        suffixes: ['· Deload', '· Repeat of week 4'],
      }),
    ).toBe('Week 5 of 12 · Strength block · Lower Strength · Deload · Repeat of week 4');
  });

  it('adds the restricted suffix once and only once', () => {
    const args = {
      w: 1,
      W: 12,
      blockType: null,
      dayType: 'Upper Strength',
      restricted: true,
    };
    expect(headerTitle({ ...args, suffixes: [] })).toBe(
      'Week 1 of 12 · Upper Strength · Restricted',
    );
    expect(headerTitle({ ...args, suffixes: ['· Restricted'] })).toBe(
      'Week 1 of 12 · Upper Strength · Restricted',
    );
  });
});

describe('headerDate', () => {
  it('carries the weekday, because the runner is a calendar screen', () => {
    expect(headerDate('2026-10-22')).toBe('Thu 22 Oct');
    expect(headerDate('2026-09-07')).toBe('Mon 7 Sep');
  });
});

describe('headerDuration', () => {
  it('rounds to a word the athlete can plan around', () => {
    expect(headerDuration(98)).toBe('about 98 min');
  });

  it('says nothing when the engine gave no estimate', () => {
    expect(headerDuration(null)).toBeUndefined();
    expect(headerDuration(0)).toBeUndefined();
  });
});

describe('rest day and cards', () => {
  it('names the week on a rest day', () => {
    expect(restDayTitle(7)).toBe('Rest day · Week 7');
  });

  it('names the missed day and its type', () => {
    expect(missedLine('2026-10-19', 'Lower Strength')).toBe('Missed Mon · Lower Strength');
  });

  it('calls a break at fourteen days, not thirteen', () => {
    expect(needsReentry('2026-10-09', '2026-10-22')).toBe(false);
    expect(needsReentry('2026-10-08', '2026-10-22')).toBe(true);
    expect(needsReentry(null, '2026-10-22')).toBe(false);
  });

  it('counts the days away', () => {
    expect(reentryTitle('2026-10-01', '2026-10-22')).toBe('21 days since your last session');
  });

  it('opens the reassessment on its due date and not before', () => {
    expect(reassessmentDue('2026-10-23', '2026-10-22')).toBe(false);
    expect(reassessmentDue('2026-10-22', '2026-10-22')).toBe(true);
    expect(reassessmentDue(null, '2026-10-22')).toBe(false);
  });
});
