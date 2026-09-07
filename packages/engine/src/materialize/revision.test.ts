/**
 * `foldObservedWeeks`, the entry ramp a revision takes.
 *
 * This is the one piece with no oracle in the database behind it: it has to
 * rebuild, from stored week plans and stored logs, exactly the rolling history
 * and advanced skeleton the weeks the athlete really trained would have
 * produced. So the first test here is an identity: fold three weeks the chain
 * itself just built, project the fourth, and it must be the same week the
 * uninterrupted chain produced. Everything after that changes one thing in the
 * observed weeks and checks the change lands where it should.
 */
import { describe, expect, it } from 'vitest';
import { loadExercises } from '../exercises/index.js';
import { climberAthlete, climberProgramSpec } from '../fixtures/climber.js';
import { loadRuleset } from '../ruleset/index.js';
import { planSkeleton } from '../skeleton/index.js';
import { ObservedWeekError, foldObservedWeeks, emptyMaterializeHistory } from './chain.js';
import {
  asWrittenLogs,
  projectWeeks,
  projectionOptions,
  type ProjectionInput,
} from './project.js';
import type { PreviousWeekContext, WeekPlan } from '../types/plan.js';

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

function inputFrom(fromWeek: number, observed?: readonly PreviousWeekContext[]): ProjectionInput {
  const input: ProjectionInput = {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    seed: spec.seed,
    today: weekStart(fromWeek),
    fromWeek,
    toWeek: 6,
    workingMaxes: athlete.workingMaxes,
  };
  if (spec.priorLogs !== undefined) input.priorLogs = spec.priorLogs;
  if (observed !== undefined) input.observed = observed;
  return input;
}

/** A week the athlete "really trained", in the shape the store hands back. */
function observedFrom(week: WeekPlan): PreviousWeekContext {
  const { logs, records } = asWrittenLogs(week);
  return { plan: week, logs, sessions: records };
}

/** The main-lift row of the week's first session that carries one. */
function mainLiftRow(week: WeekPlan) {
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      if (block.name !== 'main_lift') continue;
      const row = block.exercises[0];
      if (row !== undefined) return { session, row };
    }
  }
  throw new Error(`week ${week.w} has no main lift`);
}

/** The same week, with its main lift's last working set logged two reps short. */
function withShortTopSet(week: WeekPlan): PreviousWeekContext {
  const observed = observedFrom(week);
  const { session, row } = mainLiftRow(week);
  const working = row.sets.filter((set) => !set.isRamp && set.reps !== undefined);
  const top = working[working.length - 1];
  if (top === undefined) throw new Error(`week ${week.w}'s main lift has no working set`);

  const logs = observed.logs.map((log) => {
    if (log.sessionId !== session.id) return log;
    if (log.exerciseId !== row.exerciseId || log.setNumber !== top.setNumber) return log;
    return { ...log, repsDone: Math.max(1, (top.reps ?? 3) - 2) };
  });
  return { ...observed, logs };
}

function maxFor(week: WeekPlan, lift: string): number {
  const found = week.snapshot.workingMaxes.find((entry) => entry.lift === lift);
  if (found === undefined) throw new Error(`week ${week.w} froze no max for ${lift}`);
  return found.valueKg;
}

const pure = projectWeeks(inputFrom(1));

describe('folding weeks the athlete really trained', () => {
  it('rebuilds exactly the state the uninterrupted chain was in', () => {
    const observed = pure.weeks.slice(0, 3).map(observedFrom);
    const revised = projectWeeks(inputFrom(4, observed));

    expect(revised.weeks.map((week) => week.w)).toEqual([4, 5, 6]);
    expect(JSON.stringify(revised.weeks)).toBe(JSON.stringify(pure.weeks.slice(3)));
    expect(revised.skeleton).toEqual(pure.skeleton);
    expect(revised.history).toEqual(pure.history);
  });

  it('carries the observed logs into the four-week lookback', () => {
    const observed = pure.weeks.slice(0, 3).map(observedFrom);
    const state = foldObservedWeeks(
      {
        skeleton,
        history: emptyMaterializeHistory(),
        workingMaxes: athlete.workingMaxes,
        weeks: [],
        setLogs: [],
        sessions: [],
      },
      observed,
      projectionOptions(inputFrom(4, observed)),
    );
    expect(state.weeks).toEqual([]);
    expect(state.setLogs).toHaveLength(observed.flatMap((week) => week.logs).length);
    expect(state.sessions).toHaveLength(observed.flatMap((week) => week.sessions).length);
    expect(state.prevWeek?.plan.w).toBe(3);
    expect(state.history.consecutiveAdherence).toEqual([1, 1, 1]);
  });

  it('turns a short top set in week 3 into a hold and a lower max in week 4', () => {
    const observed = [
      observedFrom(pure.weeks[0]!),
      observedFrom(pure.weeks[1]!),
      withShortTopSet(pure.weeks[2]!),
    ];
    const revised = projectWeeks(inputFrom(4, observed));
    const week4 = revised.weeks[0];
    if (week4 === undefined) throw new Error('week 4 was not projected');

    expect(week4.outcome?.kind).toBe('hold');
    expect(week4.snapshot.outcome).toBe('hold');

    const lift = mainLiftRow(pure.weeks[2]!).row.exerciseId;
    expect(maxFor(week4, lift)).toBeLessThan(maxFor(pure.weeks[3]!, lift));
  });

  it('refuses a week whose snapshot came from another rule book', () => {
    const stale = observedFrom(pure.weeks[0]!);
    const observed = [
      {
        ...stale,
        plan: { ...stale.plan, snapshot: { ...stale.plan.snapshot, rulesetVersion: '0.0.1' } },
      },
    ];
    expect(() => projectWeeks(inputFrom(2, observed))).toThrow(ObservedWeekError);
    expect(() => projectWeeks(inputFrom(2, observed))).toThrow(/rule book 0\.0\.1/);
  });

  it('refuses a week whose logs name no set it prescribed', () => {
    const week = observedFrom(pure.weeks[0]!);
    const remapped = week.logs.map((log) => ({ ...log, sessionId: `sess_${log.sessionId}` }));
    const observed = [{ ...week, logs: remapped }];
    expect(() => projectWeeks(inputFrom(2, observed))).toThrow(ObservedWeekError);
    expect(() => projectWeeks(inputFrom(2, observed))).toThrow(/match nothing it prescribed/);
  });

  it('accepts a week with no logs at all, which is a week that was skipped', () => {
    const week = observedFrom(pure.weeks[0]!);
    const observed = [{ ...week, logs: [], sessions: [] }];
    expect(() => projectWeeks(inputFrom(2, observed))).not.toThrow();
  });
});
