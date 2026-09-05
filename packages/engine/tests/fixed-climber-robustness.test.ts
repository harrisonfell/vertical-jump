/**
 * FIXED: the ROBUSTNESS lens over the speed-climbing athlete: the shapes the climbing
 * grid does not cover. An inventory with holes, a setting answered with zero,
 * a readiness test back at zero or below, a finger-pain answer on every
 * session rather than on the upper day alone, wall hours laid exactly over the
 * session window, and program lengths past the grid's 16 up to 30.
 *
 * Every case is a pure `materializeWeek` call on a fresh athlete and a fresh
 * history, so nothing depends on order and two runs are byte-identical.
 * Violations are collected against a key, the shape the grid uses.
 */
import { describe, expect, it } from 'vitest';
import { CONTACT_CAPS } from '../src/budgets.js';
import { addDays, diffDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { displayedRowCount } from '../src/select/order.js';
import { isCalfVolume } from '../src/select/sport.js';
import { PROGRAM_START, gridRuleset, gridSeed } from './grid.seed.js';
import { CLIMBING_INVENTORY, climbingAthlete } from './grid.climbing.js';
import type { Athlete, Inventory } from '../src/types/athlete.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type { MaterializeContext, MaterializeHistory, WeekPlan } from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
const climbing = ruleset.constants.climbing;
const DAY_COUNTS: DaysPerWeek[] = [4, 5];

/** Violations by key, so one pass over the fuzz answers every test below. */
const found: Record<string, string[]> = {};

function record(key: string, message: string): void {
  const list = found[key];
  if (list === undefined) found[key] = [message];
  else if (list.length < 20) list.push(message);
}

function clean(key: string): void {
  const list = found[key] ?? [];
  expect(list, list.slice(0, 5).join('\n')).toEqual([]);
}

function freshHistory(): MaterializeHistory {
  return {
    rotationHistory: {},
    ladderState: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
}

/** One fuzzed athlete plus the answers today carries. */
interface Case {
  label: string;
  athlete: Athlete;
  history: MaterializeHistory;
  /** Which session date is "today"; the week's first when absent. */
  today?: (dates: string[]) => string;
  fingerPain?: number;
}

function contextFor(entry: Case, w: number, today: string): MaterializeContext {
  return {
    athlete: entry.athlete,
    ruleset,
    exercises,
    ladders,
    skeleton: planSkeleton(entry.athlete, PROGRAM_START, ruleset),
    w,
    workingMaxes: [],
    history: entry.history,
    today,
    seed: 11,
  };
}

/** Week `w` for one athlete, with "today" on that week's first session. */
function build(athlete: Athlete, w: number): WeekPlan {
  const entry: Case = { label: 'one off', athlete, history: freshHistory() };
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const start = skeleton.weeks.find((week) => week.w === w)?.windowStart;
  return materializeWeek(contextFor(entry, w, start ?? PROGRAM_START));
}

/** Any non-finite number anywhere in the built week is a leak, not a plan. */
function nonFinite(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path}=${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => nonFinite(entry, `${path}[${String(index)}]`, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) nonFinite(entry, `${path}.${key}`, out);
  }
}

/** Per-session checks: caps, budgets, grip, and the no-sprint house rule. */
function checkSession(entry: Case, week: WeekPlan, index: number, today: string): void {
  const session = week.sessions[index];
  if (session === undefined) return;
  const where = `${entry.label} w${String(week.w)} ${session.dayType}`;
  const { highIntensity, highAmplitude } = session.contacts;
  const rows = displayedRowCount(session.blocks);
  if (highIntensity > CONTACT_CAPS.highIntensityPerSession) {
    record('R85', `${where}: ${String(highIntensity)}`);
  }
  if (highAmplitude > CONTACT_CAPS.highAmplitudePerSession) {
    record('R52', `${where}: ${String(highAmplitude)}`);
  }
  if (rows > 8) record('display_cap', `${where}: ${String(rows)}`);
  if (!Number.isFinite(session.estimatedMinutes) || session.estimatedMinutes <= 0) {
    record('minutes', `${where}: ${String(session.estimatedMinutes)}`);
  }

  let highCns = 0;
  const joints = { knee: 0, spine: 0, shoulder: 0 };
  for (const block of session.blocks) {
    if (block.name === 'cod' || block.name === 'conditioning') record('sc_no_conditioning', where);
    if (block.name === 'warm_up') continue;
    for (const row of block.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise === undefined) {
        record('seed', `${where}: ${row.exerciseId}`);
        continue;
      }
      if (exercise.cnsCost === 'high') highCns += 1;
      if (exercise.kneeStress === 'high') joints.knee += 1;
      if (exercise.spineStress === 'high') joints.spine += 1;
      if (exercise.shoulderStress === 'high') joints.shoulder += 1;
      if (exercise.isPulling && exercise.gripMode !== 'open_hand') {
        record('sc_open_hand', `${where}: ${row.exerciseId}`);
      }
      // No cut is ever prescribed (house); a prescribed sprint is 10 to 30 m
      // in the Power block, rested three minutes (R102, R104).
      const cuts = exercise.movementPattern === 'cod' || exercise.codCutsPerRep !== undefined;
      if (cuts) record('sc_no_cod', `${where}: ${row.exerciseId}`);
      const meters = exercise.sprintDistanceM ?? 0;
      const rest = Math.min(...row.sets.map((set) => set.restS));
      const sprint = exercise.movementPattern === 'sprint' && exercise.loadType !== 'mobility';
      if (sprint && (block.name !== 'power' || meters < 10 || meters > 30 || rest < 180)) {
        record('sc_sprint', `${where}: ${block.name} ${meters} m ${rest} s`);
      }
      for (const set of row.sets) {
        if (set.displayLoad.length === 0) record('R148', `${where}: ${row.exerciseId}`);
        if (set.reps !== undefined && set.reps < 1) {
          record('reps', `${where}: ${row.exerciseId} ${String(set.reps)}`);
        }
        if (set.restS < 0) record('rest', `${where}: ${row.exerciseId}`);
      }
    }
  }
  if (highCns > 2) record('R44', `${where}: ${String(highCns)}`);
  if (joints.knee > 2 || joints.spine > 2 || joints.shoulder > 2) {
    record('R23_R25', `${where}: ${JSON.stringify(joints)}`);
  }

  const ceiling = entry.athlete.fingerPainCeiling ?? climbing.fingerPainCeiling;
  if (
    session.fingerLoad === 'hard' &&
    session.date === today &&
    entry.fingerPain !== undefined &&
    entry.fingerPain > ceiling
  ) {
    record('sc_finger_pain', `${where}: pain ${String(entry.fingerPain)}`);
  }
  if (session.sessionIntent === 'upper_power' && session.isMaximalCns) {
    record('sc_upper_not_cns', where);
  }
}

