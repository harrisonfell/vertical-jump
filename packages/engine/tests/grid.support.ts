/**
 * The generated grid brief section 09 "Tests" asks for, and the invariant
 * checks run over it in one pass.
 *
 * A single pass keeps the whole grid out of memory: instead of collecting
 * thousands of `WeekPlan`s and asserting over them fifty times, every week is
 * checked as it is generated and only the violations are kept. Each invariant
 * has a key; `tests/invariants.test.ts` asserts that its list is empty.
 *
 * Sampling (logged in `GridReport.sampled`): the pain states run on a smaller
 * face of the grid than the program lengths, so the run stays well under a
 * minute. Everything else is exhaustive over the axes the brief names.
 */
import { addDays, diffDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { PROGRAM_START, gridRuleset, gridSeed } from './grid.seed.js';
import {
  CONTACT_GOVERNED,
  POWER_DAYS,
  checkSession,
  record,
  weekTotals,
  type GridReport,
} from './grid.checks.js';
import type { Athlete, Inventory, PainStatus } from '../src/types/athlete.js';
import type { DaysPerWeek, Level, TrainingAge } from '../src/types/core.js';
import type { Weekday } from '../src/types/calendar.js';
import type { MaterializeContext, MaterializeHistory } from '../src/types/plan.js';

const ruleset = gridRuleset;
const seeded = gridSeed;

export const WEEKDAYS: Record<DaysPerWeek, Weekday[]> = {
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 6],
  5: [1, 2, 3, 4, 6],
};

export const LEVELS: [Level, TrainingAge][] = [
  ['beginner', 'none'],
  ['intermediate', '1to3'],
  ['advanced', '4plus'],
];

export const FULL_INVENTORY: Inventory = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: true,
  dumbbells: { maxLb: 100, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24, 30],
  hurdleHeightsIn: [6, 9, 12],
  bands: true,
  medBall: true,
  vestLb: 20,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
  weightRoomAccess: true,
};

export const BARE_INVENTORY: Inventory = {
  ...FULL_INVENTORY,
  barbell: false,
  rack: false,
  trapBar: false,
  dumbbells: null,
  boxHeightsIn: [],
  hurdleHeightsIn: [],
  bands: false,
  medBall: false,
  bench: false,
  pullupBar: false,
  weightRoomAccess: false,
};

/** Every athlete on the grid starts from this one. */
export function baseAthlete(): Athlete {
  return {
    id: 'grid',
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAge: '1to3',
    level: 'intermediate',
    daysPerWeek: 4,
    weekdays: WEEKDAYS[4],
    isAdult: true,
    clearance: {
      heartCondition: false,
      chestPain: false,
      dizziness: false,
      chronicCondition: false,
      prescriptionMedication: false,
      boneOrJointProblem: false,
      supervisedActivityOnly: false,
      isAdult: true,
      attestedAt: PROGRAM_START,
    },
    painStatus: [],
    inventory: FULL_INVENTORY,
    bodyweightKg: 181 / 2.2046226218,
    workingMaxes: [],
    inSeason: false,
    readinessPassedAt: '2026-09-01',
    standingReachMm: null,
    goalHeightMm: 914.4,
    targetDate: '2026-11-29',
    primaryInstrument: 'ovr_jump_regular',
    baselineHeightMm: 746.76,
    timezone: 'America/New_York',
    rolloverHour: 3,
    canonicalTestNote: 'Shoes on, gym floor, after warm-up.',
    sorenessHistory: [],
    extraEquipment: [],
  };
}

/** One reported pain state on the grid, with the name the report uses. */
export interface PainCase {
  name: string;
  painStatus: PainStatus[];
}

function painStatus(
  location: PainStatus['location'],
  raw: PainStatus['severityRaw'],
  severity: PainStatus['severity'],
  weeks: number,
): PainStatus {
  return {
    location,
    severityRaw: raw,
    severity,
    duration: weeks < 12 ? 'acute' : 'chronic',
    durationWeeks: weeks,
    reportedAt: PROGRAM_START,
    reassessDueAt: addDays(PROGRAM_START, 14),
  };
}

export const PAIN_CASES: PainCase[] = [
  { name: 'none', painStatus: [] },
  { name: 'mild knee chronic', painStatus: [painStatus('knee', '1-2', 'mild', 20)] },
  { name: 'moderate back', painStatus: [painStatus('back', '3-4', 'moderate', 6)] },
  { name: 'severe knee restricted', painStatus: [painStatus('knee', '5+', 'severe', 4)] },
  { name: 'hip house template', painStatus: [painStatus('hip', '3-4', 'moderate', 8)] },
];

/** Program lengths the grid covers: every length to 16, then the chained ones. */
export const PROGRAM_LENGTHS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 30,
];

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

interface Case {
  athlete: Athlete;
  label: string;
}

