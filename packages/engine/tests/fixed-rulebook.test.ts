/**
 * Adversarial lens: rule-book fidelity. Throwaway. Every test here tries to
 * refute the claim that the engine honours a numbered rule.
 */
import { describe, expect, it } from 'vitest';
import { build, freshHistory } from './invariants.support.js';
import {
  BARE_INVENTORY,
  FULL_INVENTORY,
  LEVELS,
  PROGRAM_START,
  WEEKDAYS,
  baseAthlete,
} from './grid.support.js';
import { gridRuleset, gridSeed } from './grid.seed.js';
import { getPerSetPrescription } from '../src/prescribe/index.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { materializeWeek } from '../src/materialize.js';
import type { Athlete } from '../src/types/athlete.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type { Exercise } from '../src/types/exercise.js';
import type { MaterializeContext, SessionPlan, WeekPlan } from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = new Map<string, Exercise>(exercises.map((entry) => [entry.id, entry]));

function weeksFor(athlete: Athlete, count: number): WeekPlan[] {
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const out: WeekPlan[] = [];
  for (let w = 1; w <= Math.min(count, skeleton.W); w += 1) {
    const context: MaterializeContext = {
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w,
      workingMaxes: [],
      history: freshHistory(),
      today: skeleton.weeks.find((entry) => entry.w === w)?.windowStart ?? PROGRAM_START,
      seed: 11,
    };
    out.push(materializeWeek(context));
  }
  return out;
}

function rowsOf(session: SessionPlan, includeGrouped = false): { block: string; row: Exercise }[] {
  const out: { block: string; row: Exercise }[] = [];
  for (const block of session.blocks) {
    if (!includeGrouped && (block.name === 'warm_up' || block.name === 'cool_down')) continue;
    for (const row of block.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise !== undefined) out.push({ block: block.name, row: exercise });
    }
  }
  return out;
}

/** A representative sweep: 4 program lengths x 4 day counts x 3 levels. */
function sweep(): { label: string; weeks: WeekPlan[] }[] {
  const out: { label: string; weeks: WeekPlan[] }[] = [];
  for (const W of [6, 12]) {
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        const athlete: Athlete = {
          ...baseAthlete(),
          level,
          trainingAge,
          daysPerWeek: days,
          weekdays: WEEKDAYS[days],
          targetDate: addWeeks(PROGRAM_START, W - 1),
        };
        out.push({ label: `W${W}/d${days}/${level}`, weeks: weeksFor(athlete, W) });
      }
    }
  }
  return out;
}

