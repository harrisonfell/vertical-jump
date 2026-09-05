import { describe, expect, it } from 'vitest';
import type { SetPrescription } from '@vert/engine';
import { countContacts, footerLeft, footerRight, loadDelta } from './footer';
import type { TodayExercise } from './model';

function exercise(patch: Partial<TodayExercise> = {}): TodayExercise {
  return {
    id: 'ex-1',
    exerciseId: 'depth_jump',
    name: 'Depth jump',
    block: 'power',
    loadType: 'bodyweight',
    loadMode: 'none',
    bothSides: false,
    rotationNote: null,
    headerNote: null,
    lastTimeNote: null,
    isNewThisWeek: false,
    restS: 180,
    restRule: 'maximal plyometrics',
    sets: [prescription(1), prescription(2)],
    landingPromptOnLastSet: true,
    contactsPerRep: 2,
    cues: [],
    boxHeightIn: 18,
    ladderId: 'depth_jump_height',
    captions: [],
    repCounted: false,
    rowNote: null,
    ...patch,
  };
}

function prescription(setNumber: number): SetPrescription {
  return {
    setNumber,
    reps: 2,
    displayLoad: '2 × BW',
    restS: 180,
    restRule: 'maximal plyometrics',
    isRamp: false,
    isHeld: false,
  };
}

describe('countContacts', () => {
  it('counts two contacts a rep on a depth jump', () => {
    const logs = new Map([['ex-1', new Map([[1, 2]])]]);
    expect(countContacts([exercise()], logs)).toEqual({ total: 4, highIntensity: 4 });
  });

  it('counts nothing for a row the engine put off the budget', () => {
    const logs = new Map([['ex-1', new Map([[1, 8]])]]);
    expect(countContacts([exercise({ contactsPerRep: 0 })], logs)).toEqual({
      total: 0,
      highIntensity: 0,
    });
  });

  it('counts a single-contact jump outside the power block as extensive only', () => {
    const logs = new Map([['ex-1', new Map([[1, 5]])]]);
    const primer = exercise({ block: 'primer', contactsPerRep: 1 });
    expect(countContacts([primer], logs)).toEqual({ total: 5, highIntensity: 0 });
  });

  it('ignores a set with no logged reps', () => {
    expect(countContacts([exercise()], new Map())).toEqual({ total: 0, highIntensity: 0 });
  });
});

describe('footerLeft', () => {
  it('reads sets alone on a day with no contacts', () => {
    const line = footerLeft({
      setsLogged: 2,
      setsPlanned: 22,
      contacts: null,
      tally: { total: 0, highIntensity: 0 },
    });
    expect(line).toBe('Sets 2 of 22');
  });

  it('names the high-intensity cap on a jump day', () => {
    const line = footerLeft({
      setsLogged: 12,
      setsPlanned: 18,
      contacts: { extensive: 112, highIntensity: 21, targetExtensive: 120, capHigh: 25 },
      tally: { total: 60, highIntensity: 21 },
    });
    expect(line).toBe('Sets 12 of 18 · contacts 60 of 120 · high-intensity 21 of 25');
  });
});

describe('footerRight', () => {
  it('counts down to the next test', () => {
    expect(footerRight({ weekday: 'Sat', inDays: 5, isToday: false, done: false })).toBe(
      'Test Sat · in 5 days',
    );
  });

  it('uses the singular on the eve', () => {
    expect(footerRight({ weekday: 'Sat', inDays: 1, isToday: false, done: false })).toBe(
      'Test Sat · in 1 day',
    );
  });

  it('says today on the test day', () => {
    expect(footerRight({ weekday: 'Thu', inDays: 0, isToday: true, done: false })).toBe(
      'Test today',
    );
  });

  it('says logged once it is written', () => {
    expect(footerRight({ weekday: 'Thu', inDays: 0, isToday: true, done: true })).toBe(
      'Test logged',
    );
  });
});

describe('loadDelta', () => {
  it('shows a step up in pounds', () => {
    expect(loadDelta(93, 100)).toBe(' (+15 lb)');
  });

  it('shows a drop with a real minus sign', () => {
    expect(loadDelta(100, 93)).toBe(' (−15 lb)');
  });

  it('says nothing when the load is held', () => {
    expect(loadDelta(100, 100)).toBe('');
    expect(loadDelta(undefined, 100)).toBe('');
  });
});
