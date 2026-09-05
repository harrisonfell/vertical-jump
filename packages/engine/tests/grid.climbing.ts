/**
 * The speed-climbing face of the invariant grid.
 *
 * It runs the same one-pass shape as `grid.support.ts`: every week is checked
 * as it is generated and only violations are kept, so the whole space is
 * covered without holding thousands of `WeekPlan`s in memory. `checkSession`
 * is the same function the basketball grid uses, so every existing invariant
 * (contacts, caps, the held-set rule, the rep descent, the 8-row cap, the
 * two-high-CNS cap, the joint budgets, the load grid) is asserted here too;
 * the climbing checks below are added on top of it.
 *
 * Axes (all reported in `GridReport.sampled`): program lengths 2 to 16, four
 * and five training days, six wall-work patterns (none; Monday, Wednesday and
 * Friday evenings; every evening; and the owner's own Tuesday, Thursday and
 * Sunday, alone and with a Friday or a Saturday added), gym picks with and
 * without a climbing weekday among them, a hangboard present or absent, the
 * finger-pain answer 0 to 10, and all five readiness states.
 */
import { addDays, diffDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import {
  farFromWall,
  isCalfVolume,
  sameDayGapHoursFor,
  sportRequirementsFor,
  wallFingerVerdict,
} from '../src/select/sport.js';
import { canCarryHardFinger, wallPlacementFor } from '../src/skeleton/climbing.js';
import { PROGRAM_START, gridRuleset, gridSeed } from './grid.seed.js';
import { checkSession, record, type GridReport } from './grid.checks.js';

export * from './grid.climbing.axes.js';
import {
  CLIMBING_INVENTORY,
  MORNING_WINDOW,
  PICK_CASES,
  WALL_CASES,
  climbingAthlete,
} from './grid.climbing.axes.js';
import type { Athlete } from '../src/types/athlete.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type { MaterializeContext, MaterializeHistory, WeekPlan } from '../src/types/plan.js';
import type { ReadinessState, ReadinessTestSession } from '../src/types/readiness.js';

const ruleset = gridRuleset;
const seeded = gridSeed;
const climbing = ruleset.constants.climbing;
const byId = new Map(seeded.exercises.map((exercise) => [exercise.id, exercise]));

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

/** Prior throws that put today's number wherever the state needs it. */
function throwHistory(upTo: string): ReadinessTestSession[] {
  return [0, 1, 2, 3].map((index) => ({
    id: `throw-${index}`,
    date: addDays(upTo, -7 * (index + 1)),
    kind: 'seated_mb_throw' as const,
    attempts: [6.9, 7.0, 7.1],
    best: 7.1,
    unit: 'm',
  }));
}

/** The two channels that produce one named state on `date`. */
export function readinessInputFor(
  state: ReadinessState,
  date: string,
): MaterializeHistory['readinessToday'] {
  const history = throwHistory(date);
  const good = { id: 'today', date, kind: 'seated_mb_throw' as const, attempts: [7.0, 7.1, 7.05], best: 7.1, unit: 'm' };
  const poor = { ...good, attempts: [6.0, 6.1, 6.2], best: 6.2 };
  const high = { date, score: 72, band: 'high' as const };
  const low = { date, score: 28, band: 'low' as const };
  switch (state) {
    case 'both_high':
      return { whoop: high, test: good, history };
    case 'autonomic_low':
      return { whoop: low, test: good, history };
    case 'neuromuscular_low':
      return { whoop: high, test: poor, history };
    case 'both_low':
      return { whoop: low, test: poor, history };
    case 'unknown':
      return { whoop: null, test: null, history };
  }
}

/** One climbing case: an athlete, a label, and the day's extra answers. */
interface Case {
  athlete: Athlete;
  label: string;
  /** Weeks to materialize; every week when absent. */
  weeks?: number[];
  fingerPainToday?: number;
  readinessState?: ReadinessState;
}

/** House `house.sc.calf_volume_low`: the rows the cap counts. */
function calfSets(week: WeekPlan): { days: number; maxSets: number } {
  let days = 0;
  let maxSets = 0;
  for (const session of week.sessions) {
    let sets = 0;
    for (const block of session.blocks) {
      for (const row of block.exercises) {
        const exercise = byId.get(row.exerciseId);
        if (exercise !== undefined && isCalfVolume(exercise)) sets += row.sets.length;
      }
    }
    if (sets > 0) days += 1;
    maxSets = Math.max(maxSets, sets);
  }
  return { days, maxSets };
}

/** Every climbing invariant that reads a whole week. */
function checkClimbingWeek(
  report: GridReport,
  week: WeekPlan,
  entry: Case,
  context: MaterializeContext,
): void {
  const { athlete } = entry;
  const at = `${entry.label} w${week.w}`;
  const requirements = sportRequirementsFor(athlete.sport, ruleset);

  let jumpOrReactive = 0;
  let upperPower = 0;
  const hardFingerDates: string[] = [];
  let rntSessions = 0;

  for (const session of week.sessions) {
    checkSession(report, session, week, context, entry.label, byId);
    const rows = session.blocks.flatMap((block) => block.exercises);

    if (session.blocks.some((block) => block.name === 'cod' || block.name === 'conditioning')) {
      record(report, 'sc_no_conditioning', `${at} ${session.dayType}`);
    }
    // The warm-up's A-skip is a sprint-pattern drill and always was: what the
    // rules below read is a prescribed row, never a mobility one.
    const prescribed = session.blocks
      .filter((block) => block.name !== 'warm_up' && block.name !== 'cool_down')
      .flatMap((block) => block.exercises.map((row) => ({ block: block.name, row })));
    let sprints = 0;
    for (const { block, row } of prescribed) {
      const exercise = byId.get(row.exerciseId);
      if (exercise === undefined) continue;
      // Cutting is not part of this sport, so no cut is ever prescribed.
      if (exercise.movementPattern === 'cod' || exercise.codCutsPerRep !== undefined) {
        record(report, 'sc_no_cod', `${at}: ${row.exerciseId}`);
      }
      // An A-skip is a sprint pattern walked through as mobility, never a rep.
      if (exercise.movementPattern !== 'sprint' || exercise.loadType === 'mobility') continue;
      // R102: 10 to 30 m acceleration work, in the Power block (R38), with
      // R104's three minutes of rest, and one row of it, not two.
      sprints += 1;
      const meters = exercise.sprintDistanceM ?? 0;
      if (block !== 'power') record(report, 'sc_sprint_block', `${at}: ${block}`);
      if (meters < 10 || meters > 30) record(report, 'sc_sprint_class', `${at}: ${meters} m`);
      for (const set of row.sets) {
        if (set.restS < 180) record(report, 'sc_sprint_rest', `${at}: ${set.restS} s`);
      }
    }
    const isPowerDay =
      session.dayType === 'power_speed' || session.dayType === 'power' || session.dayType === 'speed';
    if (isPowerDay && week.kind === 'load' && sprints !== 1) {
      record(report, 'sc_sprint_present', `${at}: ${sprints} sprints`);
    }
    if (!isPowerDay && sprints > 0) {
      record(report, 'sc_sprint_present', `${at}: ${sprints} sprints off a Power day`);
    }
    for (const row of rows) {
      const exercise = byId.get(row.exerciseId);
      if (exercise === undefined) continue;
      // House `house.sc.open_hand_grip`.
      if (exercise.isPulling && exercise.gripMode !== 'open_hand') {
        record(report, 'sc_open_hand', `${at}: ${row.exerciseId} ${String(exercise.gripMode)}`);
      }
      // House `house.sc.weaker_side_first`.
      if (exercise.unilateral && row.sideNote !== `Weaker side first: ${String(athlete.weakerSide)}`) {
        record(report, 'sc_weaker_side', `${at}: ${row.exerciseId}`);
      }
    }

    if (session.fingerLoad === 'hard') {
      hardFingerDates.push(session.date);
      // House `house.sc.hard_finger_spacing`, the wall included: a hard finger
      // session may only sit on a climbing day with the same-day gap kept, or
      // on a day 48 h clear of every climbing day.
      const verdict = wallFingerVerdict(
        session.date,
        athlete,
        climbing.fingerSpacingHours,
        sameDayGapHoursFor(athlete, ruleset),
      );
      if (!verdict.ok) {
        record(report, 'sc_wall_finger', `${at} ${session.date}: ${verdict.blockedBy?.label ?? ''}`);
      }
      // House `house.sc.finger_pain_ceiling`: over the ceiling, today carries
      // no hard finger work at all.
      const ceiling = athlete.fingerPainCeiling ?? climbing.fingerPainCeiling;
      if (
        session.date === context.today &&
        entry.fingerPainToday !== undefined &&
        entry.fingerPainToday > ceiling
      ) {
        record(report, 'sc_finger_pain', `${at}: pain ${entry.fingerPainToday}`);
      }
    }
    if (session.rntScheduled) {
      rntSessions += 1;
      const gap = athlete.valgusControl?.minHoursFromWall ?? climbing.rntWallGapHours;
      // House `house.sc.rnt_valgus_control`: a row inside the wall gap is only
      // legal when the week had nowhere else to put it, and then it says so.
      if (!farFromWall(session.date, athlete, gap) && week.sessions.every((other) =>
        other.rntScheduled || other.dayType === 'recovery_mobility'
          ? true
          : !farFromWall(other.date, athlete, gap))) {
        // Forced placement: every other candidate was inside the gap too.
      } else if (!farFromWall(session.date, athlete, gap)) {
        record(report, 'sc_rnt_wall_gap', `${at} ${session.date}`);
      }
    }
    if (session.dayType === 'power_speed' || session.dayType === 'power' || session.dayType === 'speed') {
      jumpOrReactive += 1;
    }
    if (session.sessionIntent === 'upper_power') {
      upperPower += 1;
      // House `house.sc.sport_requirements`: the upper-power day is the week's
      // hard finger session, so it lands on a day that can carry one whenever
      // the athlete's picks allow it at all.
      const wall = wallPlacementFor(athlete, ruleset);
      if (wall !== undefined) {
        const eligible = athlete.weekdays.filter((weekday) => canCarryHardFinger(weekday, wall));
        if (eligible.length > 0 && !canCarryHardFinger(session.weekday, wall)) {
          record(report, 'sc_upper_placement', `${at}: weekday ${session.weekday}`);
        }
        if (eligible.length > 0 && session.fingerLoad !== 'hard') {
          record(report, 'sc_upper_hard_finger', `${at}: ${session.fingerLoad}`);
        }
      }
      // Rule 0: R90 and R93 outrank the house rule, so the upper day sits
      // between two maximal CNS days without becoming one.
      if (session.isMaximalCns) record(report, 'sc_upper_not_cns', `${at} ${session.date}`);
    }
  }

  if (week.kind === 'load') {
    if (jumpOrReactive < requirements.jumpOrReactiveSessionsPerWeek) {
      record(report, 'sc_weekly_sessions', `${at}: ${jumpOrReactive} jump sessions`);
    }
    if (upperPower < requirements.upperPowerSessionsPerWeek) {
      record(report, 'sc_weekly_sessions', `${at}: ${upperPower} upper power sessions`);
    }
  }

  // A demoted session says which climbing day moved its pulling, in the words
  // the athlete reads (house `house.sc.hard_finger_spacing`).
  for (const session of week.sessions) {
    const line = session.notices.find((entry) => entry.startsWith('Pull-ups moved to light work'));
    if (line === undefined) continue;
    if (session.fingerLoad === 'hard') record(report, 'sc_demotion_line', `${at}: still hard`);
    if (!/^Pull-ups moved to light work: climbing [A-Z][a-z]{2} (morning|afternoon|evening), \d+ h finger rule$/u.test(line)) {
      record(report, 'sc_demotion_line', `${at}: ${line}`);
    }
  }

  const ordered = [...hardFingerDates].sort();
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = Math.abs(diffDays(ordered[index - 1] ?? '', ordered[index] ?? '')) * 24;
    if (gap < climbing.fingerSpacingHours) {
      record(report, 'sc_finger_spacing', `${at}: ${gap} h`);
    }
  }

  const wanted = athlete.valgusControl?.sessionsPerWeek ?? 0;
  const eligible = week.sessions.filter((session) => session.dayType !== 'recovery_mobility').length;
  if (rntSessions !== Math.min(wanted, eligible)) {
    record(report, 'sc_rnt_count', `${at}: ${rntSessions} of ${Math.min(wanted, eligible)}`);
  }

  const calf = calfSets(week);
  if (calf.days > climbing.calfDaysPerWeek) {
    record(report, 'sc_calf', `${at}: ${calf.days} calf days`);
  }
  if (calf.maxSets > climbing.calfSetsCap) {
    record(report, 'sc_calf', `${at}: ${calf.maxSets} sets`);
  }
}