/** Per-week checks: spacing, the RNT count, the calf cap, the weekly sessions. */
function checkWeek(entry: Case, week: WeekPlan, today: string): void {
  const at = `${entry.label} w${String(week.w)}`;
  const { athlete } = entry;
  const leaks: string[] = [];
  nonFinite(week, 'week', leaks);
  if (leaks.length > 0) record('finite', `${at}: ${leaks.slice(0, 3).join(' ')}`);
  week.sessions.forEach((_session, index) => checkSession(entry, week, index, today));

  const hard = week.sessions
    .filter((session) => session.fingerLoad === 'hard')
    .map((session) => session.date)
    .sort();
  for (let index = 1; index < hard.length; index += 1) {
    const gap = Math.abs(diffDays(hard[index - 1] ?? '', hard[index] ?? '')) * 24;
    if (gap < climbing.fingerSpacingHours) record('sc_finger_spacing', `${at}: ${String(gap)} h`);
  }

  // House `house.sc.rnt_valgus_control`: the count the athlete asked for,
  // capped by the sessions that can carry it. Only asserted where the pool can
  // supply the row at all, which needs bands.
  const control = athlete.valgusControl;
  if (athlete.inventory.bands && control !== undefined) {
    const eligible = week.sessions.filter((s) => s.dayType !== 'recovery_mobility').length;
    const wanted = Math.min(control.sessionsPerWeek, eligible);
    const scheduled = week.sessions.filter((session) => session.rntScheduled).length;
    if (scheduled !== wanted) {
      record('sc_rnt_count', `${at}: ${String(scheduled)} of ${String(wanted)}`);
    }
  }

  const calf = week.sessions.map((session) =>
    session.blocks
      .flatMap((block) => block.exercises)
      .reduce((total, row) => {
        const exercise = byId.get(row.exerciseId);
        return exercise !== undefined && isCalfVolume(exercise) ? total + row.sets.length : total;
      }, 0),
  );
  const days = calf.filter((sets) => sets > 0).length;
  const most = Math.max(0, ...calf);
  if (days > climbing.calfDaysPerWeek) record('sc_calf', `${at}: ${String(days)} days`);
  if (most > climbing.calfSetsCap) record('sc_calf', `${at}: ${String(most)} sets`);

  // House `house.sc.sport_requirements`, on a load week with a bar to pull on.
  if (week.kind === 'load' && athlete.inventory.pullupBar) {
    const upper = week.sessions.filter((s) => s.sessionIntent === 'upper_power').length;
    const jump = week.sessions.filter((s) =>
      ['power_speed', 'power', 'speed'].includes(s.dayType),
    ).length;
    if (upper < climbing.upperPowerSessionsPerWeek) {
      record('sc_weekly_sessions', `${at}: ${String(upper)} upper power`);
    }
    if (jump < climbing.jumpOrReactiveSessionsPerWeek) {
      record('sc_weekly_sessions', `${at}: ${String(jump)} jump`);
    }
  }
}

