/**
 * The upper-body emphasis on the owner's own week: the Recovery day becomes an
 * Upper + Mobility day led by a chest press, with the bent-over row, the light
 * full-range overhead press and the kneeling slam; the upper-power day keeps
 * its pulls and trades the overhead push for a tricep extension; and every
 * knee-alignment row has a stability row beside it where the day has room.
 */
import { describe, expect, it } from 'vitest';
import { climberAthlete } from '../src/fixtures/climber.js';
import { loadExercises, loadRuleset, planSkeleton, projectWeeks } from '../src/index.js';
import type { Athlete } from '../src/types/athlete.js';
import type { SessionPlan, WeekPlan } from '../src/types/plan.js';

const ruleset = loadRuleset();
const { exercises, ladders } = loadExercises();
const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
const TODAY = '2026-10-12';

function owner(sessionsPerWeek: number): Athlete {
  return {
    ...climberAthlete(),
    emphasis: 'upper_body',
    targetDate: '2027-01-03',
    valgusControl: { required: true, sessionsPerWeek, minHoursFromWall: 6 },
  };
}

function weeks(athlete: Athlete): WeekPlan[] {
  const skeleton = planSkeleton(athlete, TODAY, ruleset);
  return projectWeeks({
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    seed: 1,
    today: TODAY,
    fromWeek: 1,
    workingMaxes: athlete.workingMaxes,
  }).weeks;
}

function ids(session: SessionPlan): string[] {
  return session.blocks.flatMap((block) => block.exercises.map((row) => row.exerciseId));
}

const program = weeks(owner(4));
const loadWeeks = program.filter((week) => week.kind === 'load');

describe('the upper-body emphasis on the owner week', () => {
  it('runs two upper days and no Recovery day on every load week', () => {
    for (const week of loadWeeks) {
      const types = week.sessions.map((session) => session.dayType);
      expect(types, `week ${week.w}`).toContain('upper_strength');
      expect(types, `week ${week.w}`).toContain('upper_mobility');
      expect(types, `week ${week.w}`).not.toContain('recovery_mobility');
    }
  });

  it('leads the second upper day with chest, then the bent-over row and the light overhead press', () => {
    for (const week of loadWeeks) {
      const day = week.sessions.find((session) => session.dayType === 'upper_mobility');
      if (day === undefined) throw new Error(`week ${week.w} has no upper + mobility day`);
      const main = day.blocks.find((block) => block.name === 'main_lift')?.exercises[0];
      expect(byId.get(main?.exerciseId ?? '')?.movementPattern, `week ${week.w}`).toBe('push_horizontal');
      expect(ids(day), `week ${week.w}`).toContain('barbell_bent_over_row');
      expect(ids(day), `week ${week.w}`).toContain('db_overhead_press_rom');
      expect(ids(day), `week ${week.w}`).toContain('kneeling_med_ball_slam');
    }
  });

  it('keeps the heavy overhead push off the upper-power day and runs a tricep extension instead', () => {
    for (const week of loadWeeks) {
      const day = week.sessions.find((session) => session.dayType === 'upper_strength');
      if (day === undefined) throw new Error(`week ${week.w} has no upper strength day`);
      expect(ids(day), `week ${week.w}`).toContain('db_tricep_extension');
      expect(ids(day), `week ${week.w}`).not.toContain('push_press');
      expect(ids(day), `week ${week.w}`).not.toContain('overhead_press');
    }
  });

  it('places a knee-alignment row on every gym day when four a week are asked for', () => {
    for (const week of loadWeeks) {
      const rnt = week.sessions.filter((session) =>
        ids(session).some((id) => byId.get(id)?.isRnt === true),
      );
      expect(rnt.length, `week ${week.w}`).toBe(week.sessions.length);
    }
  });

  it('puts a stability row beside the knee-alignment row on the second upper day, and mostly on the lower day', () => {
    const stable = (day: SessionPlan): boolean =>
      ids(day).some((id) => {
        const exercise = byId.get(id);
        if (exercise === undefined || exercise.isRnt) return false;
        // The stability extra, or the frontal-plane hold R57 rotates it with.
        return (
          (exercise.stabilityDemand === 'high' && exercise.intent === 'prehab') ||
          exercise.rotationGroup === 'lateral_core'
        );
      });
    let lowerDays = 0;
    let lowerStable = 0;
    for (const week of loadWeeks) {
      for (const day of week.sessions) {
        if (day.dayType === 'upper_mobility') expect(stable(day), `week ${week.w}`).toBe(true);
        if (day.dayType === 'lower_strength') {
          lowerDays += 1;
          if (stable(day)) lowerStable += 1;
        }
      }
    }
    // R57 rotates the lower day's core row every few weeks, sometimes onto a
    // dead bug; the stability row is still the lower day's usual one.
    expect(lowerStable / lowerDays).toBeGreaterThanOrEqual(0.7);
  });

  it('never reports the stability extra as trimmed', () => {
    for (const week of program) {
      for (const day of week.sessions) {
        const trimmed = day.trimmed.map((entry) => entry.exerciseId);
        expect(trimmed, `week ${week.w} ${day.dayType}`).not.toContain('single_leg_balance_reach');
      }
    }
  });
});
