/**
 * Support for the determinism, edge cases, crashes.
 *
 * Fuzzes `planSkeleton` and `materializeWeek` over program lengths 2 to 30,
 * 2 to 5 training days, every level, inventories from empty to full, every
 * pain combination, soreness 0 to 10, missing maxes, target dates and "today"
 * on every weekday, DST-crossing windows, in season, readiness passed or not,
 * and chains of repeated outcomes driven by synthetic logs.
 *
 * Nothing here changes a src file; every failure is reported with the inputs
 * that produced it.
 */
import { addDays, diffDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { displayedRowCount } from '../src/select/order.js';
import { kgToLb } from '../src/units.js';
import {
  BARE_INVENTORY,
  FULL_INVENTORY,
  PAIN_CASES,
  PROGRAM_START,
  WEEKDAYS,
  baseAthlete,
  gridRuleset,
  gridSeed,
} from './grid.support.js';
import type { Athlete, Inventory, PainStatus } from '../src/types/athlete.js';
import type { DaysPerWeek, Level, TrainingAge } from '../src/types/core.js';
import type { SessionRecord, SetLog } from '../src/types/logs.js';
import type {
  MaterializeContext,
  MaterializeHistory,
  PlanSkeleton,
  SessionPlan,
  WeekPlan,
} from '../src/types/plan.js';

export const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
export const LEVELS: [Level, TrainingAge][] = [
  ['beginner', 'none'],
  ['intermediate', '1to3'],
  ['advanced', '4plus'],
];

/** Every violation the fuzz finds, keyed by the check that found it. */
export type Findings = Record<string, string[]>;

export function note(findings: Findings, key: string, detail: string): void {
  const list = findings[key] ?? [];
  if (list.length < 6) list.push(detail);
  findings[key] = list;
}

export function freshHistory(): MaterializeHistory {
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

export function contextFor(
  athlete: Athlete,
  skeleton: PlanSkeleton,
  w: number,
  patch: Partial<MaterializeContext> = {},
): MaterializeContext {
  const week = skeleton.weeks.find((entry) => entry.w === w);
  return {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    w,
    workingMaxes: [],
    history: freshHistory(),
    today: week?.windowStart ?? skeleton.programStart,
    seed: 20260907,
    ...patch,
  };
}

/* ------------------------------------------------------------- assertions */

export const NUMERIC_KEYS = [
  'reps',
  'durationS',
  'distanceM',
  'loadPercent',
  'loadKg',
  'targetRpe',
  'restS',
] as const;

/** No NaN, no Infinity, no "undefined" leaking into a display string. */
export function checkPrescriptions(
  findings: Findings,
  label: string,
  session: SessionPlan,
  stepLb: number,
): void {
  for (const block of session.blocks) {
    for (const row of block.exercises) {
      if (!Number.isFinite(row.restS) || row.restS < 0) {
        note(findings, 'row_rest', `${label} ${row.exerciseId} restS=${row.restS}`);
      }
      if (row.sets.length === 0) note(findings, 'row_zero_sets', `${label} ${row.exerciseId}`);
      for (const set of row.sets) {
        for (const key of NUMERIC_KEYS) {
          const value = set[key];
          if (value === undefined) continue;
          if (!Number.isFinite(value)) {
            note(
              findings,
              'nan_field',
              `${label} ${row.exerciseId} set ${set.setNumber} ${key}=${String(value)}`,
            );
          }
        }
        if (set.reps !== undefined && (!Number.isInteger(set.reps) || set.reps < 1)) {
          note(findings, 'bad_reps', `${label} ${row.exerciseId} set ${set.setNumber} reps=${set.reps}`);
        }
        if (set.durationS !== undefined && set.durationS <= 0) {
          note(findings, 'bad_duration', `${label} ${row.exerciseId} ${set.durationS}`);
        }
        if (typeof set.displayLoad !== 'string' || set.displayLoad.length === 0) {
          note(findings, 'empty_display', `${label} ${row.exerciseId} set ${set.setNumber}`);
        }
        if (/NaN|undefined|Infinity/.test(set.displayLoad)) {
          note(findings, 'display_nan', `${label} ${row.exerciseId} "${set.displayLoad}"`);
        }
        if (set.loadKg !== undefined) {
          const lb = kgToLb(set.loadKg);
          if (!Number.isFinite(lb) || lb <= 0) {
            note(findings, 'bad_load', `${label} ${row.exerciseId} ${lb} lb`);
          } else if (Math.abs(lb / stepLb - Math.round(lb / stepLb)) > 1e-6) {
            note(findings, 'off_grid', `${label} ${row.exerciseId} ${lb} lb, step ${stepLb}`);
          }
        }
        if (set.loadPercent !== undefined && (set.loadPercent <= 0 || set.loadPercent > 100)) {
          note(findings, 'bad_percent', `${label} ${row.exerciseId} ${set.loadPercent}%`);
        }
      }
    }
  }
  if (session.contacts.highIntensity > 25) {
    note(findings, 'R85', `${label} ${session.contacts.highIntensity}`);
  }
  if (session.contacts.highAmplitude > 20) {
    note(findings, 'R52', `${label} ${session.contacts.highAmplitude}`);
  }
  if (displayedRowCount(session.blocks) > 8) {
    note(findings, 'max_rows', `${label} ${displayedRowCount(session.blocks)}`);
  }
  if (!Number.isFinite(session.estimatedMinutes) || session.estimatedMinutes <= 0) {
    note(findings, 'bad_minutes', `${label} ${session.estimatedMinutes}`);
  }
}

export function checkWindows(
  findings: Findings,
  label: string,
  skeleton: PlanSkeleton,
  athlete: Athlete,
  today: string,
): void {
  if (skeleton.weeks.length !== skeleton.W) {
    note(findings, 'week_count', `${label}: ${skeleton.weeks.length} vs W ${skeleton.W}`);
  }
  const first = skeleton.weeks[0];
  if (first !== undefined && first.windowStart !== skeleton.programStart) {
    note(findings, 'window_start', `${label}: ${first.windowStart} vs ${skeleton.programStart}`);
  }
  for (let index = 0; index < skeleton.weeks.length; index += 1) {
    const week = skeleton.weeks[index];
    if (week === undefined) continue;
    if (diffDays(week.windowStart, week.windowEnd) !== 6) {
      note(findings, 'window_length', `${label} w${week.w}`);
    }
    const next = skeleton.weeks[index + 1];
    if (next !== undefined && diffDays(week.windowEnd, next.windowStart) !== 1) {
      note(findings, 'window_gap', `${label} w${week.w} to w${next.w}`);
    }
    for (const session of week.sessions) {
      const offset = diffDays(week.windowStart, session.date);
      if (offset < 0 || offset > 6) {
        note(
          findings,
          'session_outside_window',
          `${label} w${week.w} ${session.date} off ${offset}, window ${week.windowStart}..${week.windowEnd}`,
        );
      }
    }
  }
  const last = skeleton.weeks[skeleton.weeks.length - 1];
  const chained =
    diffDays(skeleton.programStart, athlete.targetDate) / 7 + 1 > ruleset.constants.maxLayoutWeeks;
  if (!chained && last !== undefined) {
    if (
      diffDays(last.windowStart, athlete.targetDate) < 0 ||
      diffDays(athlete.targetDate, last.windowEnd) < 0
    ) {
      note(findings, 'target_not_in_last_week', `${label}: ${athlete.targetDate}`);
    }
  }
  if (diffDays(today, skeleton.programStart) < 0) {
    note(findings, 'start_before_today', `${label}: ${skeleton.programStart} < ${today}`);
  }
}

/* ------------------------------------------------------------------- fuzz */

export interface Case {
  athlete: Athlete;
  today: string;
  label: string;
}

export function painCombinations(): { name: string; painStatus: PainStatus[] }[] {
  const singles = PAIN_CASES.filter((entry) => entry.name !== 'none');
  const out = [...PAIN_CASES];
  for (let a = 0; a < singles.length; a += 1) {
    for (let b = a + 1; b < singles.length; b += 1) {
      const left = singles[a];
      const right = singles[b];
      if (left === undefined || right === undefined) continue;
      out.push({
        name: `${left.name} + ${right.name}`,
        painStatus: [...left.painStatus, ...right.painStatus],
      });
    }
  }
  return out;
}

export const EMPTY_INVENTORY: Inventory = {
  ...BARE_INVENTORY,
  kettlebells: false,
  cable: false,
  sled: false,
};

export function inventoryLabel(inventory: Inventory): string {
  if (inventory === FULL_INVENTORY) return 'full';
  if (inventory === BARE_INVENTORY) return 'bare';
  return 'empty';
}

export function* fuzzCases(): Generator<Case> {
  for (const W of [2, 3, 4, 5, 6, 8, 9, 11, 12, 13, 16, 17, 20, 30]) {
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        for (const inventory of [FULL_INVENTORY, BARE_INVENTORY, EMPTY_INVENTORY]) {
          for (const shift of [0, 1, 2, 3, 4, 5, 6]) {
            const today = addDays(PROGRAM_START, shift);
            const athlete: Athlete = {
              ...baseAthlete(),
              level,
              trainingAge,
              daysPerWeek: days,
              weekdays: WEEKDAYS[days],
              inventory,
              targetDate: addDays(PROGRAM_START, (W - 1) * 7 + 7 + ((shift * 3) % 7)),
            };
            yield {
              athlete,
              today,
              label: `W${W}/d${days}/${level}/inv ${inventoryLabel(inventory)}/shift${shift}`,
            };
          }
        }
      }
    }
  }
}

