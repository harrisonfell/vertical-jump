/**
 * Rest under R164: one displayed value, the longest applicable rule, with the
 * brief's bounds (main lifts and maximal jumps at the top of the set band,
 * sprints 180 s, accessories 120 s, prehab and mobility 60 s).
 */
import { describe, expect, it } from 'vitest';
import { formatRest } from '../units.js';
import { estimateSessionMinutes, resolveRest, restFor } from './rest.js';
import { RULES, makeExercise } from './prescribe.fixtures.test.js';

const backSquat = makeExercise({ id: 'back_squat', name: 'Back squat' });

const depthJump = makeExercise({
  id: 'depth_jump',
  loadType: 'bodyweight',
  loadable: false,
  requiresBarbell: false,
  equipment: ['box'],
  movementPattern: 'jump',
  isAxialLoad: false,
  isMainLift: false,
  roleCandidates: ['power_jump'],
  plyometric: {
    contactTime: 'fast',
    amplitude: 'high',
    intensity: 'high',
    category: 'intensive',
    contactsPerRep: 2,
    isMaximalJump: true,
  },
});

const pogo = makeExercise({
  id: 'pogo',
  loadType: 'bodyweight',
  loadable: false,
  requiresBarbell: false,
  equipment: [],
  movementPattern: 'jump',
  isAxialLoad: false,
  isMainLift: false,
  fatigueCost: 'moderate',
  roleCandidates: ['primer'],
  plyometric: {
    contactTime: 'fast',
    amplitude: 'low',
    intensity: 'low',
    category: 'extensive',
    contactsPerRep: 1,
    isMaximalJump: false,
  },
});

const shuttle = makeExercise({
  id: 'shuttle_5_10_5',
  loadType: 'bodyweight',
  loadable: false,
  displayMode: 'distance',
  requiresBarbell: false,
  equipment: [],
  movementPattern: 'cod',
  isAxialLoad: false,
  isMainLift: false,
  fatigueCost: 'moderate',
  roleCandidates: ['cod'],
  codCutsPerRep: 2,
  sprintDistanceM: 20,
});

const dbRow = makeExercise({
  id: 'db_row',
  loadType: 'hypertrophy',
  requiresBarbell: false,
  equipment: ['dumbbell'],
  movementPattern: 'pull_horizontal',
  isAxialLoad: false,
  isPull: true,
  isMainLift: false,
  fatigueCost: 'moderate',
  roleCandidates: ['accessory'],
});

const calfIso = makeExercise({
  id: 'calf_iso',
  loadType: 'prehab',
  loadable: false,
  displayMode: 'time',
  requiresBarbell: false,
  equipment: [],
  isAxialLoad: false,
  isMainLift: false,
  cnsCost: 'low',
  fatigueCost: 'low',
  roleCandidates: ['injury_prevention'],
});

describe('resolveRest (R69 to R71, R77, R88, R104, R164)', () => {
  it('a main lift takes the top of its set band', () => {
    expect(resolveRest(backSquat, 'main_lift', 2, RULES).restS).toBe(150);
    expect(resolveRest(backSquat, 'main_lift', 3, RULES).restS).toBe(150);
    expect(resolveRest(backSquat, 'main_lift', 4, RULES).restS).toBe(180);
    expect(resolveRest(backSquat, 'main_lift', 5, RULES).restS).toBe(180);
    expect(resolveRest(backSquat, 'main_lift', 6, RULES).restS).toBe(240);
    expect(resolveRest(backSquat, 'main_lift', 7, RULES).restS).toBe(240);
  });

  it('names the winning rules the way the Plan summary reads them', () => {
    expect(restFor(backSquat, 4, { role: 'main_lift', ruleset: RULES })).toEqual({
      restS: 180,
      restRule: 'R70+R164',
    });
    expect(resolveRest(backSquat, 'main_lift', 4, RULES).restRule).toBe(
      '4 sets of a main or secondary lift',
    );
    expect(formatRest(180)).toBe('3:00');
  });

  it('maximal jumps rest 180 s whatever the set count (R88)', () => {
    expect(resolveRest(depthJump, 'power_jump', 3, RULES).restS).toBe(180);
    expect(resolveRest(depthJump, 'power_jump', 2, RULES).considered[0]?.rule).toBe('maximal jumps');
  });

  it('sprints and change of direction reps rest 180 s (R104)', () => {
    expect(resolveRest(shuttle, 'cod', 4, RULES).restS).toBe(180);
    expect(restFor(shuttle, 4, { role: 'cod', ruleset: RULES }).restRule).toContain('R104');
  });

  it('extensive drills rest 120 s', () => {
    expect(resolveRest(pogo, 'primer', 4, RULES).restS).toBe(120);
  });

  it('accessories and hypertrophy rest 120 s', () => {
    expect(resolveRest(dbRow, 'accessory', 4, RULES).restS).toBe(120);
    expect(resolveRest(dbRow, 'secondary', 4, RULES).restS).toBe(180);
  });

  it('prehab and mobility rest 60 s', () => {
    expect(resolveRest(calfIso, 'injury_prevention', 3, RULES).restS).toBe(60);
  });

  it('R77 lifts a low-rest row to 120 s when fatigue cost is high', () => {
    const heavyCarry = makeExercise({
      id: 'farmer_carry',
      loadType: 'endurance',
      requiresBarbell: false,
      equipment: ['dumbbell'],
      isAxialLoad: false,
      isMainLift: false,
      fatigueCost: 'high',
      roleCandidates: ['conditioning'],
    });
    const decision = resolveRest(heavyCarry, 'conditioning', 3, RULES);
    expect(decision.restS).toBe(120);
    expect(decision.considered.some((entry) => entry.rule === 'high fatigue cost')).toBe(true);
  });

  it('the longest rule wins and every rule considered is reported', () => {
    const decision = resolveRest(depthJump, 'power_jump', 4, RULES);
    expect(decision.considered.map((entry) => entry.restS)).toEqual([180, 180, 120]);
    expect(decision.restS).toBe(180);
  });
});

describe('estimateSessionMinutes', () => {
  it('counts work plus the rests between sets, never after the last set', () => {
    expect(
      estimateSessionMinutes([
        { sets: 4, restS: 180, workSecondsPerSet: 30 },
        { sets: 3, restS: 120, workSecondsPerSet: 40 },
      ]),
    ).toBe(17);
    expect(estimateSessionMinutes([])).toBe(0);
    expect(estimateSessionMinutes([{ sets: 1, restS: 180, workSecondsPerSet: 60 }])).toBe(1);
  });
});
