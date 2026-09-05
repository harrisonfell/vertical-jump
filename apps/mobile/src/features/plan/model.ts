import type { Adherence, PlanSkeleton, Sport } from '@vert/engine';
import { loadRuleset, sportRequirementsFor, weekIndexOf } from '@vert/engine';
import { readSessionWindow, readWallWork } from '@/lib/engineAthlete';
import type {
  Athlete,
  Block,
  LocalDate,
  Program,
  SessionWithStatus,
  Week,
} from '@/data/types';
import { blockLabelForWeek, blockSegments, type BlockSegment, type SegmentWeek } from './blocks';
import { fromEngineDayType, readSessionIntent, readWeekPlan } from './engine';
import { contextTitle, programHeaderLine } from './header';
import { countAdherence, ladderLine, liveAdherence } from './ladder';
import { applyNotFinished, applyRepeat, type PlanState } from './states';
import { toSessionRecord } from './engine';
import { buildStrip, type Strip, type StripSessionInput, type StripWeekInput } from './weekStrip';
import { weekDayLines } from './weekLines';
import { climbingWeekLines } from './climbLines';

/**
 * The Plan's whole view model, built in one pure pass.
 *
 * The calendar comes from the skeleton, which covers all twelve weeks; the
 * states come from the rows, which only exist for the weeks that have been
 * built. That split is the screen's one real idea: the forward view is
 * planned, the backward view is logged, and the strip shows both at once.
 */

export interface PlanModelInput {
  readonly athlete: Athlete | null;
  readonly program: Program | null;
  readonly skeleton: PlanSkeleton | null;
  readonly blocks: readonly Block[];
  readonly weeks: readonly Week[];
  readonly sessions: readonly SessionWithStatus[];
  readonly today: LocalDate;
  readonly states: ReadonlySet<PlanState>;
}

export interface PlanModel {
  /** "12 weeks · 4 days/wk · 4+ yrs · Mon 8 Sep to Sat 29 Nov". */
  readonly headerLine: string;
  /** "Week 7 of 12 · Power block". */
  readonly title: string;
  readonly currentWeek: number | null;
  readonly totalWeeks: number;
  readonly segments: BlockSegment[];
  readonly strip: Strip;
  /** "Week 7 · 2 of 4 done (50%) · finish 1 more for 75%". */
  readonly ladder: string | null;
  /** The current week's outcome line, its post-generation lines, its days. */
  readonly thisWeekLines: string[];
  readonly earlier: { readonly w: number; readonly line: string }[];
  /**
   * The `houseRuleIds` the current week was built with, so the rules summary
   * can open on the rules that actually shaped it.
   */
  readonly appliedRuleIds: string[];
}

function blockTypeFor(blocks: readonly Block[], w: number): SegmentWeek['blockType'] {
  const block = blocks.find((entry) => entry.weekStart <= w && w <= entry.weekEnd);
  return block?.type === 'power' ? 'power' : 'strength';
}

/** The weeks the band and the strip are drawn from, skeleton first. */
export function segmentWeeks(input: PlanModelInput): SegmentWeek[] {
  if (input.skeleton !== null) {
    return input.skeleton.weeks.map((week) => ({
      w: week.w,
      kind: week.kind,
      blockType: week.blockType,
    }));
  }
  return [...input.weeks]
    .sort((a, b) => a.w - b.w)
    .map((week) => ({ w: week.w, kind: week.kind, blockType: blockTypeFor(input.blocks, week.w) }));
}

function stripWeeks(input: PlanModelInput): StripWeekInput[] {
  const repeats = new Map<number, number>();
  for (const week of input.weeks) {
    if (week.repeatOfWeek !== null) repeats.set(week.w, week.repeatOfWeek);
  }

  const source =
    input.skeleton !== null
      ? input.skeleton.weeks.map((week) => ({
          w: week.w,
          windowStart: week.windowStart,
          kind: week.kind,
          repeatOfWeek: week.repeatOfWeek,
        }))
      : [...input.weeks]
          .sort((a, b) => a.w - b.w)
          .map((week) => ({
            w: week.w,
            windowStart: week.windowStart,
            kind: week.kind,
            ...(week.repeatOfWeek === null ? null : { repeatOfWeek: week.repeatOfWeek }),
          }));

  return source.map((week) => {
    const stored = repeats.get(week.w);
    return stored === undefined ? week : { ...week, repeatOfWeek: stored };
  });
}

