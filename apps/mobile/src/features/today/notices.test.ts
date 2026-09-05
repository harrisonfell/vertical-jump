import { describe, expect, it } from 'vitest';
import {
  TEST_MISSED_LINE,
  isSoreEnough,
  repeatNotice,
  sorenessNotices,
  testMovedFrom,
} from './notices';

describe('isSoreEnough', () => {
  it('fires at 7 and not at 6', () => {
    expect(isSoreEnough(6)).toBe(false);
    expect(isSoreEnough(7)).toBe(true);
    expect(isSoreEnough(null)).toBe(false);
  });
});

describe('sorenessNotices', () => {
  it('says nothing below the threshold', () => {
    expect(sorenessNotices({ sorenessPre: 3, isTestDay: false, today: '2026-10-22' })).toEqual([]);
  });

  it('names the reduction in the engine wording', () => {
    const notices = sorenessNotices({ sorenessPre: 8, isTestDay: false, today: '2026-10-22' });
    expect(notices).toEqual([
      'Soreness 8/10. Today one tier down: reps up, loads −10%, no depth jumps.',
    ]);
  });

  it('moves a scheduled test onto the next SCHEDULED session, not simply tomorrow', () => {
    const notices = sorenessNotices({
      sorenessPre: 9,
      isTestDay: true,
      today: '2026-10-22',
      // Thu is today; the week trains Mon/Tue/Thu/Sat, so the test rides Saturday.
      weekSessions: [{ scheduledDate: '2026-10-22' }, { scheduledDate: '2026-10-24' }],
    });
    expect(notices).toHaveLength(2);
    expect(notices[1]).toBe('Test moved to Sat (soreness).');
  });

  it('says the test is missed when the week has no session left', () => {
    const notices = sorenessNotices({
      sorenessPre: 9,
      isTestDay: true,
      today: '2026-10-24',
      weekSessions: [{ scheduledDate: '2026-10-24' }],
    });
    expect(notices[1]).toBe(TEST_MISSED_LINE);
  });
});

describe('repeatNotice', () => {
  it('names the week being repeated', () => {
    expect(repeatNotice(7)).toBe('Repeat of week 7: same loads, same sets.');
  });

  it('says nothing on an ordinary week', () => {
    expect(repeatNotice(null)).toBeNull();
  });
});

describe('testMovedFrom', () => {
  const sessions = [
    { scheduledDate: '2026-10-17', testStatus: 'deferred' },
    { scheduledDate: '2026-10-19', testStatus: null },
    { scheduledDate: '2026-10-22', testStatus: 'planned' },
  ];

  it('names the day the test came from', () => {
    expect(testMovedFrom(sessions, '2026-10-22')).toBe('Sat');
  });

  it('says nothing when no test was deferred', () => {
    expect(testMovedFrom([{ scheduledDate: '2026-10-19', testStatus: null }], '2026-10-22')).toBeNull();
  });
});
