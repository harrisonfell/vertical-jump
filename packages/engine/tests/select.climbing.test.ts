/**
 * The speed-climbing selection grid: 4 and 5 days, advanced, with and without
 * a hangboard, wall work on Monday, Wednesday and Friday evenings.
 *
 * Everything here is a house rule from brief section 09 and the owner's
 * athlete spec, and every one of them is additive: the last describe block
 * asserts that a basketball week is byte-identical to the one the golden
 * snapshot already pins.
 */
import { describe, expect, it } from 'vitest';

import { build, freshHistory } from './invariants.support.js';
import {
  POWER_DAY_TYPES,
  SWEEP,
  climber,
  climberPowerContext,
  goalPriorityAudit,
  rowsOf,
  weeksFor,
} from './select.climbing.support.js';
import { PROGRAM_START, baseAthlete } from './grid.support.js';
import { gridRuleset, gridSeed } from './grid.seed.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { displayedRowCount } from '../src/select/order.js';
import { evaluatePainGate } from '../src/select/painGate.js';
import { selectSession, type SelectContext } from '../src/select/assemble.js';
import { mulberry32 } from '../src/prng.js';
import {
  farFromWall,
  fingerSpacingOk,
  isCalfVolume,
  isHardFingerExercise,
  placeRnt,
  planHardFingerSessions,
  sportRequirementsFor,
} from '../src/select/sport.js';
import type { Athlete } from '../src/types/athlete.js';
import type { Exercise } from '../src/types/exercise.js';


const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = new Map<string, Exercise>(exercises.map((entry) => [entry.id, entry]));
const climbing = ruleset.constants.climbing;