export function* painFuzz(): Generator<Case> {
  for (const pain of painCombinations()) {
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        yield {
          athlete: {
            ...baseAthlete(),
            level,
            trainingAge,
            daysPerWeek: days,
            weekdays: WEEKDAYS[days],
            painStatus: pain.painStatus,
            targetDate: addDays(PROGRAM_START, 11 * 7),
          },
          today: PROGRAM_START,
          label: `pain ${pain.name}/d${days}/${level}`,
        };
      }
    }
  }
}

export function* flagFuzz(): Generator<Case> {
  const combos: { label: string; patch: Partial<Athlete> }[] = [
    { label: 'in season', patch: { inSeason: true } },
    { label: 'no readiness', patch: {} },
    { label: 'under 18', patch: { isAdult: false } },
    { label: 'no bodyweight', patch: { bodyweightKg: null } },
    { label: 'heavy', patch: { bodyweightKg: 120 } },
    { label: 'goal equals baseline', patch: { goalHeightMm: 746.76 } },
    { label: 'no sport', patch: { sport: 'none' } },
    { label: 'volleyball', patch: { sport: 'volleyball' } },
  ];
  for (const combo of combos) {
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        const base = baseAthlete();
        const athlete: Athlete = {
          ...base,
          level,
          trainingAge,
          daysPerWeek: days,
          weekdays: WEEKDAYS[days],
          targetDate: addDays(PROGRAM_START, 11 * 7),
          ...combo.patch,
        };
        if (combo.label === 'under 18') athlete.clearance = { ...base.clearance, isAdult: false };
        if (combo.label === 'no readiness') delete athlete.readinessPassedAt;
        yield { athlete, today: PROGRAM_START, label: `${combo.label}/d${days}/${level}` };
      }
    }
  }
}