/** Wall hours laid over the session window, past it, and answered with junk. */
const WALL_CASES: { name: string; apply: (athlete: Athlete) => void }[] = [
  { name: 'no wall', apply: (a) => void delete a.wallWork },
  { name: 'wall weekdays empty', apply: (a) => { a.wallWork = { weekdays: [] }; } },
  { name: 'wall every day all day', apply: (a) => {
    a.wallWork = { weekdays: [0, 1, 2, 3, 4, 5, 6], typicalStart: '00:00', typicalEnd: '23:59' };
  } },
  { name: 'wall over the session window', apply: (a) => {
    a.wallWork = { weekdays: [1, 2, 3, 4, 5, 6], typicalStart: '17:00', typicalEnd: '19:00' };
    a.sessionWindow = { start: '17:00', end: '19:00' };
  } },
  { name: 'wall times unparseable', apply: (a) => {
    a.wallWork = { weekdays: [1, 2, 4, 6], typicalStart: 'evening', typicalEnd: '' };
    a.sessionWindow = { start: '', end: '99:99' };
  } },
];

/** Inventories with the holes the lens names. */
const INVENTORIES: [string, Inventory][] = [
  ['full', CLIMBING_INVENTORY],
  ['no hangboard', { ...CLIMBING_INVENTORY, hangboard: false }],
  ['no med ball', { ...CLIMBING_INVENTORY, medBall: false }],
  ['no med ball no hangboard', { ...CLIMBING_INVENTORY, medBall: false, hangboard: false }],
  ['no bands', { ...CLIMBING_INVENTORY, bands: false }],
  ['no boxes', { ...CLIMBING_INVENTORY, boxHeightsIn: [] }],
];

/** Settings answered with nothing, with null, and with zero. */
const TWEAKS: [string, (athlete: Athlete) => void][] = [
  ['weakerSide null', (a) => { a.weakerSide = null; }],
  ['weakerSide absent', (a) => void delete a.weakerSide],
  ['no readiness config', (a) => void delete a.readinessConfig],
  ['no valgus control', (a) => void delete a.valgusControl],
  ['no finger history', (a) => { delete a.fingerHistory; delete a.gripMode; }],
  ['no finger ceiling', (a) => void delete a.fingerPainCeiling],
  ['ceiling 0', (a) => { a.fingerPainCeiling = 0; }],
  ['ceiling 10', (a) => { a.fingerPainCeiling = 10; }],
  ['rnt gap 0', (a) => {
    a.valgusControl = { required: true, sessionsPerWeek: 2, minHoursFromWall: 0 };
    a.wallWork = { weekdays: [0, 1, 2, 3, 4, 5, 6] };
  }],
  ['rnt every session', (a) => {
    a.valgusControl = { required: true, sessionsPerWeek: 9, minHoursFromWall: 6 };
  }],
];

