/**
 * The projection: twelve weeks built up front, each fed the week before it as
 * if it had gone exactly as written.
 *
 * What is checked here is what the app relies on and what a reader cannot see
 * by inspection: that a projection is deterministic, that every week after the
 * first judges `progress`, that the rolling history carries forward the way a
 * real week's would, and that no load is ever invented for a lift the athlete
 * has not given a number for.
 */
import { describe, expect, it } from 'vitest';
import { computeAdherence } from '../adherence/index.js';
import { loadExercises } from '../exercises/index.js';
import { climberAthlete, climberProgramSpec } from '../fixtures/climber.js';
import { ownerAthlete } from '../fixtures/index.js';
import { loadRuleset } from '../ruleset/index.js';
import { planSkeleton } from '../skeleton/index.js';
import { stepWeekChain } from './chain.js';
import {
  asWrittenLogs,
  projectWeeks,
  projectionOptions,
  projectionStart,
  type ProjectionInput,
} from './project.js';
import type { MaterializeHistory, WeekPlan } from '../types/plan.js';

const ruleset = loadRuleset();
const { exercises, ladders } = loadExercises();

/** The climber's own program, projected instead of logged. */
function climberInput(): ProjectionInput {
  const athlete = climberAthlete();
  const spec = climberProgramSpec(athlete);
  const planned = planSkeleton(athlete, spec.programStart, ruleset);
  const skeleton = spec.patchSkeleton?.(planned) ?? planned;
  const input: ProjectionInput = {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    seed: spec.seed,
    today: spec.programStart,
    fromWeek: 1,
    workingMaxes: athlete.workingMaxes,
  };
  if (spec.priorLogs !== undefined) input.priorLogs = spec.priorLogs;
  return input;
}

/** The basketball owner: a back squat entered, and nothing else. */
function ownerInput(): ProjectionInput {
  const athlete = ownerAthlete();
  const skeleton = planSkeleton(athlete, '2026-09-07', ruleset);
  return {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    seed: 20260907,
    today: '2026-09-07',
    fromWeek: 1,
    workingMaxes: athlete.workingMaxes,
  };
}

/** Every working set of a week, warm-up and cool-down left out. */
function workingRows(week: WeekPlan) {
  return week.sessions.flatMap((session) =>
    session.blocks
      .filter((block) => block.name !== 'warm_up' && block.name !== 'cool_down')
      .flatMap((block) => block.exercises.map((row) => ({ session, row }))),
  );
}

