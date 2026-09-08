/**
 * The tendon row: heavy slow resistance at bodyweight, with a dumbbell the
 * athlete may add.
 *
 * Prehab is unloaded as a load type, and reading it that way left the heavy
 * slow calf raise a bare "8 x BW": no tempo, and nowhere to record a weight if
 * one is in the hand, so the load could never climb. The row now states the
 * tempo and offers the load without demanding it, because a bodyweight calf
 * raise is a complete set and is where the row starts.
 *
 * Every other prehab row is untouched here, which is the other half of the
 * contract: an isometric hold is still a hold.
 */
import { describe, expect, it } from 'vitest';
import { indexById, loadExercises } from '../src/exercises/index.js';
import { getPerSetPrescription } from '../src/prescribe/index.js';
import { bestEpley } from '../src/prescribe/workingMax.js';
import { lbToKg } from '../src/units.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { RULESET_V1 } from '../src/ruleset/index.js';
import {
  makeAthlete,
  makeContext,
  displays,
} from '../src/prescribe/prescribe.fixtures.test.js';
import { PROGRAM_START, WEEKDAYS, baseAthlete, gridRuleset, gridSeed } from './grid.support.js';
import type { Athlete } from '../src/types/athlete.js';
import type { Exercise } from '../src/types/exercise.js';
import type { SetLog } from '../src/types/logs.js';
import type { MaterializeHistory, WeekPlan } from '../src/types/plan.js';

const { exercises } = loadExercises();
const byId = indexById(exercises);

function exercise(id: string): Exercise {
  const found = byId.get(id);
  if (found === undefined) throw new RangeError(`no seeded exercise ${id}`);
  return found;
}

const calfRaise = exercise('heavy_slow_calf_raise');

/** One materialized week off the shared grid athlete, for the row the runner sees. */
function workedWeek(): WeekPlan {
  const athlete: Athlete = {
    ...baseAthlete(),
    level: 'intermediate',
    daysPerWeek: 4,
    weekdays: WEEKDAYS[4],
    targetDate: '2026-11-29',
  };
  const history: MaterializeHistory = {
    rotationHistory: {},
    ladderState: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
  const skeleton = planSkeleton(athlete, PROGRAM_START, gridRuleset);
  return materializeWeek({
    athlete,
    ruleset: gridRuleset,
    exercises: gridSeed.exercises,
    ladders: gridSeed.ladders,
    skeleton,
    w: 2,
    workingMaxes: athlete.workingMaxes ?? [],
    history,
    today: PROGRAM_START,
    seed: 1,
  });
}

describe('the heavy slow calf raise', () => {
  it('is seeded as the loadable slow-resistance tendon row', () => {
    // If any of these three move, the row stops being the loaded one and the
    // whole branch below goes quiet, so they are pinned here rather than
    // assumed.
    expect(calfRaise.loadable).toBe(true);
    expect(calfRaise.tendonMode).toBe('slow_resistance');
    expect(calfRaise.loadType).toBe('prehab');
  });

  it('reads as bodyweight with a weight the athlete may add', () => {
    const sets = getPerSetPrescription(calfRaise, makeAthlete('intermediate'), makeContext({ sets: 2 }));
    expect(displays(sets)).toEqual(['8 × BW · RPE 8 · + __ lb', '8 × BW · RPE 8 · + __ lb']);
    expect(sets.every((set) => set.loadKg === undefined)).toBe(true);
    expect(sets.every((set) => set.loadPercent === undefined)).toBe(true);
  });

  it('marks the load optional, so a bodyweight set is a complete set', () => {
    // The runner refuses to log an RPE row until a load is typed. Without this
    // flag the row would refuse the bodyweight calf raise outright, which is
    // the way the exercise is usually done and the way it starts.
    const sets = getPerSetPrescription(calfRaise, makeAthlete('intermediate'), makeContext({ sets: 2 }));
    expect(sets.every((set) => set.optionalLoad === true)).toBe(true);
  });

  it('carries the tempo on every set, because the tempo is the exercise', () => {
    const sets = getPerSetPrescription(calfRaise, makeAthlete('advanced'), makeContext({ sets: 2 }));
    expect(sets.map((set) => set.detailLine)).toEqual(['3 s up, 3 s down', '3 s up, 3 s down']);
  });

  it('holds one effort across the sets rather than climbing a ladder', () => {
    // The prehab scheme is straight: heavy slow resistance is the same load on
    // every set, so asking for 6 then 7 then 8 would ask for three loads.
    const sets = getPerSetPrescription(calfRaise, makeAthlete('intermediate'), makeContext({ sets: 3 }));
    expect(sets.map((set) => set.targetRpe)).toEqual([8, 8, 8]);
    expect(RULESET_V1.constants.rpeLadder).toEqual([6, 7, 8]);
  });

  it('obeys the week-1 effort cap like every other row the athlete loads', () => {
    const sets = getPerSetPrescription(
      calfRaise,
      makeAthlete('intermediate'),
      makeContext({ sets: 2, isFirstProgramWeek1: true }),
    );
    expect(sets.map((set) => set.targetRpe)).toEqual([7, 7]);
    expect(RULESET_V1.constants.week1RpeCap).toBe(7);
  });

  it('keeps the prehab rest, so the load never buys it a lifting rest', () => {
    const sets = getPerSetPrescription(calfRaise, makeAthlete('intermediate'), makeContext({ sets: 2 }));
    expect(sets.every((set) => set.restS === RULESET_V1.constants.restBoundsS.prehabMobility)).toBe(
      true,
    );
  });

  it('reads as RPE mode to the runner, so the row takes a typed load', () => {
    // Through the real generator, not a hand-built context: the runner decides
    // whether a row has a load field from `loadMode`, and a prehab row that
    // still said "none" would show the effort with nowhere to type the weight.
    const week = workedWeek();
    const rows = week.sessions
      .flatMap((session) => session.blocks)
      .flatMap((block) => block.exercises)
      .filter((row) => row.exerciseId === calfRaise.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.loadMode).toBe('rpe');
      expect(row.sets.every((set) => set.targetRpe !== undefined)).toBe(true);
      expect(row.sets.every((set) => set.detailLine === '3 s up, 3 s down')).toBe(true);
    }
  });
});

