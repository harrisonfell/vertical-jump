/**
 * Helpers for `tests/fixed-climber-rulebook.test.ts`, split out so both files
 * stay under the 500-line limit. Nothing here reads the engine's own
 * accounting: contacts are recounted from the prescribed sets and "maximal
 * CNS" is recomputed from the house definition in brief section 09.
 */
import { PROGRAM_START, WEEKDAYS, baseAthlete, gridRuleset, gridSeed } from './grid.support.js';
import { addDays, diffDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { kgToLb, lbToKg } from '../src/units.js';
import type { Athlete, WorkingMax } from '../src/types/athlete.js';
import type { DaysPerWeek, MovementPattern } from '../src/types/core.js';
import type { Exercise } from '../src/types/exercise.js';
import type {
  MaterializeContext,
  MaterializeHistory,
  SessionPlan,
  WeekPlan,
} from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = new Map<string, Exercise>(exercises.map((entry) => [entry.id, entry]));
const constants = ruleset.constants;
const climbing = constants.climbing;
const LOWER: MovementPattern[] = ['squat', 'hinge', 'lunge'];
const FROZEN = `${PROGRAM_START}T03:00:00.000Z`;
const LIFTS = ['box_squat', 'back_squat', 'weighted_pull_up', 'db_press', 'trap_bar_deadlift'];

export function maxes(): WorkingMax[] {
  return LIFTS.map((lift) => ({
    lift,
    valueKg: lbToKg(lift === 'weighted_pull_up' ? 90 : lift === 'db_press' ? 70 : 320),
    source: 'entered' as const,
    confidence: 1,
    frozenAt: FROZEN,
    failStreak: 0,
  }));
}

export function history(withMaxes: boolean): MaterializeHistory {
  const base: MaterializeHistory = {
    rotationHistory: {},
    ladderState: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
  if (!withMaxes) return base;
  base.firstProgram = false;
  base.percentWeekIndexByLift = Object.fromEntries(LIFTS.map((lift) => [lift, 3]));
  return base;
}

/** The climber of the owner's spec, built here rather than borrowed. */
export function climber(days: DaysPerWeek, weeks: number, wall: boolean, hangboard: boolean): Athlete {
  const base = baseAthlete();
  const athlete: Athlete = {
    ...base,
    sport: 'speed_climbing',
    secondaryGoal: 'upper_body_power',
    level: 'advanced',
    trainingAge: '4plus',
    daysPerWeek: days,
    weekdays: WEEKDAYS[days],
    targetDate: addDays(PROGRAM_START, (weeks - 1) * 7),
    inventory: {
      ...base.inventory,
      trapBar: false,
      hurdleHeightsIn: [],
      hangboard,
      boxSquatBox: true,
      climbingWall: true,
    },
    fingerHistory: true,
    gripMode: 'open_hand',
    fingerPainCeiling: climbing.fingerPainCeiling,
    valgusControl: {
      required: true,
      sessionsPerWeek: climbing.rntSessionsPerWeek,
      minHoursFromWall: climbing.rntWallGapHours,
    },
    weakerSide: 'left',
    readinessConfig: { ...climbing.readiness },
  };
  if (wall) athlete.wallWork = { weekdays: [1, 3, 5], typicalStart: '18:00', typicalEnd: '20:00' };
  return athlete;
}

export function ball(days: DaysPerWeek, weeks: number): Athlete {
  return {
    ...baseAthlete(),
    level: 'advanced',
    trainingAge: '4plus',
    daysPerWeek: days,
    weekdays: WEEKDAYS[days],
    targetDate: addDays(PROGRAM_START, (weeks - 1) * 7),
  };
}

export interface Program {
  label: string;
  athlete: Athlete;
  weeks: WeekPlan[];
}

export function buildProgram(athlete: Athlete, label: string, withMaxes: boolean): Program {
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const applied = withMaxes ? maxes() : [];
  const weeks = skeleton.weeks.map((skeletonWeek) => {
    const context: MaterializeContext = {
      athlete: { ...athlete, workingMaxes: applied },
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: skeletonWeek.w,
      workingMaxes: applied,
      history: history(withMaxes),
      today: skeletonWeek.windowStart,
      seed: 5,
    };
    return materializeWeek(context);
  });
  return { label, athlete, weeks };
}

let climbCache: Program[] | undefined;
let ballCache: Program[] | undefined;

export function climbPrograms(): Program[] {
  if (climbCache !== undefined) return climbCache;
  const out: Program[] = [];
  for (const weeks of [4, 12, 16]) {
    for (const days of [4, 5] as DaysPerWeek[]) {
      for (const withMaxes of [false, true]) {
        for (const wall of [false, true]) {
          const kit = withMaxes ? 'maxes' : 'rpe';
          const at = wall ? 'wall' : 'no wall';
          out.push(
            buildProgram(climber(days, weeks, wall, true), `sc W${weeks}/d${days}/${kit}/${at}`, withMaxes),
          );
        }
      }
    }
  }
  for (const days of [4, 5] as DaysPerWeek[]) {
    out.push(buildProgram(climber(days, 12, true, false), `sc W12/d${days}/no hangboard`, true));
  }
  climbCache = out;
  return out;
}

export function ballPrograms(): Program[] {
  if (ballCache !== undefined) return ballCache;
  const out: Program[] = [];
  for (const weeks of [4, 12, 16]) {
    for (const days of [4, 5] as DaysPerWeek[]) {
      for (const withMaxes of [false, true]) {
        const kit = withMaxes ? 'maxes' : 'rpe';
        out.push(buildProgram(ball(days, weeks), `bb W${weeks}/d${days}/${kit}`, withMaxes));
      }
    }
  }
  ballCache = out;
  return out;
}

export interface Row {
  block: string;
  row: SessionPlan['blocks'][number]['exercises'][number];
  exercise: Exercise;
}

export function rowsOf(session: SessionPlan, all = false): Row[] {
  const out: Row[] = [];
  for (const block of session.blocks) {
    if (!all && (block.name === 'warm_up' || block.name === 'cool_down')) continue;
    for (const row of block.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise !== undefined) out.push({ block: block.name, row, exercise });
    }
  }
  return out;
}

/** Contacts recounted from the prescribed sets, never read off the session. */
export function recount(session: SessionPlan): { extensive: number; high: number; amplitude: number } {
  let extensive = 0;
  let high = 0;
  let amplitude = 0;
  for (const entry of rowsOf(session)) {
    const reps = entry.row.sets.reduce((sum, set) => sum + (set.reps ?? 0), 0);
    extensive += reps * (entry.exercise.codCutsPerRep ?? 0);
    const plyo = entry.exercise.plyometric;
    if (plyo === undefined) continue;
    const contacts = reps * plyo.contactsPerRep;
    if (plyo.category === 'extensive') extensive += contacts;
    if (plyo.intensity === 'high') high += contacts;
    if (plyo.amplitude === 'high') amplitude += contacts;
  }
  return { extensive, high, amplitude };
}

/**
 * The house definition of a maximal CNS session (brief 09, house rule
 * `house.maximal_cns_definition`), recomputed from the rows so a session
 * cannot assert itself into compliance.
 */
export function maximalCns(session: SessionPlan): boolean {
  if (session.isTestDay) return true;
  if (recount(session).high >= 10) return true;
  for (const entry of rowsOf(session, true)) {
    if (entry.exercise.readinessRequired) return true;
    if (entry.row.loadType !== 'heavy_strength') continue;
    for (const set of entry.row.sets) {
      if ((set.loadPercent ?? 0) >= 85) return true;
      if ((set.targetRpe ?? 0) >= constants.rpeCap.intermediate) return true;
    }
  }
  return false;
}

/** R148, R154, R155, R162 and R88 on one row. */
export function rowViolations(entry: Row, athlete: Athlete, at: string): string[] {
  const bad: string[] = [];
  const { exercise, row } = entry;
  const level = athlete.level;
  if (exercise.plyometric?.isMaximalJump === true) {
    if (row.restS < 120) bad.push(`R88 ${at}: ${row.exerciseId} rest ${row.restS} s`);
    if (row.restS < constants.restBoundsS.maximalJump) {
      bad.push(`R88+R164 ${at}: ${row.exerciseId} rest ${row.restS} s`);
    }
  }
  let previous: number | undefined;
  const shownFor = new Map<number, string>();
  for (const set of row.sets) {
    if (set.displayLoad.includes('%')) bad.push(`R148 ${at}: ${row.exerciseId} shows a percent`);
    if (set.loadKg !== undefined && set.displayLoad.length === 0) {
      bad.push(`R148 ${at}: ${row.exerciseId} loaded set with no display`);
    }
    if (set.loadKg !== undefined) {
      const lb = kgToLb(set.loadKg);
      const grids = [5, athlete.inventory.dumbbells?.incrementLb ?? 5, athlete.inventory.plates.smallestPairLb];
      if (!grids.some((grid) => Math.abs(lb - Math.round(lb / grid) * grid) < 0.01)) {
        bad.push(`R162 ${at}: ${row.exerciseId} ${lb.toFixed(2)} lb`);
      }
      const added = /BW \+ ([\d.]+) lb/.exec(set.displayLoad);
      const shown = added === null ? undefined : Number(added[1]);
      if (shown !== undefined && (Math.abs(shown - Math.round(shown / 5) * 5) > 0.01 || Math.abs(shown - lb) > 0.51)) {
        bad.push(`R162 ${at}: ${row.exerciseId} shows ${shown} for ${lb.toFixed(2)} lb`);
      }
    }
    const percent = set.loadPercent;
    if (percent === undefined) continue;
    if (row.loadType === 'ballistic') {
      if (percent > constants.loadedJumpCeilingPct[level]) bad.push(`ballistic ${at}: ${percent}`);
    } else if (row.loadType !== 'power' && percent > constants.levelTopSetCapPct[level]) {
      bad.push(`R154 ${at}: ${row.exerciseId} ${percent}`);
    }
    if (set.isHeld && previous !== undefined && percent !== previous) {
      bad.push(`R155 ${at}: ${row.exerciseId} held at ${percent} after ${previous}`);
    }
    // Two sets may legally share a string when R162 rounds two percents onto
    // the same 5 lb rung; what R148 forbids is one display standing for two
    // DIFFERENT prescribed loads.
    const load = set.loadKg ?? percent;
    for (const [seen, display] of shownFor) {
      if (seen !== load && display === set.displayLoad) {
        bad.push(`R148 ${at}: ${row.exerciseId} shows "${display}" for two loads`);
      }
    }
    shownFor.set(load, set.displayLoad);
    previous = percent;
  }
  return bad;
}

/** Every structural rule the rule book states, re-implemented from its text. */
export function structuralViolations(program: Program): string[] {
  const bad: string[] = [];
  const level = program.athlete.level;
  for (const week of program.weeks) {
    let tendon = false;
    for (const session of week.sessions) {
      const at = `${program.label} w${week.w} ${session.dayType}`;
      const counted = rowsOf(session);
      const c = counted.map((entry) => entry.exercise);
      const a = rowsOf(session, true).map((entry) => entry.exercise);
      if (a.some((exercise) => exercise.tendonTarget !== undefined)) tendon = true;

      // R44: at most two high-CNS exercises in one session.
      const highCns = c.filter((exercise) => exercise.cnsCost === 'high').length;
      if (highCns > constants.maxHighCnsPerSession) bad.push(`R44 ${at}: ${highCns}`);
      // R67: advanced allows up to three strength movements per session.
      const heavy = counted.filter((entry) => entry.row.loadType === 'heavy_strength').length;
      if (heavy > constants.heavyLiftsPerSession[level]) bad.push(`R67 ${at}: ${heavy} heavy lifts`);

      // The recovery day carries no strength block for the balance rules to
      // balance, which is the engine's declared reading (`structural: false`).
      if (session.dayType !== 'recovery_mobility') {
        // R48, R123: a push needs a pull.
        if (c.some((e) => e.isPush) && !c.some((e) => e.isPull)) bad.push(`R48 ${at}`);
        // R49: a bilateral exercise needs a unilateral one.
        if (c.some((e) => !e.unilateral) && !a.some((e) => e.unilateral)) bad.push(`R49 ${at}`);
        // R121: a bilateral squat pattern needs a unilateral leg accessory.
        if (
          c.some((e) => !e.unilateral && e.movementPattern === 'squat') &&
          !c.some((e) => e.unilateral && LOWER.includes(e.movementPattern))
        ) {
          bad.push(`R121 ${at}`);
        }
        // R68, R122: a hinge needs posterior-chain accessory support.
        if (
          c.some((e) => e.movementPattern === 'hinge') &&
          !c.some((e) => e.rotationGroup === 'posterior_chain')
        ) {
          bad.push(`R68 ${at}`);
        }
        // R50, on the declared reading: satisfied by anything the session
        // contains, warm-up included.
        if (a.some((e) => e.plane === 'sagittal') && !a.some((e) => e.plane !== 'sagittal')) {
          bad.push(`R50 ${at}`);
        }
      }

      // R85 and R52 recounted, with the session's own numbers checked too.
      const counts = recount(session);
      if (counts.high > 25) bad.push(`R85 ${at}: ${counts.high}`);
      if (counts.amplitude > 20) bad.push(`R52 ${at}: ${counts.amplitude}`);
      if (
        counts.high !== session.contacts.highIntensity ||
        counts.amplitude !== session.contacts.highAmplitude ||
        counts.extensive !== session.contacts.extensive
      ) {
        bad.push(`contacts ${at}: counted ${JSON.stringify(counts)} vs ${JSON.stringify(session.contacts)}`);
      }

      for (const entry of counted) bad.push(...rowViolations(entry, program.athlete, at));
    }
    // R99: a tendon loading exercise every week.
    if (week.sessions.length > 0 && !tendon) bad.push(`R99 ${program.label} w${week.w}`);
  }
  return bad;
}

/** R90, R91 and R93 read across the whole generated calendar. */
export function spacingViolations(program: Program): string[] {
  const bad: string[] = [];
  const all = program.weeks
    .flatMap((week) => week.sessions)
    .sort((left, right) => (left.date < right.date ? -1 : 1));

  for (let index = 1; index < all.length; index += 1) {
    const previous = all[index - 1];
    const current = all[index];
    if (previous === undefined || current === undefined) continue;
    if (diffDays(previous.date, current.date) !== 1) continue;
    // R90: never two maximal CNS days back to back.
    if (maximalCns(previous) && maximalCns(current)) {
      bad.push(`R90 ${program.label}: ${previous.date} and ${current.date}`);
    }
    // R91: no maximal plyometrics the day after a heavy squat session.
    const heavySquat = rowsOf(previous).some(
      (entry) => entry.exercise.movementPattern === 'squat' && entry.row.loadType === 'heavy_strength',
    );
    const maximalPlyo = rowsOf(current).some((entry) => entry.exercise.plyometric?.isMaximalJump === true);
    if (heavySquat && maximalPlyo) {
      bad.push(`R91 ${program.label}: ${previous.date} squat then ${current.date} jumps`);
    }
  }

  // R93: at four or more training days a week, one non-CNS-heavy training day
  // has to sit between two maximal CNS sessions.
  if (program.athlete.daysPerWeek >= 4) {
    let last = -1;
    for (let index = 0; index < all.length; index += 1) {
      if (!maximalCns(all[index] ?? all[0] ?? ({} as SessionPlan))) continue;
      if (last >= 0 && index - last < 2) {
        bad.push(
          `R93 ${program.label}: no clear training day between ${all[last]?.date ?? ''} and ${all[index]?.date ?? ''}`,
        );
      }
      last = index;
    }
  }
  return bad;
}

/** R84: the level's extensive range on load-week jump days. */
export function extensiveViolations(program: Program): string[] {
  const bad: string[] = [];
  const range = constants.extensiveRange[program.athlete.level];
  for (const week of program.weeks) {
    if (week.kind !== 'load') continue;
    for (const session of week.sessions) {
      if (session.readiness !== undefined) continue;
      if (session.dayType !== 'power' && session.dayType !== 'power_speed') continue;
      const extensive = recount(session).extensive;
      if (extensive < range.bottom || extensive > range.top) {
        bad.push(`R84 ${program.label} w${week.w}: ${extensive} outside ${range.bottom}-${range.top}`);
      }
    }
  }
  return bad;
}

export function show(list: string[]): string {
  if (list.length === 0) return '';
  return [`${list.length} violations, first 8:`, ...list.slice(0, 8)].join('\n');
}