/** A climber at `days` a week whose program runs `W` weeks. */
function climber(days: DaysPerWeek, W: number): Athlete {
  const athlete = climbingAthlete(days);
  athlete.targetDate = addDays(PROGRAM_START, (W - 1) * 7);
  return athlete;
}

/** A day's two channels, where every throw came back at `best`. */
function throwsAt(date: string, best: number): MaterializeHistory['readinessToday'] {
  return {
    whoop: { date, score: best < 0 ? -5 : 50, band: null },
    test: { id: 'today', date, kind: 'seated_mb_throw', attempts: [best], best, unit: 'm' },
    history: [1, 2, 3, 4, 5].map((index) => ({
      id: `prior-${String(index)}`,
      date: addDays(date, -7 * index),
      kind: 'seated_mb_throw' as const,
      attempts: [best],
      best,
      unit: 'm',
    })),
  };
}

function* fuzzCases(): Generator<Case> {
  for (let W = 2; W <= 30; W += 1) {
    for (const days of DAY_COUNTS) {
      for (const wall of WALL_CASES) {
        const athlete = climber(days, W);
        wall.apply(athlete);
        const label = `W${String(W)}/d${String(days)}/${wall.name}`;
        yield { label, athlete, history: freshHistory() };
      }
    }
  }
  // A finger-pain answer on every session of the week, not the upper day alone.
  for (let pain = 0; pain <= 10; pain += 1) {
    for (const index of [0, 1, 2, 3, 4]) {
      for (const days of DAY_COUNTS) {
        yield {
          label: `pain ${String(pain)} on session ${String(index)}/d${String(days)}`,
          athlete: climber(days, 12),
          history: { ...freshHistory(), fingerPainToday: pain },
          today: (dates) => dates[index] ?? dates[0] ?? PROGRAM_START,
          fingerPain: pain,
        };
      }
    }
  }
  for (const [name, inventory] of INVENTORIES) {
    for (const days of DAY_COUNTS) {
      const athlete = climber(days, 12);
      athlete.inventory = inventory;
      yield { label: `${name}/d${String(days)}`, athlete, history: freshHistory() };
    }
  }
  for (const [name, apply] of TWEAKS) {
    for (const days of DAY_COUNTS) {
      const athlete = climber(days, 12);
      apply(athlete);
      const history = { ...freshHistory(), fingerPainToday: 5 };
      yield { label: `${name}/d${String(days)}`, athlete, history, fingerPain: 5 };
    }
  }
  // A readiness test that came back at zero, below zero, or absurd, plus one
  // stamped on a day the athlete does not train.
  for (const [name, best] of [
    ['zero', 0],
    ['negative', -2],
    ['huge', 1e9],
    ['tiny', 1e-9],
  ] as [string, number][]) {
    yield {
      label: `readiness ${name}`,
      athlete: climber(4, 12),
      history: { ...freshHistory(), readinessToday: throwsAt('2026-09-17', best) },
      today: () => '2026-09-17',
    };
  }
  yield {
    label: 'readiness on a rest day',
    athlete: climber(4, 12),
    history: { ...freshHistory(), readinessToday: throwsAt('2026-09-16', 7) },
    today: () => '2026-09-16',
  };
}

let programs = 0; let weeks = 0; let started = false;

function fuzz(): void {
  if (started) return;
  started = true;
  for (const entry of fuzzCases()) {
    programs += 1;
    for (const week of planSkeleton(entry.athlete, PROGRAM_START, ruleset).weeks) {
      const dates = week.sessions.map((session) => session.date);
      const today = entry.today?.(dates) ?? dates[0] ?? PROGRAM_START;
      let plan: WeekPlan;
      try {
        plan = materializeWeek(contextFor(entry, week.w, today));
      } catch (error) {
        record('throw', `${entry.label} w${String(week.w)}: ${String(error)}`);
        continue;
      }
      weeks += 1;
      checkWeek(entry, plan, today);
    }
  }
}