function* climbingCases(report: GridReport): Generator<Case> {
  report.sampled.push(
    'speed climbing: program lengths 2 to 16 x days 4 and 5 x 6 wall patterns (none, Mon Wed Fri, every evening, Tue Thu Sun, plus Fri, plus Sat)',
  );
  for (let W = 2; W <= 16; W += 1) {
    for (const days of [4, 5] as DaysPerWeek[]) {
      for (const wall of WALL_CASES) {
        const athlete = climbingAthlete(days);
        if (wall.wallWork !== undefined) athlete.wallWork = wall.wallWork;
        athlete.targetDate = addDays(PROGRAM_START, (W - 1) * 7);
        yield { athlete, label: `sc W${W}/d${days}/${wall.name}` };
      }
    }
  }

  report.sampled.push(
    "speed climbing: the owner's gym picks with and without a climbing weekday, morning window, W 12",
  );
  for (const picks of PICK_CASES) {
    for (const wall of WALL_CASES.slice(3)) {
      const athlete = climbingAthlete(picks.days);
      athlete.weekdays = [...picks.weekdays];
      athlete.sessionWindow = { ...MORNING_WINDOW };
      if (wall.wallWork !== undefined) athlete.wallWork = wall.wallWork;
      athlete.targetDate = addDays(PROGRAM_START, 11 * 7);
      yield { athlete, label: `sc W12/${picks.name}/${wall.name}` };
    }
  }

  report.sampled.push('speed climbing: hangboard present and absent at W 12 x days 4 and 5');
  for (const days of [4, 5] as DaysPerWeek[]) {
    const athlete = climbingAthlete(days);
    athlete.inventory = { ...CLIMBING_INVENTORY, hangboard: false };
    athlete.targetDate = addDays(PROGRAM_START, 11 * 7);
    yield { athlete, label: `sc W12/d${days}/no hangboard` };
  }

  report.sampled.push('speed climbing: finger pain 0 to 10 on the upper day at W 12, weeks 2 and 7');
  for (let pain = 0; pain <= 10; pain += 1) {
    const athlete = climbingAthlete(4);
    athlete.wallWork = WALL_CASES[1]?.wallWork ?? { weekdays: [] };
    athlete.targetDate = addDays(PROGRAM_START, 11 * 7);
    yield { athlete, label: `sc W12/d4/finger pain ${pain}`, weeks: [2, 7], fingerPainToday: pain };
  }

  report.sampled.push('speed climbing: all five readiness states at W 12, weeks 2 and 7');
  for (const state of [
    'both_high',
    'autonomic_low',
    'neuromuscular_low',
    'both_low',
    'unknown',
  ] as ReadinessState[]) {
    const athlete = climbingAthlete(4);
    athlete.wallWork = WALL_CASES[1]?.wallWork ?? { weekdays: [] };
    athlete.targetDate = addDays(PROGRAM_START, 11 * 7);
    yield { athlete, label: `sc W12/d4/readiness ${state}`, weeks: [2, 7], readinessState: state };
  }
}

