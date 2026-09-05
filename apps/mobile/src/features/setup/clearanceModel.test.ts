import { describe, expect, it } from 'vitest';
import type { Athlete, PainStatus } from '@/data';
import {
  clearanceScreenFor,
  hasLowerLimbPain,
  hasSeverePain,
  nextSetupRoute,
  painGateFor,
} from './clearanceModel';

const TODAY = '2026-09-04';

const CLEAR = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
  attestedAt: TODAY,
};

function athlete(patch: Partial<Athlete> = {}): Athlete {
  return {
    id: 'athlete_owner',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: CLEAR,
    inventory: null,
    weightRoomAccess: true,
    bodyweightKg: 82,
    workingMax: {},
    inSeason: false,
    readinessPassedAt: null,
    standingReachMm: null,
    goalHeightMm: 914,
    targetDate: '2026-11-29',
    timezone: 'America/New_York',
    rolloverHour: 3,
    testConditionsNote: null,
    createdAt: `${TODAY}T00:00:00.000Z`,
    updatedAt: `${TODAY}T00:00:00.000Z`,
    ...patch,
  };
}

function pain(patch: Partial<PainStatus> = {}): PainStatus {
  return {
    id: 'pain_1',
    athleteId: 'athlete_owner',
    location: 'knee',
    severityRaw: 5,
    severityDerived: 'severe',
    onset: 'acute',
    durationWeeks: null,
    houseRule: false,
    note: null,
    reportedAt: `${TODAY}T00:00:00.000Z`,
    reassessDueAt: '2026-09-18',
    clearedAt: null,
    ...patch,
  };
}

describe('the clearance decision table', () => {
  it('shows nothing when the screen is clean and there is no pain', () => {
    expect(clearanceScreenFor({ athlete: athlete(), pains: [], today: TODAY })).toBeNull();
  });

  it('shows the self-screen sentence on any yes, and blocks generation', () => {
    const failed = athlete({ clearance: { ...CLEAR, chestPain: true } });
    const result = painGateFor({ athlete: failed, pains: [], today: TODAY });
    expect(result.blocksGeneration).toBe(true);
    expect(result.clearanceScreen?.kind).toBe('self_screen');
    expect(result.clearanceScreen?.sentence).toBe(
      'Medical clearance needed. You answered yes to a screening question. No program is built until a clinician clears you.',
    );
  });

  it('stops blocking once a clinician date is on file', () => {
    const cleared = athlete({
      clearance: { ...CLEAR, boneOrJointProblem: true, clearedByClinicianAt: '2026-09-02' },
    });
    const result = painGateFor({ athlete: cleared, pains: [], today: TODAY });
    expect(result.blocksGeneration).toBe(false);
    expect(result.clearanceScreen).toBeNull();
  });

  it('shows the per-location sentence at 5+, and never blocks generation', () => {
    const result = painGateFor({ athlete: athlete(), pains: [pain()], today: TODAY });
    expect(result.blocksGeneration).toBe(false);
    expect(result.clearanceScreen?.kind).toBe('severe_pain');
    expect(result.clearanceScreen?.sentence).toBe(
      'Medical clearance needed. You reported knee pain at 5+ (limits training). The rule book excludes all knee-stress lifts and all jumps at this level, including the weekly test. Get it assessed.',
    );
    expect(result.restricted).toBe(true);
  });

  it('names the house rule for a site the rule book is silent on', () => {
    const result = painGateFor({
      athlete: athlete(),
      pains: [pain({ location: 'hip', severityRaw: 3, severityDerived: 'moderate' })],
      today: TODAY,
    });
    expect(result.clearanceScreen).toBeNull();
    expect(result.houseRule).toBeDefined();
    expect(result.restricted).toBe(true);
  });

  it('lets the self-screen win when both apply', () => {
    const failed = athlete({ clearance: { ...CLEAR, dizziness: true } });
    const screen = clearanceScreenFor({ athlete: failed, pains: [pain()], today: TODAY });
    expect(screen?.kind).toBe('self_screen');
  });

  it('treats an unanswered athlete as clean rather than failing', () => {
    expect(clearanceScreenFor({ athlete: null, pains: [], today: TODAY })).toBeNull();
  });
});

describe('pain readings the screens branch on', () => {
  it('sees a severe open site', () => {
    expect(hasSeverePain([pain()])).toBe(true);
    expect(hasSeverePain([pain({ clearedAt: `${TODAY}T01:00:00.000Z` })])).toBe(false);
    expect(hasSeverePain([pain({ severityDerived: 'moderate' })])).toBe(false);
  });

  it('sees a lower-limb site, which keeps depth jumps off', () => {
    expect(hasLowerLimbPain([pain({ location: 'achilles_calf' })])).toBe(true);
    expect(hasLowerLimbPain([pain({ location: 'shoulder' })])).toBe(false);
  });
});

describe('nextSetupRoute', () => {
  it('starts at the gate with no athlete', () => {
    expect(nextSetupRoute(null, false)).toBe('/setup/gate');
  });

  it('goes to step 1 until the five answers are in', () => {
    expect(nextSetupRoute(athlete({ daysPerWeek: null }), false)).toBe('/setup/one');
  });

  it('goes to step 2 until the jump inputs are in', () => {
    expect(nextSetupRoute(athlete({ targetDate: null }), false)).toBe('/setup/two');
    expect(nextSetupRoute(athlete({ weekdays: [] }), false)).toBe('/setup/two');
  });

  it('goes to build with a complete profile and no program', () => {
    expect(nextSetupRoute(athlete(), false)).toBe('/setup/build');
  });

  it('goes to Today once a program exists', () => {
    expect(nextSetupRoute(athlete(), true)).toBe('/');
  });
});