function addWeeks(date: string, weeks: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + weeks * 7 * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe('lens: Block 6 set numbering (R148, R157)', () => {
  it('a 7-set heavy protocol numbers every set once', () => {
    const athlete: Athlete = { ...baseAthlete(), level: 'advanced', trainingAge: '4plus' };
    const squat = byId.get('back_squat');
    expect(squat).toBeDefined();
    if (squat === undefined) return;
    const rows = getPerSetPrescription(squat, athlete, {
      w: 3,
      kind: 'load',
      blockType: 'strength',
      k: 2,
      targets: {
        extensiveBottom: 80,
        extensiveTop: 120,
        highIntensityAllowance: 15,
        depthJumpReps: 0,
        startOffsetPct: {},
        mainLiftBySlot: { lower: 'back_squat', upper: 'db_bench_press', fullbody: 'back_squat' },
        accessoryRotationSlot: 0,
        ladderRungs: {},
        tendonMode: 'slow_resistance',
      },
      isFirstProgramWeek1: false,
      isFirstPercentWeekForLift: false,
      sets: 7,
      ruleset,
      role: 'main_lift',
      percentWeekIndexForLift: 3,
      workingMax: {
        lift: 'back_squat',
        valueKg: 124.738,
        source: 'entered',
        confidence: 1,
        frozenAt: '2026-09-07T03:00:00.000Z',
        failStreak: 0,
      },
    });
    const numbers = rows.map((row) => row.setNumber);
    expect(rows).toHaveLength(7);
    expect(new Set(numbers).size, `set numbers were ${numbers.join(',')}`).toBe(7);
  });
});

describe('lens: R116 and R117 session-intent majorities', () => {
  it('a strength day is at least half strength-intent exercises', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          if (!['full_body_strength', 'lower_strength', 'upper_strength'].includes(session.dayType)) {
            continue;
          }
          const rows = rowsOf(session);
          if (rows.length === 0) continue;
          const strength = rows.filter((row) => row.row.intent === 'strength').length;
          if (strength * 2 < rows.length) {
            bad.push(
              `${entry.label} w${week.w} ${session.dayType}: ${strength}/${rows.length} [${rows
                .map((row) => `${row.row.id}:${row.row.intent}`)
                .join(' ')}]`,
            );
          }
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('a power day is at least half velocity or elastic intent', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          if (!['power_speed', 'power', 'speed'].includes(session.dayType)) continue;
          const rows = rowsOf(session);
          if (rows.length === 0) continue;
          const fast = rows.filter(
            (row) => row.row.intent === 'velocity' || row.row.intent === 'elastic',
          ).length;
          if (fast * 2 < rows.length) {
            bad.push(
              `${entry.label} w${week.w} ${session.dayType}: ${fast}/${rows.length} [${rows
                .map((row) => `${row.row.id}:${row.row.intent}`)
                .join(' ')}]`,
            );
          }
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('a recovery day is at least 70 percent mobility or low-fatigue and has no high-CNS row (R118, R119)', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          if (session.dayType !== 'recovery_mobility') continue;
          const rows = rowsOf(session);
          if (rows.length === 0) continue;
          const soft = rows.filter(
            (row) => row.row.intent === 'mobility' || row.row.intent === 'low_fatigue',
          ).length;
          if (soft * 10 < rows.length * 7) {
            bad.push(`${entry.label} w${week.w} R118: ${soft}/${rows.length}`);
          }
          const highCns = rows.filter((row) => row.row.cnsCost === 'high');
          if (highCns.length > 0) {
            bad.push(`${entry.label} w${week.w} R119: ${highCns.map((r) => r.row.id).join(',')}`);
          }
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });
});

describe('lens: Block 4 rep bands (R61 to R66)', () => {
  it('every loadable rep row sits inside its load type band', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          for (const block of session.blocks) {
            for (const row of block.exercises) {
              const scheme = ruleset.constants.schemes[row.loadType];
              const band = scheme.reps;
              if (band === null || band === undefined) continue;
              const exercise = byId.get(row.exerciseId);
              if (exercise === undefined || !exercise.loadable) continue;
              if (exercise.displayMode !== 'reps') continue;
              for (const set of row.sets) {
                if (set.reps === undefined || set.isRamp) continue;
                if (set.reps < band.bottom || set.reps > band.top) {
                  bad.push(
                    `${entry.label} w${week.w} ${session.dayType} ${row.exerciseId} ${row.loadType} set ${set.setNumber} reps ${set.reps} outside ${band.bottom}-${band.top}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('lens: R29 warm-up shape', () => {
  it('every session opens on a warm-up of 2 to 4 movements', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          const first = session.blocks[0];
          if (first === undefined || first.name !== 'warm_up') {
            bad.push(`${entry.label} w${week.w} ${session.dayType}: first block ${first?.name}`);
            continue;
          }
          const n = first.exercises.length;
          if (n < ruleset.constants.warmUp.movementsMin || n > ruleset.constants.warmUp.movementsMax) {
            bad.push(`${entry.label} w${week.w} ${session.dayType}: warm-up has ${n}`);
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('lens: R99 tendon work every week', () => {
  it('every week carries a tendon exercise in a counted block', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        const found = week.sessions.some((session) =>
          rowsOf(session).some((row) => row.row.tendonTarget !== undefined),
        );
        if (!found) bad.push(`${entry.label} w${week.w} ${week.kind}`);
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('lens: R26 weekly joint budget', () => {
  it('after 4 or more high-stress rows for one joint, the next week halves them', () => {
    const athlete: Athlete = { ...baseAthlete(), daysPerWeek: 4, weekdays: WEEKDAYS[4] };
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const history = freshHistory();
    history.jointHighStressLastWeek = { knee: 8, spine: 8, shoulder: 8 };
    const week = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 2,
      workingMaxes: [],
      history,
      today: skeleton.weeks[1]?.windowStart ?? PROGRAM_START,
      seed: 11,
    });
    let knee = 0;
    for (const session of week.sessions) {
      for (const row of rowsOf(session)) if (row.row.kneeStress === 'high') knee += 1;
    }
    // Last week ran 8; R26 wants at least a 50 percent cut, so 4 or fewer.
    expect(knee, `knee-high rows this week: ${knee}`).toBeLessThanOrEqual(4);
  });
});

describe('lens: R137 to R140 sport requirements', () => {
  it('basketball gets a jump session and a change-of-direction session', () => {
    const athlete: Athlete = { ...baseAthlete(), sport: 'basketball' };
    const [week] = weeksFor(athlete, 1);
    expect(week).toBeDefined();
    if (week === undefined) return;
    const cod = week.sessions.some((session) =>
      rowsOf(session).some((row) => (row.row.codCutsPerRep ?? 0) > 0),
    );
    expect(cod).toBe(true);
  });

  it('football gets an acceleration session (R138)', () => {
    const athlete: Athlete = { ...baseAthlete(), sport: 'football' };
    const [week] = weeksFor(athlete, 1);
    expect(week).toBeDefined();
    if (week === undefined) return;
    const accel = week.sessions.some((session) =>
      rowsOf(session).some(
        (row) => row.row.sprintDistanceM !== undefined && row.row.sprintDistanceM <= 30,
      ),
    );
    expect(accel, 'no sprint at or under 30 m anywhere in the week').toBe(true);
  });

  it('track and field gets a max-velocity sprint session (R140)', () => {
    const athlete: Athlete = { ...baseAthlete(), sport: 'track_field' };
    const [week] = weeksFor(athlete, 1);
    expect(week).toBeDefined();
    if (week === undefined) return;
    const maxV = week.sessions.some((session) =>
      rowsOf(session).some(
        (row) => row.row.sprintDistanceM !== undefined && row.row.sprintDistanceM >= 40,
      ),
    );
    expect(maxV, 'no sprint at or over 40 m anywhere in the week').toBe(true);
  });

  it('soccer gets a change-of-direction session (R139)', () => {
    const athlete: Athlete = { ...baseAthlete(), sport: 'soccer' };
    const [week] = weeksFor(athlete, 1);
    expect(week).toBeDefined();
    if (week === undefined) return;
    const cod = week.sessions.some((session) =>
      rowsOf(session).some((row) => (row.row.codCutsPerRep ?? 0) > 0),
    );
    expect(cod).toBe(true);
  });
});

describe('lens: R90, R91 and R93 across the generated calendar', () => {
  it('two maximal CNS sessions never sit on consecutive calendar days', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        const maximal = week.sessions.filter((session) => session.isMaximalCns);
        for (let a = 0; a < maximal.length; a += 1) {
          for (let b = a + 1; b < maximal.length; b += 1) {
            const first = maximal[a];
            const second = maximal[b];
            if (first === undefined || second === undefined) continue;
            const gap = Math.abs(
              (Date.parse(`${second.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) /
                86400000,
            );
            if (gap < 2) {
              bad.push(`${entry.label} w${week.w}: ${first.dayType} ${first.date} / ${second.dayType} ${second.date}`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('week 1 of a first program has exactly one maximal CNS session (R92)', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      const week = entry.weeks[0];
      if (week === undefined) continue;
      const count = week.sessions.filter((session) => session.isMaximalCns).length;
      if (count > 1) bad.push(`${entry.label}: ${count}`);
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('lens: R57 rotation', () => {
  it('the main lift never changes inside a block', () => {
    const athlete: Athlete = { ...baseAthlete(), targetDate: addWeeks(PROGRAM_START, 11) };
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const seen = new Map<string, Set<string>>();
    for (let w = 1; w <= skeleton.W; w += 1) {
      const rotationHistory: Record<string, number[]> = {};
      for (let prior = 1; prior < w; prior += 1) {
        for (const id of ['back_squat', 'db_bench_press']) {
          rotationHistory[id] = [...(rotationHistory[id] ?? []), prior];
        }
      }
      const history = freshHistory();
      history.rotationHistory = rotationHistory;
      const week = materializeWeek({
        athlete,
        ruleset,
        exercises,
        ladders,
        skeleton,
        w,
        workingMaxes: [],
        history,
        today: skeleton.weeks.find((entry) => entry.w === w)?.windowStart ?? PROGRAM_START,
        seed: 11,
      });
      const block = skeleton.blocks.find((entry) => w >= entry.weekFrom && w <= entry.weekTo);
      const key = `${block?.type}:${block?.weekFrom}`;
      for (const session of week.sessions) {
        for (const sessionBlock of session.blocks) {
          if (sessionBlock.name !== 'main_lift') continue;
          const row = sessionBlock.exercises[0];
          if (row === undefined) continue;
          const set = seen.get(`${key}:${session.dayType}`) ?? new Set<string>();
          set.add(row.exerciseId);
          seen.set(`${key}:${session.dayType}`, set);
        }
      }
    }
    const changed = [...seen.entries()].filter(([, ids]) => ids.size > 1);
    expect(changed.map(([key, ids]) => `${key}: ${[...ids].join(',')}`)).toEqual([]);
  });
});

describe('lens: checklist page 11', () => {
  it('no displayed row shows a rep or load range', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          for (const block of session.blocks) {
            for (const row of block.exercises) {
              for (const set of row.sets) {
                if (/\bto\b|–|—/.test(set.displayLoad)) {
                  bad.push(`${entry.label} ${row.exerciseId}: "${set.displayLoad}"`);
                }
              }
            }
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('a distance row never shows a duration and a time row never shows distance', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          for (const block of session.blocks) {
            for (const row of block.exercises) {
              const exercise = byId.get(row.exerciseId);
              if (exercise === undefined) continue;
              for (const set of row.sets) {
                if (exercise.displayMode === 'distance' && set.durationS !== undefined) {
                  bad.push(`${row.exerciseId} distance + duration`);
                }
                if (exercise.displayMode === 'time' && set.distanceM !== undefined) {
                  bad.push(`${row.exerciseId} time + distance`);
                }
                if (exercise.displayMode === 'reps' && set.distanceM !== undefined) {
                  bad.push(`${row.exerciseId} reps + distance`);
                }
              }
            }
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('set numbers are unique inside every prescribed row', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          for (const block of session.blocks) {
            for (const row of block.exercises) {
              const numbers = row.sets.map((set) => set.setNumber);
              if (new Set(numbers).size !== numbers.length) {
                bad.push(`${entry.label} ${row.exerciseId}: ${numbers.join(',')}`);
              }
            }
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('lens: R47 to R50 pairings actually hold in the output', () => {
  it('a push is always paired with a pull, and a bilateral lower with a unilateral', () => {
    const bad: string[] = [];
    for (const entry of sweep()) {
      for (const week of entry.weeks) {
        for (const session of week.sessions) {
          if (session.dayType === 'recovery_mobility') continue;
          const rows = rowsOf(session).map((row) => row.row);
          const push = rows.some((e) => e.isPush);
          const pull = rows.some((e) => e.isPull);
          if (push && !pull) bad.push(`${entry.label} w${week.w} ${session.dayType}: R48 push without pull`);
          const lower = ['squat', 'hinge', 'lunge'];
          const bilateral = rows.some((e) => !e.unilateral && lower.includes(e.movementPattern));
          const unilateral = rows.some((e) => e.unilateral && lower.includes(e.movementPattern));
          if (bilateral && !unilateral) {
            bad.push(`${entry.label} w${week.w} ${session.dayType}: R121 bilateral squat pattern without a unilateral leg exercise`);
          }
          // R50 counts every movement in the session, warm-up included.
          const all = rowsOf(session, true).map((row) => row.row);
          const sagittal = all.some((e) => e.plane === 'sagittal');
          const other = all.some((e) => e.plane !== 'sagittal');
          if (sagittal && !other) {
            bad.push(`${entry.label} w${week.w} ${session.dayType}: R50 sagittal only`);
          }
          if (session.notices.some((n) => n.startsWith('Could not fit a frontal')) && other) {
            bad.push(`${entry.label} w${week.w} ${session.dayType}: R50 reported unmet although the session already has a non-sagittal movement`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('lens: R19 and R46 with a bare inventory', () => {
  it('a bare kit still builds every week and never shows barbell work', () => {
    const athlete: Athlete = {
      ...baseAthlete(),
      inventory: BARE_INVENTORY,
      targetDate: addWeeks(PROGRAM_START, 11),
    };
    const weeks = weeksFor(athlete, 12);
    const bad: string[] = [];
    for (const week of weeks) {
      for (const session of week.sessions) {
        for (const row of rowsOf(session, true)) {
          if (row.row.requiresBarbell) bad.push(`w${week.w} ${row.row.id}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(FULL_INVENTORY.barbell).toBe(true);
  });
});

describe('lens: R105 deload against the prior load week', () => {
  it('a deload week keeps at most half the prior week counted contacts', () => {
    const athlete: Athlete = { ...baseAthlete(), targetDate: addWeeks(PROGRAM_START, 11) };
    const weeks = weeksFor(athlete, 12);
    const bad: string[] = [];
    for (let index = 1; index < weeks.length; index += 1) {
      const week = weeks[index];
      const previous = weeks[index - 1];
      if (week === undefined || previous === undefined) continue;
      if (week.kind !== 'deload') continue;
      const total = (plan: WeekPlan): number =>
        plan.sessions.reduce(
          (sum, session) => sum + session.contacts.extensive + session.contacts.highIntensity,
          0,
        );
      const now = total(week);
      const before = total(previous);
      if (now > before * 0.5 + 0.001) bad.push(`w${week.w}: ${now} vs ${before}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('lens: R27 soreness', () => {
  it('soreness 7 on the test day defers the test', () => {
    const athlete = baseAthlete();
    const plain = build(athlete, 8);
    const testDayPlain = plain.sessions.find((session) => session.isTestDay);
    expect(testDayPlain).toBeDefined();
    if (testDayPlain === undefined) return;
    const history = freshHistory();
    history.sorenessToday = 8;
    const sore = build(athlete, 8, { history, today: testDayPlain.date });
    // The scheduled test day is read by date: a deferral hands the isTestDay
    // flag and the block to the session that now runs the test, so exactly one
    // session in the week is flagged.
    const testDaySore = sore.sessions.find((session) => session.date === testDayPlain.date);
    expect(testDaySore?.testStatus).toBe('deferred');
  });
});

describe('lens: Block 1 volume cuts (R4, R8, R9, R18)', () => {
  function withPain(location: 'knee' | 'shin' | 'achilles_calf', raw: '1-2' | '3-4', severity: 'mild' | 'moderate'): Athlete {
    return {
      ...baseAthlete(),
      painStatus: [
        {
          location,
          severityRaw: raw,
          severity,
          duration: 'chronic',
          durationWeeks: 20,
          reportedAt: PROGRAM_START,
          reassessDueAt: '2026-09-21',
        },
      ],
    };
  }

  function powerDay(athlete: Athlete): SessionPlan | undefined {
    const week = build(athlete, 8);
    return week.sessions.find((session) => session.dayType === 'power_speed');
  }

  function reps(session: SessionPlan, predicate: (exercise: Exercise) => boolean): number {
    let total = 0;
    for (const block of session.blocks) {
      for (const row of block.exercises) {
        const exercise = byId.get(row.exerciseId);
        if (exercise === undefined || !predicate(exercise)) continue;
        for (const set of row.sets) total += set.reps ?? 1;
      }
    }
    return total;
  }

  const isPogo = (exercise: Exercise): boolean => exercise.id === 'pogo_hops';
  const isSprint = (exercise: Exercise): boolean =>
    exercise.movementPattern === 'sprint' || exercise.movementPattern === 'cod';

  it('moderate knee pain halves the high-intensity contact budget (R4)', () => {
    const base = powerDay(baseAthlete());
    const sore = powerDay(withPain('knee', '3-4', 'moderate'));
    expect(base).toBeDefined();
    expect(sore).toBeDefined();
    if (base === undefined || sore === undefined) return;
    expect(
      sore.contacts.highIntensity,
      `base ${base.contacts.highIntensity}, moderate knee ${sore.contacts.highIntensity}`,
    ).toBeLessThanOrEqual(Math.floor(base.contacts.highIntensity / 2));
  });

  it('mild shin pain cuts pogo and sprint volume by a quarter (R9)', () => {
    const base = powerDay(baseAthlete());
    const shin = powerDay(withPain('shin', '1-2', 'mild'));
    expect(base).toBeDefined();
    expect(shin).toBeDefined();
    if (base === undefined || shin === undefined) return;
    const before = reps(base, isPogo) + reps(base, isSprint);
    const after = reps(shin, isPogo) + reps(shin, isSprint);
    expect(after, `pogo+sprint reps ${before} -> ${after}`).toBeLessThanOrEqual(before * 0.75);
  });

  it('moderate shin pain cuts pogo and sprint volume by half (R8)', () => {
    const base = powerDay(baseAthlete());
    const shin = powerDay(withPain('shin', '3-4', 'moderate'));
    expect(base).toBeDefined();
    expect(shin).toBeDefined();
    if (base === undefined || shin === undefined) return;
    const before = reps(base, isPogo) + reps(base, isSprint);
    const after = reps(shin, isPogo) + reps(shin, isSprint);
    expect(after, `pogo+sprint reps ${before} -> ${after}`).toBeLessThanOrEqual(before * 0.5);
  });

  it('mild Achilles pain drops plyometric intensity one tier (R18)', () => {
    const base = powerDay(baseAthlete());
    const achilles = powerDay(withPain('achilles_calf', '1-2', 'mild'));
    expect(base).toBeDefined();
    expect(achilles).toBeDefined();
    if (base === undefined || achilles === undefined) return;
    const intensive = (session: SessionPlan): number =>
      rowsOf(session).filter((row) => row.row.plyometric?.intensity === 'high').length;
    expect(
      intensive(achilles),
      `high-intensity plyo rows ${intensive(base)} -> ${intensive(achilles)}; the notice claims a tier drop`,
    ).toBeLessThan(Math.max(1, intensive(base)));
  });
});