/** Run the climbing grid once, checking as it goes. */
export function runClimbingGrid(): GridReport {
  const report: GridReport = {
    weeks: 0,
    sessions: 0,
    programs: 0,
    sampled: [],
    violations: {},
  };

  for (const entry of climbingCases(report)) {
    report.programs += 1;
    const skeleton = planSkeleton(entry.athlete, PROGRAM_START, ruleset);
    const cnsDates: string[] = [];

    for (const skeletonWeek of skeleton.weeks) {
      if (entry.weeks !== undefined && !entry.weeks.includes(skeletonWeek.w)) continue;
      // The finger-pain and readiness answers are today's answers, so "today"
      // is the day the question was asked: the upper day for finger pain, the
      // jump day for readiness.
      const upper = skeletonWeek.sessions.find((session) => session.dayType === 'upper_strength');
      const jump = skeletonWeek.sessions.find((session) => session.isTestDay);
      const today =
        entry.fingerPainToday !== undefined
          ? upper?.date ?? skeletonWeek.windowStart
          : entry.readinessState !== undefined
            ? jump?.date ?? skeletonWeek.windowStart
            : skeletonWeek.windowStart;
      const history = freshHistory();
      if (entry.fingerPainToday !== undefined) history.fingerPainToday = entry.fingerPainToday;
      if (entry.readinessState !== undefined) {
        history.readinessToday = readinessInputFor(entry.readinessState, today);
      }
      const context: MaterializeContext = {
        athlete: entry.athlete,
        ruleset,
        exercises: seeded.exercises,
        ladders: seeded.ladders,
        skeleton,
        w: skeletonWeek.w,
        workingMaxes: [],
        history,
        today,
        seed: 11,
      };
      const week = materializeWeek(context);
      report.weeks += 1;
      report.sessions += week.sessions.length;
      checkClimbingWeek(report, week, entry, context);

      let tendon = false;
      for (const session of week.sessions) {
        if (session.isMaximalCns) cnsDates.push(session.date);
        for (const block of session.blocks) {
          if (block.name === 'warm_up') continue;
          for (const row of block.exercises) {
            if (byId.get(row.exerciseId)?.tendonTarget !== undefined) tendon = true;
          }
        }
      }
      if (!tendon) record(report, 'R99', `${entry.label} w${skeletonWeek.w}`);
    }

    for (let index = 1; index < cnsDates.length; index += 1) {
      const gap = diffDays(cnsDates[index - 1] ?? '', cnsDates[index] ?? '');
      if (gap < 2) record(report, 'R90_R93', `${entry.label}: gap ${gap} at ${cnsDates[index] ?? ''}`);
    }
  }

  return report;
}

let cached: GridReport | undefined;

/** The climbing grid, generated once per test file. */
export function climbingGrid(): GridReport {
  cached ??= runClimbingGrid();
  return cached;
}
