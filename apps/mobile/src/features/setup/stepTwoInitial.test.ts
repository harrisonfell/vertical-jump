import { describe, expect, it } from 'vitest';
import { prefillOwnerIfEmpty } from '@/app/ownerPrefill';
import { getAthlete } from '@/data/store/athlete';
import { openMigratedTestDb } from '@/data/testing/testDb';
import type { Athlete } from '@/data/types';
import { OWNER_STEP_TWO } from './ownerPrefill';
import { defaultTargetLabel, startAndTargetLine } from './startLine';
import { orderWeekdays } from './stepTwoValidation';
import { stepTwoInitial, type StepTwoInitialInput } from './stepTwoInitial';

/**
 * Step 2 opens on the row, or it does not open.
 *
 * The owner's boot write and step 2's first render are two different moments,
 * and the form seeds its fields at the second one. When the row had not
 * arrived yet the screen came up with no weekdays picked and said "Starts Sat
 * 5 Sep · 12 weeks to Fri 27 Nov", counted from the day the owner happened to
 * open it, while the profile in front of them trained Mon, Tue, Wed and Fri.
 * Reading an unread row as an empty one is the whole bug, so the model has a
 * third answer: not ready.
 */

const SATURDAY = '2026-09-05';
const ZONE = 'America/New_York';
/** Mon, Tue, Wed, Fri: the owner's four days. */
const OWNER_DAYS = [1, 2, 3, 5];

/** Everything resolved, nothing on file. Each test names what it changes. */
const RESOLVED: StepTwoInitialInput = {
  athlete: null,
  baseline: null,
  pains: [],
  today: SATURDAY,
  ownerRequested: false,
  settled: true,
};

/** The owner's row, written the way `EXPO_PUBLIC_OWNER=1` writes it at boot. */
async function ownerRow(): Promise<Athlete> {
  const db = await openMigratedTestDb();
  expect(await prefillOwnerIfEmpty(db, SATURDAY, ZONE, true)).toBe(true);
  const athlete = await getAthlete(db);
  await db.closeAsync();
  if (athlete === null) throw new Error('the owner prefill wrote no athlete row');
  return athlete;
}

describe('step 2 opening on the resolved row', () => {
  it('takes the weekdays the row carries, not the ones a blank form has', async () => {
    const initial = stepTwoInitial({ ...RESOLVED, athlete: await ownerRow() });

    expect(initial.ready).toBe(true);
    if (!initial.ready) return;
    expect(initial.values.weekdays).toEqual(OWNER_DAYS);
    expect(initial.values.daysPerWeek).toBe(4);
    expect(initial.sport).toBe('speed_climbing');
    expect(initial.trainingAge).toBe('4plus');
  });

  it('says the start day and the span those weekdays make, from a Saturday', async () => {
    const initial = stepTwoInitial({ ...RESOLVED, athlete: await ownerRow() });
    if (!initial.ready) throw new Error('the resolved row should be ready');

    const picks = orderWeekdays(initial.values.weekdays ?? []);
    expect(
      startAndTargetLine({ today: SATURDAY, weekdays: picks, targetDate: '' }),
    ).toBe('Starts Mon 7 Sep · 12 weeks to Sun 29 Nov');
    expect(defaultTargetLabel(SATURDAY, picks)).toBe('Use Sun 29 Nov');
  });

  it('fills from the saved profile when Settings asked for it', () => {
    const initial = stepTwoInitial({ ...RESOLVED, ownerRequested: true });

    expect(initial.ready).toBe(true);
    if (!initial.ready) return;
    expect(initial.values.weekdays).toEqual(OWNER_STEP_TWO.weekdays);
    expect(initial.values.boxSquatLb).toBe('320');
    expect(initial.values.gymStart).toBe('08:00');
    expect(initial.values.daysPerWeek).toBe(4);
    expect(initial.sport).toBe('speed_climbing');
  });

  it('keeps the step 1 answers on file over the saved profile when both exist', async () => {
    // Settings asked for the profile, then step 1 was saved as three days with
    // no wall: step 2 has to read those, or it says "Pick 4" and checks the
    // picks against a wall the athlete just took off.
    const row: Athlete = {
      ...(await ownerRow()),
      daysPerWeek: 3,
      wallWork: null,
      sport: 'basketball',
    };
    const initial = stepTwoInitial({ ...RESOLVED, athlete: row, ownerRequested: true });

    expect(initial.ready).toBe(true);
    if (!initial.ready) return;
    expect(initial.values.daysPerWeek).toBe(3);
    expect(initial.sport).toBe('basketball');
    expect(initial.wallWork).toBeNull();
    // The rest of the profile still fills the form: that is what was asked for.
    expect(initial.values.weekdays).toEqual(OWNER_STEP_TWO.weekdays);
    expect(initial.values.boxSquatLb).toBe('320');
  });
});

describe('step 2 before the row has arrived', () => {
  it('is not ready while the athlete read is still in flight', () => {
    expect(stepTwoInitial({ ...RESOLVED, athlete: undefined })).toEqual({ ready: false });
  });

  it('is not ready while the baseline test or the pain rows are in flight', () => {
    expect(stepTwoInitial({ ...RESOLVED, baseline: undefined })).toEqual({ ready: false });
    expect(stepTwoInitial({ ...RESOLVED, pains: undefined })).toEqual({ ready: false });
  });

  it('is not ready while the database or the owner boot write is', () => {
    expect(stepTwoInitial({ ...RESOLVED, settled: false })).toEqual({ ready: false });
  });

  it('offers no start line at all on a genuinely empty profile', () => {
    const initial = stepTwoInitial(RESOLVED);

    expect(initial.ready).toBe(true);
    if (!initial.ready) return;
    // Empty is a real answer, and its answer is silence: with no weekday
    // picked there is no day 0 to count from, so the caption says nothing
    // rather than promising a program that starts today.
    expect(initial.values.weekdays).toEqual([]);
    expect(startAndTargetLine({ today: SATURDAY, weekdays: [], targetDate: '' })).toBeNull();
  });
});
