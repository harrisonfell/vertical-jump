import { describe, expect, it } from 'vitest';
import {
  contextTitle,
  programHeaderLine,
  sportLabel,
  trainingAgeLabel,
  versionNote,
  versionSpan,
} from './header';
import { formatDayDate } from './dates';

describe('trainingAgeLabel', () => {
  it('shows the answer the athlete gave, never the level', () => {
    expect(trainingAgeLabel(0)).toBe('None');
    expect(trainingAgeLabel(0.5)).toBe('Under 1 yr');
    expect(trainingAgeLabel(2)).toBe('1-3 yrs');
    expect(trainingAgeLabel(5)).toBe('4+ yrs');
  });

  it('is absent when nothing was answered', () => {
    expect(trainingAgeLabel(null)).toBeNull();
  });

  it('never says beginner, intermediate or advanced', () => {
    for (const years of [0, 0.5, 2, 5]) {
      expect(trainingAgeLabel(years)?.toLowerCase()).not.toMatch(
        /beginner|intermediate|advanced/,
      );
    }
  });
});

describe('formatDayDate', () => {
  it('writes a weekday and a short date', () => {
    expect(formatDayDate('2026-09-07')).toBe('Mon 7 Sep');
    expect(formatDayDate('2026-11-29')).toBe('Sun 29 Nov');
  });
});

describe('programHeaderLine', () => {
  it('writes the line brief section 05 quotes', () => {
    expect(
      programHeaderLine({
        weeks: 12,
        daysPerWeek: 4,
        trainingAgeYears: 5,
        startDate: '2026-09-07',
        endDate: '2026-11-28',
      }),
    ).toBe('12 weeks · 4 days/wk · 4+ yrs · Mon 7 Sep to Sat 28 Nov');
  });

  it('names the sport, because the sport picks the house rules', () => {
    expect(
      programHeaderLine({
        weeks: 12,
        daysPerWeek: 4,
        sport: 'speed_climbing',
        trainingAgeYears: 5,
        startDate: '2026-09-07',
        endDate: '2026-11-28',
      }),
    ).toBe('12 weeks · 4 days/wk · Speed climbing · 4+ yrs · Mon 7 Sep to Sat 28 Nov');
  });

  it('drops the parts that have no answer', () => {
    expect(
      programHeaderLine({
        weeks: 12,
        daysPerWeek: null,
        trainingAgeYears: null,
        startDate: '2026-09-07',
        endDate: '2026-11-28',
      }),
    ).toBe('12 weeks · Mon 7 Sep to Sat 28 Nov');
  });
});

describe('contextTitle', () => {
  it('names the week and the block', () => {
    expect(contextTitle(7, 12, 'Power')).toBe('Week 7 of 12 · Power block');
  });

  it('drops the block when today sits outside the program', () => {
    expect(contextTitle(0, 12, null)).toBe('Week 0 of 12');
  });
});

describe('versionNote', () => {
  it('writes the note brief section 05 quotes', () => {
    expect(versionNote({ version: 2, since: '2026-10-03', reason: 'target date moved' })).toBe(
      'v2 since 3 Oct (target date moved)',
    );
  });

  it('drops an empty reason', () => {
    expect(versionNote({ version: 1, since: '2026-09-07', reason: null })).toBe('v1 since 7 Sep');
  });
});

describe('versionSpan', () => {
  it('reads the weeks and the dates off a stored layout', () => {
    expect(
      versionSpan([
        { w: 1, windowStart: '2026-09-07', windowEnd: '2026-09-13' },
        { w: 2, windowStart: '2026-09-14', windowEnd: '2026-09-20' },
      ]),
    ).toBe('2 weeks, Mon 7 Sep to Sun 20 Sep');
  });

  it('is null when the column holds something else', () => {
    expect(versionSpan(null)).toBeNull();
    expect(versionSpan([])).toBeNull();
  });

  it('still counts the weeks when the dates are missing', () => {
    expect(versionSpan([{ w: 1 }])).toBe('1 week');
  });
});

describe('sportLabel', () => {
  it('writes the sport as a word', () => {
    expect(sportLabel('speed_climbing')).toBe('Speed climbing');
    expect(sportLabel('basketball')).toBe('Basketball');
  });

  it('is absent when there is no sport to name', () => {
    expect(sportLabel(null)).toBeNull();
    expect(sportLabel('none')).toBeNull();
    expect(sportLabel('curling')).toBeNull();
  });
});
