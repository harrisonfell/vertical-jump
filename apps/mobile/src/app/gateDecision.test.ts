import { describe, expect, it } from 'vitest';
import {
  decideGate,
  gateRedirect,
  profileComplete,
  readClearance,
  stepOneComplete,
  type GateAthlete,
  type GateInput,
} from './gateDecision';

const CLEARED = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
  attestedAt: '2026-09-07',
};

const FULL: GateAthlete = {
  clearance: CLEARED,
  sport: null,
  daysPerWeek: 4,
  weekdays: [1, 2, 4, 6],
  goalHeightMm: 914,
  targetDate: '2026-11-29',
};

function input(patch: Partial<GateInput> = {}): GateInput {
  return {
    dbStatus: 'ready',
    athleteLoaded: true,
    programLoaded: true,
    athlete: FULL,
    hasProgram: true,
    ...patch,
  };
}

describe('readClearance', () => {
  it('reads the seven questions plus the clinician note', () => {
    expect(readClearance(CLEARED)).toEqual({
      answered: true,
      failed: false,
      clearedByClinician: false,
    });
    expect(readClearance({ ...CLEARED, chestPain: true })).toMatchObject({ failed: true });
    expect(
      readClearance({ ...CLEARED, chestPain: true, clearedByClinicianAt: '2026-09-20' }),
    ).toMatchObject({ failed: true, clearedByClinician: true });
  });

  it('treats a redFlags list as a failure and unanswered as unanswered', () => {
    expect(readClearance({ attestedAt: '2026-09-07', redFlags: ['chestPain'] })).toMatchObject({
      answered: true,
      failed: true,
    });
    expect(readClearance({})).toEqual({
      answered: false,
      failed: false,
      clearedByClinician: false,
    });
    expect(readClearance(null)).toMatchObject({ answered: false });
    expect(readClearance('nonsense')).toMatchObject({ answered: false });
    expect(readClearance({ attestedAt: '   ' })).toMatchObject({ answered: false });
  });
});

describe('profileComplete', () => {
  it('needs days, weekdays, a goal height and a target date', () => {
    expect(profileComplete(FULL)).toBe(true);
    expect(profileComplete({ ...FULL, daysPerWeek: null })).toBe(false);
    expect(profileComplete({ ...FULL, weekdays: [] })).toBe(false);
    expect(profileComplete({ ...FULL, goalHeightMm: null })).toBe(false);
    expect(profileComplete({ ...FULL, targetDate: null })).toBe(false);
  });
});

describe('stepOneComplete', () => {
  it('needs the sport and the days a week step 1 writes', () => {
    expect(stepOneComplete(FULL)).toBe(false);
    expect(stepOneComplete({ ...FULL, sport: 'speed_climbing' })).toBe(true);
    expect(stepOneComplete({ ...FULL, sport: 'speed_climbing', daysPerWeek: null })).toBe(false);
  });
});

describe('decideGate', () => {
  it('never leaves the tabs while the database is still opening', () => {
    expect(decideGate(input({ dbStatus: 'opening', athlete: null, hasProgram: false }))).toBe(
      'loading',
    );
    expect(decideGate(input({ athleteLoaded: false, athlete: null, hasProgram: false }))).toBe(
      'loading',
    );
    expect(decideGate(input({ programLoaded: false, hasProgram: false }))).toBe('loading');
  });

  it('reports a database that failed to open', () => {
    expect(decideGate(input({ dbStatus: 'error' }))).toBe('error');
  });

  it('sends a first run to the self-screen', () => {
    expect(decideGate(input({ athlete: null, hasProgram: false }))).toBe('setupGate');
    expect(
      decideGate(input({ athlete: { ...FULL, clearance: {} }, hasProgram: false })),
    ).toBe('setupGate');
  });

  it('sends a failed self-screen to clearance until a clinician clears it', () => {
    const failed = { ...CLEARED, boneOrJointProblem: true };
    expect(decideGate(input({ athlete: { ...FULL, clearance: failed } }))).toBe('clearance');
    expect(
      decideGate(
        input({
          athlete: { ...FULL, clearance: { ...failed, clearedByClinicianAt: '2026-09-20' } },
        }),
      ),
    ).toBe('ready');
  });

  it('splits no-program between the questions and the builder', () => {
    expect(decideGate(input({ hasProgram: false }))).toBe('setupBuild');
    expect(
      decideGate(input({ hasProgram: false, athlete: { ...FULL, goalHeightMm: null } })),
    ).toBe('setupOne');
  });

  it('sends a profile that has been through step 1 to step 2, not back to step 1', () => {
    // The owner's saved profile: every step 1 answer on file, the baseline and
    // the goal still to type.
    const prefilled: GateAthlete = {
      ...FULL,
      sport: 'speed_climbing',
      goalHeightMm: null,
      targetDate: null,
    };
    expect(decideGate(input({ hasProgram: false, athlete: prefilled }))).toBe('setupTwo');
  });

  it('waits while the owner prefill is still being written', () => {
    expect(
      decideGate(input({ hasProgram: false, athlete: null, prefillSettled: false })),
    ).toBe('loading');
  });

  it('renders the tabs once a program exists', () => {
    expect(decideGate(input())).toBe('ready');
  });
});

describe('gateRedirect', () => {
  it('maps every leaving state to a route and keeps the rest in place', () => {
    expect(gateRedirect('setupGate')).toBe('/setup/gate');
    expect(gateRedirect('clearance')).toBe('/clearance');
    expect(gateRedirect('setupOne')).toBe('/setup/one');
    expect(gateRedirect('setupTwo')).toBe('/setup/two');
    expect(gateRedirect('setupBuild')).toBe('/setup/build');
    expect(gateRedirect('ready')).toBeNull();
    expect(gateRedirect('loading')).toBeNull();
    expect(gateRedirect('error')).toBeNull();
  });
});
