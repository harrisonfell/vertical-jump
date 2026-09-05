import { describe, expect, it } from 'vitest';
import type { SetPrescription } from '@vert/engine';
import { advanceLadder, advanceLadders, doneSummaryLine, notFinishedLine } from './finish';
import { nextSetLabel, restBarApplies, restSecondsFor } from './rest';
import type { TodayExercise } from './model';

const state = { rung: 3, advancesThisBlock: 0 };

describe('advanceLadder', () => {
  it('takes a rung on a load week when every landing was good', () => {
    expect(advanceLadder(state, ['good', 'good'], 'load')).toEqual({
      rung: 4,
      advancesThisBlock: 1,
    });
  });

  it('accepts OK landings', () => {
    expect(advanceLadder(state, ['good', 'ok'], 'load').rung).toBe(4);
  });

  it('holds the rung on a poor landing', () => {
    expect(advanceLadder(state, ['good', 'poor'], 'load')).toEqual(state);
  });

  it('holds every rung in a reduced week', () => {
    expect(advanceLadder(state, ['good'], 'deload')).toEqual(state);
    expect(advanceLadder(state, ['good'], 'taper')).toEqual(state);
  });

  it('stops at two rungs inside one block', () => {
    expect(advanceLadder({ rung: 5, advancesThisBlock: 2 }, ['good'], 'load')).toEqual({
      rung: 5,
      advancesThisBlock: 2,
    });
  });

  it('does nothing when the week rated no landings', () => {
    expect(advanceLadder(state, [], 'load')).toEqual(state);
  });
});

describe('advanceLadders', () => {
  it('decides each ladder on its own landings', () => {
    const next = advanceLadders(
      { box_jump_height: state, depth_jump_height: state },
      { box_jump_height: ['good'], depth_jump_height: ['poor'] },
      'load',
    );
    expect(next['box_jump_height']?.rung).toBe(4);
    expect(next['depth_jump_height']?.rung).toBe(3);
  });

  it('starts a ladder it has never seen at rung 0', () => {
    const next = advanceLadders({}, { hurdle_height: ['good'] }, 'load');
    expect(next['hurdle_height']).toEqual({ rung: 1, advancesThisBlock: 1 });
  });
});

describe('summary lines', () => {
  it('reads sets, minutes, contacts, tonnage, and RPE', () => {
    expect(
      doneSummaryLine({
        setsLogged: 18,
        setsPlanned: 18,
        minutes: 74,
        contacts: 112,
        tonnageKg: 1000,
        sessionRpe: 8,
      }),
    ).toBe('18 of 18 sets · 74 min · 112 contacts · 2,205 lb · RPE 8');
  });

  it('drops what was not recorded', () => {
    expect(
      doneSummaryLine({
        setsLogged: 7,
        setsPlanned: 18,
        minutes: null,
        contacts: 0,
        tonnageKg: 0,
        sessionRpe: null,
      }),
    ).toBe('7 of 18 sets');
  });

  it('says what an unfinished session counts as', () => {
    expect(notFinishedLine(7, 18, false, 8)).toBe(
      'Not finished · 7/18 sets · counts as missed unless you finish it',
    );
  });

  it('changes its wording once the next week is built', () => {
    expect(notFinishedLine(7, 18, true, 8)).toBe(
      'Finished after week 8 was built · counts in the ledger, week 8 unchanged',
    );
  });
});

function set(setNumber: number, loadKg?: number): SetPrescription {
  return {
    setNumber,
    reps: 5,
    displayLoad: loadKg === undefined ? '5 × BW' : `5 × ${Math.round(loadKg * 2.20462)} lb`,
    restS: 180,
    restRule: 'heavy strength',
    isRamp: false,
    isHeld: false,
    ...(loadKg === undefined ? null : { loadKg }),
  };
}

function exercise(patch: Partial<TodayExercise> = {}): TodayExercise {
  return {
    id: 'ex',
    exerciseId: 'back_squat',
    name: 'Back squat',
    block: 'main_lift',
    loadType: 'heavy_strength',
    loadMode: 'epley',
    bothSides: false,
    rotationNote: null,
    headerNote: null,
    lastTimeNote: null,
    isNewThisWeek: false,
    restS: 180,
    restRule: 'heavy strength',
    sets: [set(1, 93), set(2, 100)],
    landingPromptOnLastSet: false,
    contactsPerRep: 0,
    cues: [],
    boxHeightIn: null,
    ladderId: null,
    captions: [],
    repCounted: false,
    rowNote: null,
    ...patch,
  };
}

describe('rest bar text', () => {
  it('names the next set and the step up', () => {
    expect(nextSetLabel({ next: set(2, 100), previous: set(1, 93) })).toBe(
      'next: set 2 · 5 × 220 lb (+15 lb)',
    );
  });

  it('names the next exercise once the last set is logged', () => {
    expect(
      nextSetLabel({ next: null, previous: set(2, 100), nextExerciseName: 'Hurdle hop' }),
    ).toBe('next: Hurdle hop');
  });

  it('says so when nothing follows', () => {
    expect(nextSetLabel({ next: null, previous: set(2, 100) })).toBe('last set');
  });

  it('labels a ramp set as one', () => {
    const ramp: SetPrescription = { ...set(1, 70), isRamp: true };
    expect(nextSetLabel({ next: ramp, previous: null })).toContain('ramp set 1');
  });
});

describe('rest bar applies', () => {
  it('runs on a lift', () => {
    expect(restBarApplies(exercise())).toBe(true);
    expect(restSecondsFor(exercise(), set(1, 93))).toBe(180);
  });

  it('never runs on a mobility row', () => {
    expect(restBarApplies(exercise({ loadType: 'mobility' }))).toBe(false);
  });

  it('never runs inside the warm-up or the recovery block', () => {
    expect(restBarApplies(exercise({ block: 'warm_up' }))).toBe(false);
    expect(restBarApplies(exercise({ block: 'recovery' }))).toBe(false);
  });
});