describe('robustness lens: the fuzzed speed climber', () => {
  it(
    'materializes every fuzzed week without throwing',
    () => {
      fuzz();
      expect(programs).toBeGreaterThan(300);
      expect(weeks).toBeGreaterThan(3000);
      clean('throw');
      clean('seed');
    },
    300000,
  );

  const cleans = (keys: string[]): void => {
    fuzz();
    for (const key of keys) clean(key);
  };

  it('never leaks a non-finite number, a zero-rep set or a negative rest', () =>
    cleans(['finite', 'reps', 'rest', 'minutes', 'R148']));

  it('holds the hard contact caps and the 8-row cap (R85, R52)', () =>
    cleans(['R85', 'R52', 'display_cap']));

  it('holds the CNS and joint budgets (R44, R23 to R25)', () => cleans(['R44', 'R23_R25']));

  it('keeps every pulling row open hand and every hard finger session 48 h apart', () =>
    cleans(['sc_open_hand', 'sc_finger_spacing']));

  it('takes hard finger work out on any session whose pain answer clears the ceiling', () =>
    cleans(['sc_finger_pain']));

  it('keeps the calf cap, the RNT count and the weekly sessions', () =>
    cleans(['sc_calf', 'sc_rnt_count', 'sc_weekly_sessions', 'sc_upper_not_cns']));

  it('never programs a cut or a conditioning block, and rests every sprint', () =>
    cleans(['sc_no_cod', 'sc_no_conditioning', 'sc_sprint']));

  it(
    'is deterministic: the same athlete and history build the same week twice',
    () => {
      for (const days of DAY_COUNTS) {
        for (const W of [2, 9, 12, 30]) {
          for (const [name, inventory] of INVENTORIES) {
            const one = climber(days, W);
            const two = climber(days, W);
            one.inventory = inventory;
            two.inventory = inventory;
            const w = Math.min(W, 7);
            const first = JSON.stringify(build(one, w));
            const second = JSON.stringify(build(two, w));
            expect(second, `${name} d${String(days)} W${String(W)}`).toBe(first);
          }
        }
      }
    },
    120000,
  );

  it('reads a zero in the RNT settings as zero, not as unanswered', () => {
    // House `house.sc.rnt_valgus_control` reads both numbers off the athlete.
    // A gap of 0 says the wall needs no spacing, so no session is "inside the
    // gap" and no line may say it is; a count of 0 asks for no rows at all.
    const gapZero = climber(4, 12);
    gapZero.valgusControl = { required: true, sessionsPerWeek: 2, minHoursFromWall: 0 };
    gapZero.wallWork = { weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const gapWeek = build(gapZero, 2);
    const wallLines = [
      ...gapWeek.lines,
      ...gapWeek.sessions.flatMap((session) => session.notices),
    ].filter((line) => line.includes('wall'));
    expect(wallLines, 'minHoursFromWall 0').toEqual([]);

    const countZero = climber(4, 12);
    countZero.valgusControl = { required: true, sessionsPerWeek: 0, minHoursFromWall: 6 };
    const scheduled = build(countZero, 2).sessions.filter((s) => s.rntScheduled).length;
    expect(scheduled, 'sessionsPerWeek 0').toBe(0);
  });

  it('never claims a house rule the week did not apply', () => {
    // `houseRuleIdsFor` promises the ids are "read off the built week, never
    // guessed". With no bands the seed has no RNT row to place, so the week
    // applied nothing and the Plan may not list the rule.
    const athlete = climber(4, 12);
    athlete.inventory = { ...CLIMBING_INVENTORY, bands: false };
    const week = build(athlete, 2);
    expect(week.sessions.filter((session) => session.rntScheduled)).toEqual([]);
    expect(week.houseRuleIds ?? []).not.toContain('house.sc.rnt_valgus_control');
  });

  it('keeps the upper-power session when there is no med ball to throw', () => {
    const athlete = climber(4, 12);
    athlete.inventory = { ...CLIMBING_INVENTORY, medBall: false };
    for (const w of [2, 7]) {
      const upper = build(athlete, w).sessions.filter((s) => s.sessionIntent === 'upper_power');
      expect(upper.length, `w${String(w)}`).toBeGreaterThanOrEqual(
        climbing.upperPowerSessionsPerWeek,
      );
      const velocity = upper.flatMap((session) =>
        session.blocks
          .filter((block) => block.name !== 'warm_up' && block.name !== 'cool_down')
          .flatMap((block) => block.exercises)
          .filter((row) => byId.get(row.exerciseId)?.intent === 'velocity'),
      );
      expect(velocity.length, `w${String(w)} velocity rows`).toBeGreaterThan(0);
    }
  });
});