/**
 * True when this athlete's sport runs the Upper Strength day as a power day
 * (house rule `house.sc.upper_power_day`).
 *
 * A built session says so itself, on `sessionIntent` in its snapshot. A week
 * that has not been built yet has no session to ask, so the sport's own
 * requirements answer for it: the label on a future Tuesday is the label that
 * Tuesday will carry.
 */
const SPORTS: readonly Sport[] = [
  'basketball',
  'football',
  'soccer',
  'track_field',
  'volleyball',
  'baseball',
  'speed_climbing',
  'none',
];

function upperPowerSport(sport: string | null): boolean {
  const key = SPORTS.find((entry) => entry === sport) ?? 'none';
  return sportRequirementsFor(key, loadRuleset()).upperDayIntent === 'upper_power';
}

/** Stored sessions first; skeleton days fill in the weeks not yet built. */
function stripSessions(input: PlanModelInput): StripSessionInput[] {
  const testDates = new Set<LocalDate>();
  if (input.skeleton !== null) {
    for (const week of input.skeleton.weeks) {
      for (const session of week.sessions) {
        if (session.isTestDay) testDates.add(session.date);
      }
    }
  }

  const byDate = new Map<LocalDate, StripSessionInput>();
  const upperPower = upperPowerSport(input.athlete?.sport ?? null);

  if (input.skeleton !== null) {
    for (const week of input.skeleton.weeks) {
      for (const session of week.sessions) {
        byDate.set(session.date, {
          id: null,
          date: session.date,
          dayType: fromEngineDayType(session.dayType),
          status: 'planned',
          isTest: session.isTestDay,
          upperPower,
        });
      }
    }
  }

  for (const session of input.sessions) {
    const intent = readSessionIntent(session.snapshot);
    byDate.set(session.scheduledDate, {
      id: session.id,
      date: session.scheduledDate,
      dayType: session.dayType,
      status: session.status,
      isTest: session.testStatus !== null || testDates.has(session.scheduledDate),
      upperPower: intent === null ? upperPower : intent === 'upper_power',
    });
  }

  return [...byDate.values()];
}

function adherenceForWeek(input: PlanModelInput, w: number): Adherence | null {
  const week = input.weeks.find((entry) => entry.w === w);
  if (week === undefined) return null;
  const plan = readWeekPlan(week.snapshot);
  const inWindow = input.sessions.filter(
    (session) =>
      session.scheduledDate >= week.windowStart && session.scheduledDate <= week.windowEnd,
  );
  if (plan === null) {
    const completed = inWindow.filter((session) => session.status === 'done').length;
    return countAdherence(Math.max(week.prescribedCount, inWindow.length), completed);
  }
  return liveAdherence(plan, inWindow.map(toSessionRecord));
}

/**
 * The week's sentences, each said once.
 *
 * The stored week snapshot keeps its outcome line inside `lines` as well as on
 * `outcome`, so reading both back naively prints the same sentence twice and
 * React sees two siblings with the same key (defect D-23). The outcome leads
 * because it is the week's verdict; anything that repeats it is dropped.
 *
 * After the week's own sentences come the ones that belong to a single day and
 * name it: the knee-alignment row that moved, the pulling day demoted to light
 * finger work, and a readiness gate that reduced something
 * (`house.sc.rnt_valgus_control`, `house.sc.hard_finger_spacing`,
 * `house.sc.finger_pain_ceiling`, `house.sc.readiness_gate`).
 */