function* gridCases(report: GridReport): Generator<Case> {
  report.sampled.push(
    `program lengths ${PROGRAM_LENGTHS.join(', ')} x days 2 to 5 x 3 levels x full and bare inventory, pain none`,
  );
  for (const W of PROGRAM_LENGTHS) {
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        for (const inventory of [FULL_INVENTORY, BARE_INVENTORY]) {
          const athlete: Athlete = {
            ...baseAthlete(),
            level,
            trainingAge,
            daysPerWeek: days,
            weekdays: WEEKDAYS[days],
            inventory,
            targetDate: addDays(PROGRAM_START, (W - 1) * 7),
          };
          const kit = inventory === FULL_INVENTORY ? 'full' : 'bare';
          yield { athlete, label: `W${W}/d${days}/${level}/${kit}` };
        }
      }
    }
  }

  report.sampled.push(
    'pain states sampled at W 8 and 12 x days 3 and 4 x 3 levels x full inventory',
  );
  for (const W of [8, 12]) {
    for (const days of [3, 4] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        for (const pain of PAIN_CASES) {
          if (pain.name === 'none') continue;
          yield {
            athlete: {
              ...baseAthlete(),
              level,
              trainingAge,
              daysPerWeek: days,
              weekdays: WEEKDAYS[days],
              painStatus: pain.painStatus,
              targetDate: addDays(PROGRAM_START, (W - 1) * 7),
            },
            label: `W${W}/d${days}/${level}/pain ${pain.name}`,
          };
        }
      }
    }
  }

  report.sampled.push('under 18 sampled at W 12 x days 4 x 3 levels');
  for (const [level, trainingAge] of LEVELS) {
    const base = baseAthlete();
    yield {
      athlete: {
        ...base,
        level,
        trainingAge,
        isAdult: false,
        clearance: { ...base.clearance, isAdult: false },
        targetDate: addDays(PROGRAM_START, 11 * 7),
      },
      label: `W12/d4/${level}/under 18`,
    };
  }

  report.sampled.push('in season sampled at W 12 x days 4 x 3 levels');
  for (const [level, trainingAge] of LEVELS) {
    yield {
      athlete: {
        ...baseAthlete(),
        level,
        trainingAge,
        inSeason: true,
        targetDate: addDays(PROGRAM_START, 11 * 7),
      },
      label: `W12/d4/${level}/in season`,
    };
  }

  report.sampled.push('no readiness checklist sampled at W 12 x days 4 x 3 levels');
  for (const [level, trainingAge] of LEVELS) {
    const athlete = { ...baseAthlete(), level, trainingAge };
    delete athlete.readinessPassedAt;
    yield { athlete, label: `W12/d4/${level}/no readiness` };
  }
}