/** DST boundaries in America/New_York, a leap year, and a year end. */
export function* dstFuzz(): Generator<Case> {
  const anchors = ['2026-03-02', '2026-10-26', '2027-03-08', '2027-10-25', '2028-02-21', '2026-12-21'];
  for (const anchor of anchors) {
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      yield {
        athlete: {
          ...baseAthlete(),
          daysPerWeek: days,
          weekdays: WEEKDAYS[days],
          targetDate: addDays(anchor, 11 * 7 + 3),
        },
        today: anchor,
        label: `dst ${anchor}/d${days}`,
      };
    }
  }
}

export function stepLbFor(athlete: Athlete): number {
  return athlete.inventory.plates?.smallestPairLb ?? 5;
}

export function runCase(findings: Findings, entry: Case, allWeeks: boolean): void {
  let skeleton: PlanSkeleton;
  try {
    skeleton = planSkeleton(entry.athlete, entry.today, ruleset);
  } catch (error) {
    note(findings, 'skeleton_throw', `${entry.label} today=${entry.today}: ${String(error)}`);
    return;
  }
  checkWindows(findings, entry.label, skeleton, entry.athlete, entry.today);

  const step = stepLbFor(entry.athlete);
  const numbers = allWeeks
    ? skeleton.weeks.map((week) => week.w)
    : [1, Math.ceil(skeleton.W / 2), skeleton.W];
  for (const w of new Set(numbers)) {
    let week: WeekPlan;
    try {
      week = materializeWeek(contextFor(entry.athlete, skeleton, w));
    } catch (error) {
      note(findings, 'materialize_throw', `${entry.label} w${w}: ${String(error)}`);
      continue;
    }
    const skeletonWeek = skeleton.weeks.find((item) => item.w === w);
    for (const session of week.sessions) {
      checkPrescriptions(findings, `${entry.label} w${w} ${session.date}`, session, step);
      if (skeletonWeek === undefined) continue;
      const offset = diffDays(week.windowStart, session.date);
      if (offset < 0 || offset > 6) {
        note(findings, 'plan_session_outside_window', `${entry.label} w${w} ${session.date} off ${offset}`);
      }
    }
    if (week.sessions.length === 0) note(findings, 'empty_week', `${entry.label} w${w}`);
  }
}