describe('projectWeeks over the whole program', () => {
  const input = climberInput();
  const projected = projectWeeks(input);

  it('projects every week of the program, with every session of each', () => {
    expect(input.skeleton.W).toBe(12);
    expect(projected.weeks).toHaveLength(12);
    expect(projected.weeks.map((week) => week.w)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const week of projected.weeks) {
      const planned = input.skeleton.weeks.find((entry) => entry.w === week.w);
      expect(week.sessions).toHaveLength(planned?.sessions.length ?? -1);
    }
  });

  it('is deterministic: the same seed gives byte-identical output', () => {
    const again = projectWeeks(climberInput());
    expect(again.weeks).toEqual(projected.weeks);
    expect(JSON.stringify(again.weeks)).toBe(JSON.stringify(projected.weeks));
    expect(JSON.stringify(again.logs)).toBe(JSON.stringify(projected.logs));
    expect(JSON.stringify(again.sessions)).toBe(JSON.stringify(projected.sessions));
  });

  it('judges every week after the first a progress week', () => {
    expect(projected.weeks[0]?.outcome).toBeUndefined();
    for (const week of projected.weeks.slice(1)) {
      expect(week.outcome?.kind).toBe('progress');
      expect(week.snapshot.outcome).toBe('progress');
      expect(week.snapshot.adherenceUsed).toBe(1);
    }
  });

  it('logs a week as fully adherent, all reps, no failed lift', () => {
    for (const week of projected.weeks) {
      const { logs, records } = asWrittenLogs(week);
      const adherence = computeAdherence(week, logs, records);
      expect(adherence.prescribed).toBe(week.sessions.length);
      expect(adherence.completed).toBe(week.sessions.length);
      expect(adherence.pct).toBe(1);
      expect(adherence.allRepsCompleted).toBe(true);
      expect(Object.keys(adherence.perLiftFailures)).toEqual([]);
    }
  });

  it('carries the rolling history forward exactly as a logged week would', () => {
    const options = projectionOptions(input);
    let state = projectionStart(input);
    const histories: MaterializeHistory[] = [];
    for (let w = 1; w <= 12; w += 1) {
      state = stepWeekChain(state, w, options);
      histories.push(state.history);
    }
    expect(state.weeks).toEqual(projected.weeks);

    const last = histories[11];
    if (last === undefined) throw new Error('twelve weeks were not folded');

    // Every row that appeared in week w is recorded against week w, ascending.
    for (const week of projected.weeks) {
      for (const { row } of workingRows(week)) {
        const seen = last.rotationHistory[row.exerciseId];
        expect(seen).toContain(week.w);
        expect(seen).toEqual([...(seen ?? [])].sort((a, b) => a - b));
      }
    }

    // A ladder never spends more than two rungs inside one block.
    for (const history of histories) {
      for (const entry of Object.values(history.ladderState)) {
        expect(entry.advancesThisBlock).toBeLessThanOrEqual(2);
        expect(entry.rung).toBeGreaterThanOrEqual(0);
      }
    }

    // Percent-week indexes only ever rise, one week at a time.
    histories.forEach((history, index) => {
      const before = index === 0 ? {} : (histories[index - 1]?.percentWeekIndexByLift ?? {});
      for (const [lift, value] of Object.entries(history.percentWeekIndexByLift ?? {})) {
        const previous = before[lift] ?? -1;
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value - previous).toBeLessThanOrEqual(1);
      }
    });

    // Adherence is one entry a week, every one of them a full week.
    expect(last.consecutiveAdherence).toEqual(Array.from({ length: 12 }, () => 1));
  });

  it('never logs a load the plan did not prescribe', () => {
    const bySet = new Map<string, number | undefined>();
    for (const week of projected.weeks) {
      for (const { session, row } of workingRows(week)) {
        for (const set of row.sets) {
          bySet.set(`${session.id}|${row.exerciseId}|${set.setNumber}`, set.loadKg);
        }
      }
    }
    for (const log of projected.logs) {
      const key = `${log.sessionId}|${log.exerciseId}|${log.setNumber}`;
      expect(bySet.has(key)).toBe(true);
      expect(log.loadKg).toBe(bySet.get(key));
    }
  });

  it('leaves a lift with no entered max and no logs in RPE mode for every week', () => {
    const owner = projectWeeks(ownerInput());
    const rpeRows = owner.weeks.flatMap((week) =>
      workingRows(week)
        .filter(({ row }) => row.loadMode === 'rpe')
        .map(({ row }) => row),
    );
    expect(rpeRows.length).toBeGreaterThan(0);
    // The last week still has one: a projection types nothing, so nothing in
    // the twelve weeks ever converts an RPE row to a percent row.
    const lastWeek = owner.weeks[11];
    expect(
      workingRows(lastWeek ?? owner.weeks[0]!).some(({ row }) => row.loadMode === 'rpe'),
    ).toBe(true);
    for (const row of rpeRows) {
      for (const set of row.sets) expect(set.loadKg).toBeUndefined();
    }
    for (const log of owner.logs) {
      if (log.loadSource !== 'rpe') continue;
      expect(log.loadKg).toBeUndefined();
    }
  });

  it('materializes twelve weeks fast enough not to freeze a phone', () => {
    const started = performance.now();
    projectWeeks(climberInput());
    const elapsed = performance.now() - started;
    console.log(`12-week projection: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(1500);
  });
});