/** Run the whole grid once, checking as it goes. */
export function runGrid(): GridReport {
  const report: GridReport = {
    weeks: 0,
    sessions: 0,
    programs: 0,
    sampled: [],
    violations: {},
  };
  const byId = new Map(seeded.exercises.map((exercise) => [exercise.id, exercise]));

  for (const entry of gridCases(report)) {
    report.programs += 1;
    const skeleton = planSkeleton(entry.athlete, PROGRAM_START, ruleset);
    const totalWeeks = skeleton.weeks.reduce((sum) => sum + 1, 0);
    if (totalWeeks !== skeleton.W) record(report, 'block_weeks', `${entry.label}: ${totalWeeks} vs ${skeleton.W}`);
    const spanned = skeleton.blocks.reduce((sum, block) => sum + (block.weekTo - block.weekFrom + 1), 0);
    if (spanned !== skeleton.W) record(report, 'block_weeks', `${entry.label}: blocks span ${spanned}`);
    // A chained program (over 16 weeks) ends at its own last test, not at the
    // target date: the next program is built from that test (brief 09).
    const chained = diffDays(PROGRAM_START, entry.athlete.targetDate) / 7 + 1 > ruleset.constants.maxLayoutWeeks;
    const peak = skeleton.weeks[skeleton.weeks.length - 1];
    if (
      !chained &&
      (peak === undefined ||
        diffDays(peak.windowStart, entry.athlete.targetDate) < 0 ||
        diffDays(entry.athlete.targetDate, peak.windowEnd) < 0)
    ) {
      record(report, 'peak_window', `${entry.label}`);
    }

    const cnsDates: string[] = [];
    let previousSession: { date: string; spineHigh: number; heavySquat: boolean } | undefined;
    let tendonThisWeek = false;
    let lastLoadWeek: { reps: Record<string, number>; contacts: number } | undefined;

    for (const skeletonWeek of skeleton.weeks) {
      const context: MaterializeContext = {
        athlete: entry.athlete,
        ruleset,
        exercises: seeded.exercises,
        ladders: seeded.ladders,
        skeleton,
        w: skeletonWeek.w,
        workingMaxes: [],
        history: freshHistory(),
        today: skeletonWeek.windowStart,
        seed: 7,
      };
      const week = materializeWeek(context);
      report.weeks += 1;
      report.sessions += week.sessions.length;
      tendonThisWeek = false;

      for (const session of week.sessions) {
        checkSession(report, session, week, context, entry.label, byId);
        if (session.isMaximalCns) cnsDates.push(session.date);

        let spineHigh = 0;
        let heavySquat = false;
        for (const block of session.blocks) {
          if (block.name === 'warm_up') continue;
          for (const row of block.exercises) {
            const exercise = byId.get(row.exerciseId);
            if (exercise === undefined) continue;
            if (exercise.tendonTarget !== undefined) tendonThisWeek = true;
            if (exercise.spineStress === 'high') spineHigh += 1;
            if (exercise.movementPattern === 'squat' && exercise.loadType === 'heavy_strength') {
              heavySquat = true;
            }
          }
        }
        if (previousSession !== undefined && diffDays(previousSession.date, session.date) === 1) {
          if (previousSession.heavySquat && session.contacts.highIntensity > 0) {
            record(report, 'R91', `${entry.label} w${week.w} ${session.date}`);
          }
          if (previousSession.spineHigh >= 2) {
            const opener = session.blocks
              .flatMap((block) => (block.name === 'warm_up' ? [] : block.exercises))[0];
            const exercise = opener === undefined ? undefined : byId.get(opener.exerciseId);
            if (exercise?.spineStress === 'high') record(report, 'R24', `${entry.label} ${session.date}`);
          }
        }
        previousSession = { date: session.date, spineHigh, heavySquat };
      }

      if (!tendonThisWeek) record(report, 'R99', `${entry.label} w${week.w}`);

      const totals = weekTotals(week);
      if (week.kind === 'load') lastLoadWeek = totals;
      else if (
        (week.kind === 'deload' || week.kind === 'taper') &&
        lastLoadWeek !== undefined &&
        entry.athlete.painStatus.length === 0
      ) {
        const factor = week.kind === 'deload' ? ruleset.constants.deload.volumeFactorMax : ruleset.constants.taper.volumeFactor;
        for (const [exerciseId, reps] of Object.entries(totals.reps)) {
          const before = lastLoadWeek.reps[exerciseId];
          // The weekly test keeps its 5 attempts in every week (R92).
          if (before === undefined || before === 0 || CONTACT_GOVERNED.has(exerciseId)) continue;
          if (reps > Math.ceil(before * factor)) {
            record(report, 'R105', `${entry.label} w${week.w}: ${exerciseId} ${reps} vs ${before}`);
          }
        }
        if (lastLoadWeek.contacts > 0 && totals.contacts > Math.ceil(lastLoadWeek.contacts * factor)) {
          record(report, 'R105', `${entry.label} w${week.w}: ${totals.contacts} contacts vs ${lastLoadWeek.contacts}`);
        }
      }

      if (week.w === 1) {
        const maximal = week.sessions.filter((session) => session.isMaximalCns);
        if (maximal.length !== 1 || maximal[0]?.isTestDay !== true) {
          record(report, 'R92', `${entry.label}: ${maximal.length} maximal CNS sessions`);
        }
        for (const session of week.sessions) {
          for (const block of session.blocks) {
            for (const row of block.exercises) {
              for (const set of row.sets) {
                if (set.targetRpe !== undefined && set.targetRpe > ruleset.constants.week1RpeCap) {
                  record(report, 'R76', `${entry.label}: RPE ${set.targetRpe}`);
                }
                if (set.loadPercent !== undefined && set.loadPercent > ruleset.constants.workingMax.week2GuardPct) {
                  record(report, 'R76', `${entry.label}: ${set.loadPercent}% in week 1`);
                }
              }
            }
          }
        }
      }

      if (week.kind === 'peak') {
        const peakSession = week.sessions.find((session) => !session.isTestDay && session.dayType !== 'recovery_mobility');
        if (peakSession !== undefined) {
          if (diffDays(peakSession.date, entry.athlete.targetDate) !== 5) {
            record(report, 'peak_session', `${entry.label}: ${peakSession.date}`);
          }
          if (peakSession.contacts.highIntensity > ruleset.constants.peak.maxHighIntensityContacts) {
            record(report, 'peak_session', `${entry.label}: ${peakSession.contacts.highIntensity} contacts`);
          }
        }
      }

      if (entry.athlete.sport === 'basketball' && !entry.athlete.inSeason && week.kind === 'load') {
        const hasJump = week.sessions.some((session) => POWER_DAYS.has(session.dayType));
        const hasCod = week.sessions.some((session) =>
          session.blocks.some((block) => block.name === 'cod'),
        );
        if (!hasJump || !hasCod) record(report, 'R137', `${entry.label} w${week.w}`);
      }
      if (entry.athlete.inSeason) {
        const hasCod = week.sessions.some((session) =>
          session.blocks.some((block) => block.name === 'cod'),
        );
        if (hasCod) record(report, 'in_season', `${entry.label} w${week.w}: COD block scheduled`);
      }
    }

    for (let index = 1; index < cnsDates.length; index += 1) {
      const gap = diffDays(cnsDates[index - 1] ?? '', cnsDates[index] ?? '');
      if (gap < 2) record(report, 'R90_R93', `${entry.label}: gap ${gap} at ${cnsDates[index] ?? ''}`);
    }
  }

  return report;
}

let cached: GridReport | undefined;

/** The grid, generated once per test file. */
export function grid(): GridReport {
  cached ??= runGrid();
  return cached;
}

export { PROGRAM_START, gridRuleset, gridSeed } from './grid.seed.js';
export type { GridReport } from './grid.checks.js';