/* ------------------------------------------------------------ week chains */

export interface ChainStep {
  /** Fraction of the week's sessions marked complete. */
  completed: number;
  /** True when every prescribed non-ramp set is logged in full. */
  allReps: boolean;
}

export function logsFor(week: WeekPlan, step: ChainStep): { logs: SetLog[]; records: SessionRecord[] } {
  const done = Math.round(week.sessions.length * step.completed);
  const logs: SetLog[] = [];
  const records: SessionRecord[] = [];
  week.sessions.forEach((session, index) => {
    if (index >= done) {
      records.push({
        sessionId: session.id,
        date: session.date,
        dayType: session.dayType,
        status: 'missed',
      });
      return;
    }
    records.push({
      sessionId: session.id,
      date: session.date,
      dayType: session.dayType,
      status: 'done',
      markedCompleteAt: `${session.date}T18:00:00.000Z`,
    });
    for (const block of session.blocks) {
      if (block.name === 'warm_up' || block.name === 'cool_down') continue;
      for (const row of block.exercises) {
        for (const set of row.sets) {
          if (set.isRamp || set.reps === undefined) continue;
          const short = step.allReps ? 0 : 1;
          const entry: SetLog = {
            id: `${session.id}:${row.exerciseId}:${set.setNumber}`,
            sessionId: session.id,
            exerciseId: row.exerciseId,
            setNumber: set.setNumber,
            repsDone: Math.max(1, set.reps - short),
            loadSource: row.loadMode,
            completedAt: `${session.date}T18:00:00.000Z`,
            plannedDate: session.date,
            idempotencyKey: `${session.id}:${row.exerciseId}:${set.setNumber}`,
          };
          if (set.loadKg !== undefined) entry.loadKg = set.loadKg;
          logs.push(entry);
        }
      }
    }
  });
  return { logs, records };
}

/** repeat, repeat, small, progress, hold, then progress to the end. */
export function scriptFor(w: number): ChainStep {
  if (w <= 2) return { completed: 0.4, allReps: true };
  if (w === 3) return { completed: 0.8, allReps: true };
  if (w === 4) return { completed: 1, allReps: true };
  if (w === 5) return { completed: 1, allReps: false };
  return { completed: 1, allReps: true };
}