function linesForWeek(input: PlanModelInput, w: number): string[] {
  const week = input.weeks.find((entry) => entry.w === w);
  if (week === undefined) return [];
  const plan = readWeekPlan(week.snapshot);
  if (plan === null) return [];
  const outcome = plan.outcome?.line;
  return uniqueLines([
    ...(outcome === undefined ? [] : [outcome]),
    ...plan.lines,
    ...weekDayLines(plan),
    // The one sentence the generator does not write for itself: where the
    // upper-power day landed and why (`house.sc.sport_requirements`).
    ...climbingWeekLines(plan, {
      wallWork: readWallWork(input.athlete?.wallWork ?? null),
      sessionWindow: readSessionWindow(input.athlete?.sessionWindow ?? null),
    }),
  ]);
}

/** The house rules the current week claimed, read off its stored snapshot. */
function appliedRuleIdsFor(input: PlanModelInput, w: number | null): string[] {
  if (w === null) return [];
  const week = input.weeks.find((entry) => entry.w === w);
  if (week === undefined) return [];
  return [...(readWeekPlan(week.snapshot)?.houseRuleIds ?? [])];
}

/** First occurrence wins, order kept. */
function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    kept.push(line);
  }
  return kept;
}

/** In-season is a program-level fact, so it sits with the week's own lines. */
const IN_SEASON =
  'In-season: jump contacts halved, change of direction covered by games.';

export function buildPlanModel(input: PlanModelInput): PlanModel {
  const weeks = segmentWeeks(input);
  const totalWeeks = input.skeleton?.W ?? weeks.length;
  const start = input.skeleton?.programStart ?? input.program?.startDate ?? input.today;
  const end = input.skeleton?.targetDate ?? input.program?.endDate ?? input.today;
  const currentWeek =
    totalWeeks === 0 ? null : weekIndexOf(start, totalWeeks, input.today);

  const rawStrip = buildStrip({
    weeks: stripWeeks(input),
    sessions: input.states.has('not-finished')
      ? applyNotFinished(stripSessions(input), input.today)
      : stripSessions(input),
    today: input.today,
    currentWeek,
  });

  const strip: Strip = input.states.has('repeat')
    ? { columns: rawStrip.columns, rows: applyRepeat(rawStrip.rows, currentWeek) }
    : rawStrip;

  const adherence = currentWeek === null ? null : adherenceForWeek(input, currentWeek);

  const thisWeekLines = currentWeek === null ? [] : linesForWeek(input, currentWeek);
  if (input.athlete?.inSeason === true || input.states.has('in-season')) {
    if (!thisWeekLines.includes(IN_SEASON)) thisWeekLines.push(IN_SEASON);
  }
  if (input.states.has('repeat') && currentWeek !== null && currentWeek > 1) {
    thisWeekLines.unshift(
      `Week ${currentWeek} repeats week ${currentWeek - 1}: same loads, same sets.`,
    );
  }

  const earlier = [...input.weeks]
    .filter((week) => currentWeek === null || week.w < currentWeek)
    .sort((a, b) => b.w - a.w)
    .flatMap((week) => {
      const plan = readWeekPlan(week.snapshot);
      const line = plan?.outcome?.line;
      return line === undefined ? [] : [{ w: week.w, line }];
    });

  return {
    headerLine: programHeaderLine({
      weeks: totalWeeks,
      daysPerWeek: input.athlete?.daysPerWeek ?? null,
      sport: input.athlete?.sport ?? null,
      trainingAgeYears: input.athlete?.trainingAgeYears ?? null,
      startDate: start,
      endDate: end,
    }),
    title:
      currentWeek === null
        ? 'Plan'
        : contextTitle(currentWeek, totalWeeks, blockLabelForWeek(weeks, currentWeek)),
    currentWeek,
    totalWeeks,
    segments: blockSegments(weeks),
    strip,
    ladder: adherence === null || currentWeek === null ? null : ladderLine(currentWeek, adherence),
    thisWeekLines,
    earlier,
    appliedRuleIds: appliedRuleIdsFor(input, currentWeek),
  };
}