/** The owner: advanced, speed climbing, A2 pulley history, wall Mon Wed Fri. */
describe('the speed-climbing week', () => {
  it('never programmes a change-of-direction rep or a conditioning block', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        for (const { row } of rowsOf(session)) {
          if (row.movementPattern === 'cod' || (row.codCutsPerRep ?? 0) > 0) {
            bad.push(`${entry.label} ${session.dayType}: ${row.id}`);
          }
        }
        const conditioning = session.blocks.filter((block) => block.name === 'conditioning');
        if (conditioning.length > 0) bad.push(`${entry.label} ${session.dayType}: conditioning`);
        if (session.blocks.some((block) => block.name === 'cod')) {
          bad.push(`${entry.label} ${session.dayType}: cod block`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
    expect(sportRequirementsFor('speed_climbing', ruleset).allowsConditioningBlock).toBe(false);
  });

  it('carries one acceleration sprint on every Power day, in the Power block (R102, R113)', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        if (!POWER_DAY_TYPES.has(session.dayType)) continue;
        if (entry.week.kind !== 'load') continue;
        const sprints = rowsOf(session).filter(
          ({ block, row }) =>
            block === 'power' && row.movementPattern === 'sprint' && row.loadType !== 'mobility',
        );
        if (sprints.length !== 1) {
          bad.push(`${entry.label} ${session.dayType}: ${sprints.length} sprints`);
          continue;
        }
        const meters = sprints[0]?.row.sprintDistanceM ?? 0;
        if (meters < 10 || meters > 30) bad.push(`${entry.label}: ${meters} m`);
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
    expect(sportRequirementsFor('speed_climbing', ruleset).sprintClass).toBe('acceleration');
  });

  it('carries one jump or reactive session every week', () => {
    const bad: string[] = [];
    const wanted = climbing.jumpOrReactiveSessionsPerWeek;
    for (const entry of SWEEP) {
      const jumpDays = entry.week.sessions.filter((session) =>
        rowsOf(session).some(({ block, row }) => row.plyometric !== undefined && block === 'power'),
      );
      if (jumpDays.length < wanted) bad.push(`${entry.label}: ${jumpDays.length}`);
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('runs one upper power session a week on a weighted pull-up', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      if (entry.week.kind !== 'load') continue;
      const upper = entry.week.sessions.filter((session) => session.sessionIntent === 'upper_power');
      if (upper.length !== climbing.upperPowerSessionsPerWeek) {
        bad.push(`${entry.label}: ${upper.length} upper power sessions`);
        continue;
      }
      const session = upper[0];
      if (session === undefined) continue;
      const main = session.blocks
        .flatMap((block) => (block.name === 'main_lift' ? block.exercises : []))
        .map((row) => row.exerciseId);
      if (!main.includes('weighted_pull_up')) bad.push(`${entry.label}: main lift ${main.join(',')}`);
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('keeps the upper power session at or above half velocity or elastic rows (R117)', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        if (session.sessionIntent !== 'upper_power') continue;
        const rows = rowsOf(session);
        const fast = rows.filter(
          ({ row }) => row.intent === 'velocity' || row.intent === 'elastic',
        ).length;
        if (fast * 2 < rows.length) {
          bad.push(
            `${entry.label}: ${fast}/${rows.length} [${rows
              .map(({ row }) => `${row.id}:${row.intent}`)
              .join(' ')}]`,
          );
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('holds every session to two high-CNS rows, three strength lifts and eight rows', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        const rows = rowsOf(session);
        const highCns = rows.filter(({ row }) => row.cnsCost === 'high').length;
        const heavy = rows.filter(({ row }) => row.loadType === 'heavy_strength').length;
        const strength = rows.filter(({ row }) => row.loadable && row.intent !== 'prehab').length;
        if (highCns > ruleset.constants.maxHighCnsPerSession) {
          bad.push(`${entry.label} ${session.dayType} R44: ${highCns}`);
        }
        if (heavy > ruleset.constants.heavyLiftsPerSession.advanced) {
          bad.push(`${entry.label} ${session.dayType} R67: ${heavy}`);
        }
        // The upper power day is the one the house rule bounds by name: at
        // most three loadable strength movements beside the throws.
        if (session.sessionIntent === 'upper_power' && strength > 3) {
          bad.push(`${entry.label} ${session.dayType} R67 loadable: ${strength}`);
        }
        if (displayedRowCount(session.blocks) > ruleset.constants.maxDisplayedExercises) {
          bad.push(`${entry.label} ${session.dayType}: ${displayedRowCount(session.blocks)} rows`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('stays inside the two contact caps on every session (R85, R52)', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        if (session.contacts.highIntensity > 25) {
          bad.push(`${entry.label} ${session.dayType} R85: ${session.contacts.highIntensity}`);
        }
        if (session.contacts.highAmplitude > 20) {
          bad.push(`${entry.label} ${session.dayType} R52: ${session.contacts.highAmplitude}`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });
});

describe('the finger rules', () => {
  it('shows every pulling row in an open-hand grip', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        for (const { row } of rowsOf(session)) {
          if (!row.isPulling) continue;
          if (row.gripMode !== 'open_hand') bad.push(`${entry.label}: ${row.id} ${row.gripMode}`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('keeps hard finger sessions at least 48 hours apart', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      entry.week.sessions.forEach((session, index) => {
        if (session.fingerLoad !== 'hard') return;
        if (!fingerSpacingOk(entry.week.sessions, index, climbing.fingerSpacingHours)) {
          bad.push(
            `${entry.label}: ${entry.week.sessions
              .filter((other) => other.fingerLoad === 'hard')
              .map((other) => other.date)
              .join(' ')}`,
          );
        }
      });
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('picks the sessions that may carry hard finger work, and demotes the rest', () => {
    const athlete = climber(5, true);
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const week = skeleton.weeks[1];
    expect(week).toBeDefined();
    if (week === undefined) return;
    // Upper Tuesday, Power Wednesday, Speed Saturday: read without the wall,
    // Wednesday is 24 h from Tuesday and comes down, Saturday is four days out
    // and stands.
    const plan = planHardFingerSessions(week.sessions, exercises, 'speed_climbing', 48);
    expect([...plan.allowed].sort()).toEqual([1, 4]);
    expect([...plan.demoted]).toEqual([2]);
    // Read WITH the wall, Saturday is 24 h from the Sunday session and comes
    // down, with a line naming the climbing day.
    const withWall = planHardFingerSessions(
      week.sessions,
      exercises,
      'speed_climbing',
      48,
      athlete,
      6,
    );
    expect([...withWall.allowed]).toEqual([1]);
    expect([...withWall.demoted].sort()).toEqual([2, 4]);
    expect(withWall.wallLines[4]).toBe(
      'Pull-ups moved to light work: climbing Sun evening, 48 h finger rule',
    );
    // A 168 h spacing leaves nothing: even the shared Tuesday is inside it,
    // because the same-day exception is the only way onto a wall day.
    const tighter = planHardFingerSessions(week.sessions, exercises, 'speed_climbing', 168);
    expect([...tighter.allowed]).toEqual([1]);
    expect([...tighter.demoted].sort()).toEqual([2, 4]);
  });

  it('demotes the closer session to light finger work with a line', () => {
    // The Speed day is exactly 48 h from the Upper day, so it stands at the
    // shipped spacing. Read the same rule at 72 h and it comes down: its
    // explosive pull is replaced by a med-ball throw and a line says why.
    const athlete = climber(5, true);
    const wide = {
      ...ruleset,
      constants: {
        ...ruleset.constants,
        climbing: { ...climbing, fingerSpacingHours: 72 },
      },
    };
    const skeleton = planSkeleton(athlete, PROGRAM_START, wide);
    const week = materializeWeek({
      athlete,
      ruleset: wide,
      exercises,
      ladders,
      skeleton,
      w: 2,
      workingMaxes: [],
      history: freshHistory(),
      today: skeleton.weeks[1]?.windowStart ?? PROGRAM_START,
      seed: 11,
    });
    const speed = week.sessions.find((session) => session.dayType === 'speed');
    expect(speed).toBeDefined();
    if (speed === undefined) return;
    expect(speed.fingerLoad).not.toBe('hard');
    for (const { row } of rowsOf(speed)) expect(isHardFingerExercise(row), row.id).toBe(false);
    expect(speed.notices.join(' ')).toContain('Pull-ups moved to light work: climbing');
    // The pull row's slot is filled by a med-ball throw instead.
    expect(rowsOf(speed).some(({ row }) => row.equipment.includes('med_ball'))).toBe(true);
  });

  it('takes the hard finger rows out when today\'s finger pain is over the ceiling', () => {
    const athlete = climber(4, true);
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const week = skeleton.weeks[1];
    const session = week?.sessions.find((entry) => entry.dayType === 'upper_strength');
    expect(session).toBeDefined();
    if (week === undefined || session === undefined) return;
    const context: SelectContext = {
      athlete,
      ruleset,
      exercises,
      ladders,
      week,
      session,
      painGate: evaluatePainGate(
        {
          clearance: athlete.clearance,
          painStatus: [],
          isAdult: true,
          today: PROGRAM_START,
        },
        ruleset,
      ),
      rotationHistory: {},
      jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
      prng: mulberry32(11),
      isFirstBlock: true,
    };
    const asWritten = selectSession(context);
    expect(asWritten.fingerLoad).toBe('hard');

    const sore = selectSession({ ...context, fingerPainToday: 4 });
    expect(sore.fingerLoad).not.toBe('hard');
    for (const block of sore.blocks) {
      for (const row of block.exercises) {
        expect(byId.get(row.exerciseId)?.fingerLoad, row.exerciseId).not.toBe('hard');
      }
    }
    expect(sore.notices.join(' ')).toContain('Finger pain at 4 out of 10');
    // Three out of ten is the ceiling itself, so the session is unchanged.
    expect(selectSession({ ...context, fingerPainToday: 3 }).fingerLoad).toBe('hard');
  });
});

describe('the knee-alignment placement', () => {
  it('schedules RNT twice a week, never inside six hours of the wall', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      if (entry.week.kind !== 'load') continue;
      const withRnt = entry.week.sessions.filter((session) => session.rntScheduled);
      if (withRnt.length !== climbing.rntSessionsPerWeek) {
        bad.push(`${entry.label}: ${withRnt.length} RNT sessions`);
      }
      for (const session of withRnt) {
        // The gym runs 08:00 to 10:00 and the wall 18:00 to 20:00, so every
        // day clears the six-hour gap, wall day or not. The row still has to
        // be on a day that clears it, which is what this asserts.
        const gap = entry.athlete.valgusControl?.minHoursFromWall ?? climbing.rntWallGapHours;
        if (!farFromWall(session.date, entry.athlete, gap)) {
          bad.push(`${entry.label}: RNT inside the wall gap on ${session.date}`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('places the row anyway with a line when no session clears the wall', () => {
    const athlete: Athlete = {
      ...climber(4, true),
      // Every training day is a wall day AND the gym runs into the evening, so
      // no session can satisfy the gap.
      wallWork: { weekdays: [0, 1, 2, 3, 4, 5, 6], typicalStart: '18:00', typicalEnd: '21:00' },
      sessionWindow: { start: '17:00', end: '19:00' },
    };
    const week = weeksFor(athlete, 1)[0];
    expect(week).toBeDefined();
    if (week === undefined) return;
    const placement = placeRnt(week, athlete, ruleset);
    expect(placement.sessionIds.length).toBe(climbing.rntSessionsPerWeek);
    expect(placement.lines.join(' ')).toContain('RNT: keep 6 h from wall work');
    const noticed = week.sessions.filter((session) =>
      session.notices.some((line) => line.includes('RNT: keep 6 h from wall work')),
    );
    expect(noticed.length).toBeGreaterThanOrEqual(1);
  });

  it('names the weaker side on every unilateral row', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        for (const block of session.blocks) {
          for (const row of block.exercises) {
            const exercise = byId.get(row.exerciseId);
            if (exercise?.unilateral !== true) continue;
            if (row.sideNote !== 'Weaker side first: left') {
              bad.push(`${entry.label}: ${row.exerciseId} ${row.sideNote ?? 'no side note'}`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });
});

describe('the jump sequence and the calf cap', () => {
  it('caps calf volume at two sets on one day a week', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      let days = 0;
      for (const session of entry.week.sessions) {
        let carries = false;
        for (const block of session.blocks) {
          for (const row of block.exercises) {
            const exercise = byId.get(row.exerciseId);
            if (exercise === undefined || !isCalfVolume(exercise)) continue;
            carries = true;
            if (row.sets.length > climbing.calfSetsCap) {
              bad.push(`${entry.label} ${session.dayType}: ${row.exerciseId} ${row.sets.length} sets`);
            }
          }
        }
        if (carries) days += 1;
      }
      if (days > climbing.calfDaysPerWeek) bad.push(`${entry.label}: calf on ${days} days`);
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('runs concentric-biased jumps in the Strength block and reactive ones in the Power block', () => {
    const strength: string[] = [];
    const power: string[] = [];
    for (const entry of SWEEP) {
      if (entry.week.kind !== 'load') continue;
      for (const session of entry.week.sessions) {
        for (const { block, row } of rowsOf(session)) {
          if (block !== 'power' || row.plyometric === undefined) continue;
          if (entry.week.blockType === 'strength') strength.push(row.id);
          else power.push(row.id);
        }
      }
    }
    // R44 caps a day at two high-effort movements: the weekly test takes one
    // and the block's own maximal jump takes the other, so each block shows
    // its own family and never the other one's.
    expect(power).toContain('approach_jump');
    expect(power).not.toContain('depth_pause_jump');
    expect(power).not.toContain('seated_jump');
    expect(strength).toContain('depth_pause_jump');
    expect(strength).not.toContain('approach_jump');
  });

  it('gives the primary goal the high-CNS slots and the secondary goal a row behind them', () => {
    expect(goalPriorityAudit(ruleset).slice(0, 6)).toEqual([]);
  });

  it('drops the sprint with a line when the only acceleration left is a high-CNS one', () => {
    // R44 leaves the day two high-CNS rows and the test and the maximal jump
    // have both, so a 30 m sprint cannot join them: R113's row goes with a
    // line and R112's jump stays.
    const plan = selectSession(climberPowerContext('accel_sprint_10m'));
    const rows = rowsOf(plan);
    expect(rows.some(({ row }) => row.movementPattern === 'sprint' && row.loadType !== 'mobility')).toBe(false);
    expect(rows.some(({ row }) => row.plyometric?.isMaximalJump === true)).toBe(true);
    expect(plan.trimmed).toContainEqual({
      exerciseId: 'sprint_30m',
      reason: 'No room for the acceleration sprint beside the jump work',
    });
  });

  it('makes the 5-day Speed day reactive without turning it into a maximal CNS day', () => {
    const bad: string[] = [];
    for (const entry of SWEEP) {
      for (const session of entry.week.sessions) {
        if (session.dayType !== 'speed') continue;
        if (session.isMaximalCns) bad.push(`${entry.label}: speed day is maximal CNS`);
        if (session.contacts.highIntensity >= 10) {
          bad.push(`${entry.label}: ${session.contacts.highIntensity} high-intensity contacts`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });
});

describe('every other sport is untouched', () => {
  it('builds the same basketball week it built before speed climbing', () => {
    const basketball = build({ ...baseAthlete(), targetDate: '2026-11-29' }, 7);
    expect(basketball.sessions.map((session) => session.dayType)).toEqual([
      'lower_strength',
      'upper_strength',
      'power_speed',
      'recovery_mobility',
    ]);
    for (const session of basketball.sessions) {
      expect(session.sessionIntent, session.dayType).toBeUndefined();
      expect(session.rntScheduled, session.dayType).toBe(false);
      for (const block of session.blocks) {
        for (const row of block.exercises) {
          expect(row.sideNote, row.exerciseId).toBeUndefined();
          expect(row.fingerNote, row.exerciseId).toBeUndefined();
        }
      }
    }
    expect(basketball.sessions.some((session) => session.blocks.some((b) => b.name === 'cod')))
      .toBe(true);
  });
});