describe('the load it carries is never a one-rep max', () => {
  it('takes no Epley estimate off a tendon row', () => {
    // The row is loaded, so the estimator would otherwise read it: eight slow
    // reps at 45 lb becomes a 55 lb "max" that nothing prescribes from, which
    // R97 would then drop and Progress would chart as a lift.
    const logs: SetLog[] = [1, 2, 3].map((setNumber) => ({
      id: `slog-${setNumber}`,
      sessionId: 'w2-d1',
      exerciseId: calfRaise.id,
      setNumber,
      repsDone: 8,
      loadKg: lbToKg(45),
      rpe: 8,
      loadSource: 'rpe',
      completedAt: '2026-09-14T18:00:00.000Z',
      plannedDate: '2026-09-14',
      idempotencyKey: `set:w2-d1:${calfRaise.id}:${setNumber}`,
    }));
    expect(bestEpley(logs, calfRaise, RULESET_V1, '2026-09-15T03:00:00.000Z')).toBeNull();
  });

  it('still estimates from an ordinary loaded row on the same numbers', () => {
    // The same logs against a lift that is a strength attempt: the exclusion is
    // the tendon mode, not the reps, the load or the effort.
    const squat = exercise('back_squat');
    const logs: SetLog[] = [
      {
        id: 'slog-squat',
        sessionId: 'w2-d1',
        exerciseId: squat.id,
        setNumber: 1,
        repsDone: 8,
        loadKg: lbToKg(45),
        rpe: 8,
        loadSource: 'rpe',
        completedAt: '2026-09-14T18:00:00.000Z',
        plannedDate: '2026-09-14',
        idempotencyKey: 'set:w2-d1:back_squat:1',
      },
    ];
    expect(bestEpley(logs, squat, RULESET_V1, '2026-09-15T03:00:00.000Z')).not.toBeNull();
  });
});

describe('every other prehab row', () => {
  it('leaves an isometric hold a hold', () => {
    const iso = exercise('single_leg_calf_isometric');
    const sets = getPerSetPrescription(iso, makeAthlete('intermediate'), makeContext({ sets: 2 }));
    expect(sets.every((set) => set.durationS !== undefined)).toBe(true);
    expect(sets.every((set) => set.targetRpe === undefined)).toBe(true);
    expect(sets.every((set) => set.detailLine === undefined)).toBe(true);
  });

  it('leaves an unloadable slow-resistance row as reps only', () => {
    // Eccentric calf lowering is slow resistance too, but it is not loadable,
    // so there is no weight to ask for and the row stays what it was.
    const eccentric = exercise('eccentric_calf_lowering');
    expect(eccentric.tendonMode).toBe('slow_resistance');
    expect(eccentric.loadable).toBe(false);
    const sets = getPerSetPrescription(eccentric, makeAthlete('intermediate'), makeContext({ sets: 2 }));
    expect(sets.every((set) => set.targetRpe === undefined)).toBe(true);
    expect(displays(sets).every((line) => line.includes('BW'))).toBe(true);
  });
});
