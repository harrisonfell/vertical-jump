import { describe, expect, it } from 'vitest';
import { buildEngineFixture } from '../../data/fixtures/fromEngine';
import type { SessionExercise } from '../../data/types';
import { buildTodaySession, flattenExercises, plannedSetCount } from './model';

/**
 * The merge, run against the engine's own owner fixture rather than a hand
 * written stub, so a change in the generator's block names or per-set shape
 * fails here rather than on the screen.
 */

// The basketball owner, on purpose: these assert the runner's merge machinery
// against depth jumps and shuttles, which is a basketball week. The app itself
// now boots the climbing owner (EXPO_PUBLIC_FIXTURE=1); "basketball" is the
// same fixture this file has always read.
const fixture = buildEngineFixture('2026-10-22', 'UTC', 'basketball');

function rowsFor(sessionKey: string): SessionExercise[] {
  const session = fixture.sessions.find((entry) => entry.key === sessionKey);
  if (session === undefined) throw new Error(`no fixture session ${sessionKey}`);
  return session.exercises.map((exercise) => ({
    id: exercise.key,
    sessionId: session.key,
    orderIndex: exercise.orderIndex,
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    block: exercise.block ?? null,
    loadType: exercise.loadType,
    loadMode: exercise.loadMode ?? 'entered',
    bothSides: exercise.bothSides ?? false,
    rotationNote: exercise.rotationNote ?? null,
    headerNote: exercise.headerNote ?? null,
    lastTimeNote: exercise.lastTimeNote ?? null,
    isNewThisWeek: exercise.isNewThisWeek ?? false,
    restS: exercise.restS ?? null,
    restRule: exercise.restRule ?? null,
    perSet: exercise.perSet,
  }));
}

function snapshotFor(sessionKey: string): unknown {
  return fixture.sessions.find((entry) => entry.key === sessionKey)?.snapshot;
}

describe('buildTodaySession, week 7 Power + Speed', () => {
  const key = 'w7-d2';
  const session = buildTodaySession(rowsFor(key), snapshotFor(key));

  it('keeps the engine block order', () => {
    expect(session.blocks.map((block) => block.name)).toEqual([
      'warm_up',
      'primer',
      'jump_test',
      'power',
      'cod',
      'accessory',
      'cool_down',
    ]);
  });

  it('groups only the warm-up and the cool-down', () => {
    const grouped = session.blocks.filter((block) => block.grouped).map((block) => block.name);
    expect(grouped).toEqual(['warm_up', 'cool_down']);
  });

  it('names the blocks the way section 13 does', () => {
    const labels = Object.fromEntries(session.blocks.map((block) => [block.name, block.label]));
    expect(labels['jump_test']).toBe('Jump test');
    expect(labels['cod']).toBe('COD');
  });

  it('is the test day and carries its suffix', () => {
    expect(session.isTestDay).toBe(true);
    expect(session.headerSuffixes).toContain('· Test day');
  });

  it('carries the contacts the footer counts against', () => {
    expect(session.contacts?.capHigh).toBe(25);
    expect(session.contacts?.highIntensity).toBeGreaterThan(0);
    expect(session.contacts?.targetExtensive).toBeGreaterThan(0);
  });

  it('recovers the landing prompt and the depth jump box height', () => {
    const depth = flattenExercises(session).find((entry) => entry.exerciseId === 'depth_jump');
    expect(depth?.landingPromptOnLastSet).toBe(true);
    expect(depth?.contactsPerRep).toBe(2);
    expect(depth?.boxHeightIn).toBeGreaterThan(0);
  });

  it('counts every prescribed set once', () => {
    const bySets = flattenExercises(session).reduce((sum, e) => sum + e.sets.length, 0);
    expect(plannedSetCount(session)).toBe(bySets);
    expect(bySets).toBeGreaterThan(20);
  });
});

describe('soreness applies one tier down before the first tap', () => {
  const key = 'w7-d0';

  it('leaves the session alone under the threshold', () => {
    const plain = buildTodaySession(rowsFor(key), snapshotFor(key), { sorenessPre: 3 });
    const squat = flattenExercises(plain).find((entry) => entry.exerciseId === 'back_squat');
    expect(squat?.sets[0]?.original).toBeUndefined();
  });

  it('adds reps, cuts the load, and keeps the original on every row', () => {
    const sore = buildTodaySession(rowsFor(key), snapshotFor(key), { sorenessPre: 8 });
    const squat = flattenExercises(sore).find((entry) => entry.exerciseId === 'back_squat');
    const first = squat?.sets[0];
    expect(first?.original).toBeDefined();
    expect(first?.reps).toBe((first?.original?.reps ?? 0) + 2);
    expect(first?.loadPercent).toBeLessThan(first?.original?.loadPercent ?? 0);
  });
});

describe('a session with no snapshot still runs', () => {
  it('falls back to the canonical block order', () => {
    const session = buildTodaySession(rowsFor('w7-d0'), null);
    expect(session.blocks[0]?.name).toBe('warm_up');
    expect(session.contacts).toBeNull();
    expect(session.notices).toEqual([]);
  });
});
