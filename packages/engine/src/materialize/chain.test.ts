/**
 * The shared week-after-week fold. Two things are worth pinning here: that the
 * fixtures and the projection really are one loop rather than two that agree by
 * luck, and that folding a week at a time (which is how the app yields to paint
 * between weeks) gives exactly what the whole-range call gives.
 */
import { describe, expect, it } from 'vitest';
import { loadExercises } from '../exercises/index.js';
import { climberAthlete, climberProgramSpec } from '../fixtures/climber.js';
import { runProgram, type ProgramSpec } from '../fixtures/program.js';
import { loadRuleset } from '../ruleset/index.js';
import { planSkeleton } from '../skeleton/index.js';
import { advanceHistory, emptyMaterializeHistory, runWeekChain, stepWeekChain } from './chain.js';
import { projectWeeks, projectionOptions, projectionStart, type ProjectionInput } from './project.js';
import type { LadderId } from '../types/core.js';
import type { WeekPlan } from '../types/plan.js';

const ruleset = loadRuleset();
const { exercises, ladders } = loadExercises();
const athlete = climberAthlete();
const spec = climberProgramSpec(athlete);
const planned = planSkeleton(athlete, spec.programStart, ruleset);
const skeleton = spec.patchSkeleton?.(planned) ?? planned;

function weekStart(w: number): string {
  const week = skeleton.weeks.find((entry) => entry.w === w);
  if (week === undefined) throw new Error(`no week ${w} in this skeleton`);
  return week.windowStart;
}

/** The climber's program logged exactly as written: no typed loads, nothing missed. */
function asWrittenSpec(): ProgramSpec {
  const written: ProgramSpec = {
    ...spec,
    // Every week is materialized at its own window start, which is what a
    // projection does, so the two chains are comparable week for week.
    today: weekStart(skeleton.W),
    currentWeek: skeleton.W,
    typedLoad: () => undefined,
  };
  delete written.completed;
  delete written.failedSetWeek;
  delete written.failedLift;
  delete written.readinessToday;
  return written;
}

function projection(): ProjectionInput {
  const input: ProjectionInput = {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    seed: spec.seed,
    today: weekStart(1),
    fromWeek: 1,
    workingMaxes: athlete.workingMaxes,
  };
  if (spec.priorLogs !== undefined) input.priorLogs = spec.priorLogs;
  return input;
}

/** A week carrying one row on one ladder, which is all `advanceHistory` reads. */
function ladderWeek(w: number, kind: WeekPlan['kind']): WeekPlan {
  return {
    w,
    kind,
    blockType: 'strength',
    windowStart: '2026-09-07',
    windowEnd: '2026-09-13',
    sessions: [
      {
        id: `w${w}-d0`,
        date: '2026-09-07',
        weekday: 1,
        dayType: 'lower_strength',
        isTestDay: false,
        isMaximalCns: false,
        estimatedMinutes: 60,
        headerSuffixes: [],
        notices: [],
        blocks: [
          {
            name: 'main_lift',
            grouped: false,
            exercises: [
              {
                exerciseId: 'box_squat',
                name: 'Box squat',
                block: 'main_lift',
                role: 'main_lift',
                loadType: 'heavy_strength',
                loadMode: 'entered',
                bothSides: false,
                sets: [],
                restS: 180,
                restRule: 'heavy strength',
                sourceLine: 'entered 320 lb',
                landingPromptOnLastSet: false,
                contactsPerRep: 0,
                cues: [],
              },
            ],
          },
        ],
        contacts: {
          extensive: 0,
          highIntensity: 0,
          highAmplitude: 0,
          targetExtensive: 0,
          capHigh: 25,
          capAmplitude: 20,
        },
        trimmed: [],
        fingerLoad: 'none',
        rntScheduled: false,
      },
    ],
    snapshot: {
      adherenceUsed: 1,
      outcome: 'progress',
      workingMaxes: [],
      targets: skeleton.weeks[0]!.targets,
      k: w,
      seed: spec.seed,
      rulesetVersion: ruleset.version,
      generatedAt: '2026-09-07T03:00:00.000Z',
    },
    lines: [],
  };
}

describe('the shared week chain', () => {
  it('starts from a clean first-program history', () => {
    expect(emptyMaterializeHistory()).toEqual({
      firstProgram: true,
      rotationHistory: {},
      ladderState: {},
      percentWeekIndexByLift: {},
      jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
      consecutiveAdherence: [],
      testPlateau: false,
      liftPlateau: {},
      liftRaisedSinceBlockStart: {},
    });
  });

  it('reproduces runProgram week for week when the fixture logs as written', () => {
    const run = runProgram(asWrittenSpec());
    const projected = projectWeeks(projection());
    expect(projected.weeks).toHaveLength(run.weeks.length);
    expect(JSON.stringify(projected.weeks)).toBe(JSON.stringify(run.weeks));
    expect(JSON.stringify(projected.logs)).toBe(JSON.stringify(run.setLogs));
    expect(JSON.stringify(projected.sessions)).toBe(JSON.stringify(run.sessions));
  });

  it('folds one week at a time to exactly what the whole range gives', () => {
    const input = projection();
    const options = projectionOptions(input);
    const whole = runWeekChain(projectionStart(input), 1, 6, options);

    let stepped = projectionStart(input);
    for (let w = 1; w <= 6; w += 1) stepped = stepWeekChain(stepped, w, options);

    expect(JSON.stringify(stepped.weeks)).toBe(JSON.stringify(whole.weeks));
    expect(stepped.history).toEqual(whole.history);
    expect(stepped.skeleton).toEqual(whole.skeleton);
    expect(stepped.workingMaxes).toEqual(whole.workingMaxes);
  });

  it('resumes a chain from the state the last week left', () => {
    const input = projection();
    const options = projectionOptions(input);
    const whole = runWeekChain(projectionStart(input), 1, 6, options);
    const halved = runWeekChain(
      runWeekChain(projectionStart(input), 1, 3, options),
      4,
      6,
      options,
    );
    expect(JSON.stringify(halved.weeks)).toBe(JSON.stringify(whole.weeks));
  });

  it('spends at most two ladder rungs a block and none in a reduced week', () => {
    const ids: LadderId[] = ['depth_jump'];
    let history = emptyMaterializeHistory();
    for (let w = 1; w <= 4; w += 1) {
      history = advanceHistory(history, ladderWeek(w, w === 3 ? 'deload' : 'load'), 1, ids);
    }
    expect(history.ladderState['depth_jump']).toEqual({ rung: 2, advancesThisBlock: 2 });
    expect(history.rotationHistory['box_squat']).toEqual([1, 2, 3, 4]);
    expect(history.consecutiveAdherence).toEqual([1, 1, 1, 1]);
  });
});
