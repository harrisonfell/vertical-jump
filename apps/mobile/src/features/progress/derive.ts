import {
  TIMES,
  displayLoadLb,
  formatHeightValueIn,
  formatInteger,
  formatLoadLb,
  formatLoadedSet,
  formatVelocity,
  kgToLb,
  mmToIn,
} from '@vert/engine/units';
import {
  NON_REACTIVE_GCT_MS,
  computeRsi,
  formatInValue,
  formatPercentWhole,
  instrumentLabel,
  jumpReadiness,
  outcomeWord,
  weeklyReviewLine,
} from '@vert/engine/analytics';
import type { JumpTestWithReps, LiftSetRow, SessionWithStatus, Week } from '@/data';
import { formatDayLong, formatDayShort } from '../../ui/charts/scale';
import { toEngineTest } from './streams';
import type {
  LedgerRow,
  LiftRow,
  ReadinessRep,
  ReadinessRow,
  TopSetRow,
  WeekRow,
} from './types';

/**
 * What a figure reads when the number is genuinely absent. Words rather than a
 * dash, so a screen reader says something and the athlete is told a fact.
 */
export const NO_VALUE = 'No data';

/**
 * The line on a lift with no working max yet (brief section 06).
 *
 * Settings declares the same sentence for the same state; the two should be
 * one constant in the engine, which is where the third copy of it lives.
 */
export const NO_MAX_LINE = 'No 1RM yet · log load and effort; prescribed after 2 sets';

/** Sessions grouped by the week they belong to. */
export function sessionsByWeek(
  sessions: readonly SessionWithStatus[],
): Map<string, SessionWithStatus[]> {
  const map = new Map<string, SessionWithStatus[]>();
  for (const session of sessions) {
    const list = map.get(session.weekId) ?? [];
    list.push(session);
    map.set(session.weekId, list);
  }
  return map;
}

/** Session RPE times minutes, summed. Strain is evidence; this is the load. */
export function weekSrpe(sessions: readonly SessionWithStatus[]): number | null {
  let total = 0;
  let counted = 0;
  for (const session of sessions) {
    if (session.rpe === null) continue;
    const start = session.startedAt;
    const end = session.markedCompleteAt;
    if (start === null || end === null) continue;
    const minutes = (Date.parse(end) - Date.parse(start)) / 60000;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    total += session.rpe * minutes;
    counted += 1;
  }
  return counted === 0 ? null : total;
}

/** Mean recovery over a window, or null when no morning was scored. */
export function meanRecovery(scores: readonly (number | null)[]): number | null {
  const present = scores.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export interface WeekRowInput {
  readonly weeks: readonly Week[];
  readonly sessions: readonly SessionWithStatus[];
  readonly programWeeks: number;
  readonly currentW: number | null;
  readonly tests: readonly JumpTestWithReps[];
  readonly recoveryByDay: ReadonlyMap<string, number | null>;
  readonly trendInPerWk: number | null;
  readonly requiredInPerWk: number | null;
}

/**
 * One row a week, oldest first, with the review line the week would print.
 *
 * Adherence is counted from the sessions themselves rather than from the
 * week's cached columns: a session finished after the week was built still
 * counts in the ledger, and the cache is only refreshed at generation.
 */
export function weekRows(input: WeekRowInput): WeekRow[] {
  const grouped = sessionsByWeek(input.sessions);
  const rows: WeekRow[] = [];

  for (const week of input.weeks) {
    const inWeek = grouped.get(week.id) ?? [];
    if (inWeek.length === 0 && week.prescribedCount === 0) continue;
    const scheduled = inWeek.length > 0 ? inWeek.length : week.prescribedCount;
    const completed = inWeek.filter((session) => session.status === 'done').length;
    const test = input.tests.find(
      (entry) =>
        entry.canonical &&
        entry.localDate >= week.windowStart &&
        entry.localDate <= week.windowEnd &&
        entry.bestHeightMm !== null,
    );
    const days: (number | null)[] = [];
    for (const session of inWeek) days.push(input.recoveryByDay.get(session.scheduledDate) ?? null);

    const isCurrent = input.currentW === week.w;
    const line = weeklyReviewLine({
      weekNumber: week.w,
      programWeeks: input.programWeeks,
      completed,
      scheduled,
      outcome: week.outcome,
      testMm: test?.bestHeightMm ?? null,
      trendInPerWk: isCurrent ? input.trendInPerWk : null,
      requiredInPerWk: isCurrent ? input.requiredInPerWk : null,
      avgRecovery: meanRecovery(days),
      loadSrpe: weekSrpe(inWeek),
    });

    rows.push({
      w: week.w,
      label: `${week.w}${week.repeatOfWeek === null ? '' : ` (repeat of ${week.repeatOfWeek})`}`,
      sessions: `${completed}/${scheduled}`,
      percent: scheduled === 0 ? '0%' : formatPercentWhole(completed / scheduled),
      allReps: week.allRepsCompleted === null ? '' : week.allRepsCompleted ? 'yes' : 'no',
      outcome: week.outcome === null ? '' : outcomeWord(week.outcome),
      reviewLine: line,
      isCurrent,
    });
  }
  return rows;
}

/** The ledger: every test on every stream, newest first. */
export function ledgerRows(tests: readonly JumpTestWithReps[]): LedgerRow[] {
  return [...tests]
    .reverse()
    .map((test): LedgerRow => {
      const attempts = test.reps.filter((rep) => rep.heightMm !== null);
      return {
        id: test.id,
        date: test.localDate,
        dateLabel: formatDayLong(test.localDate),
        instrumentLabel: instrumentLabel(test.instrument),
        mode: test.mode,
        attempts: attempts.length,
        flagged: attempts.filter((rep) => rep.flagged).length,
        bestIn: test.bestHeightMm === null ? '' : formatHeightValueIn(test.bestHeightMm),
        spreadIn: test.spreadMm === null ? '' : formatHeightValueIn(test.spreadMm),
        canonical: test.canonical,
        isBaseline: test.isBaseline,
        isPr: test.isPr,
        bodyweightLb: test.bodyweightKg === null ? null : formatLoadLb(kgToLb(test.bodyweightKg)),
        notes: test.notes,
      };
    });
}

/** Bodyweight beside tests: one reading a test, newest first. */
export function bodyweightRows(
  tests: readonly JumpTestWithReps[],
): { readonly date: string; readonly lb: string }[] {
  return [...tests]
    .reverse()
    .filter((test) => test.bodyweightKg !== null)
    .map((test) => ({
      date: formatDayShort(test.localDate),
      lb: formatLoadLb(kgToLb(test.bodyweightKg ?? 0)),
    }));
}

/**
 * A load, snapped to the barbell display grid.
 *
 * Settings prints working maxes through the same pair, so the same kilogram
 * value cannot read as 265 lb on one screen and 267 lb on another.
 */
function loadLine(kg: number): string {
  return formatLoadLb(displayLoadLb(kg, 'barbell'));
}

/** The heaviest logged set of one lift on one day. */
interface DayTop {
  readonly date: string;
  readonly loadKg: number;
  readonly reps: number | null;
  readonly rpe: number | null;
}

function topSetsByDay(sets: readonly LiftSetRow[]): DayTop[] {
  const byDay = new Map<string, DayTop>();
  for (const set of sets) {
    if (set.loadKg === null) continue;
    const current = byDay.get(set.localDate);
    if (current === undefined || set.loadKg > current.loadKg) {
      byDay.set(set.localDate, {
        date: set.localDate,
        loadKg: set.loadKg,
        reps: set.repsDone,
        rpe: set.rpe,
      });
    }
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The last load drop on a lift, in plain words.
 *
 * R97 drops the working max 5% after a failed week and 10% on the second
 * failure, so a fall of about that size between two top sets is the drop
 * showing up in the logs. Anything smaller is the week's own wave.
 */
export function dropLineFor(tops: readonly DayTop[]): string | null {
  for (let index = tops.length - 1; index > 0; index -= 1) {
    const current = tops[index];
    const previous = tops[index - 1];
    if (current === undefined || previous === undefined) continue;
    const change = (current.loadKg - previous.loadKg) / previous.loadKg;
    if (change > -0.04) continue;
    const percent = Math.round(Math.abs(change) * 100);
    return `Loads −${percent}% after missed reps · ${formatDayShort(current.date)}`;
  }
  return null;
}

export interface LiftRowInput {
  readonly liftSets: readonly LiftSetRow[];
  readonly workingMax: Readonly<
    Record<string, { readonly valueKg: number; readonly source: string; readonly frozenAt: string | null }>
  >;
}

/** One row a loadable lift, numbers first and a chart only after four points. */
export function liftRows(input: LiftRowInput): LiftRow[] {
  const byLift = new Map<string, LiftSetRow[]>();
  for (const set of input.liftSets) {
    const list = byLift.get(set.exerciseId) ?? [];
    list.push(set);
    byLift.set(set.exerciseId, list);
  }

  const rows: LiftRow[] = [];
  for (const [exerciseId, sets] of byLift) {
    const first = sets[0];
    if (first === undefined) continue;
    const tops = topSetsByDay(sets);
    const max = input.workingMax[exerciseId];

    const velocityPoints = sets
      .filter((set) => set.meanVelocityBest !== null && set.loadKg !== null)
      .map((set) => ({
        loadLb: kgToLb(set.loadKg ?? 0),
        velocityMs: set.meanVelocityBest ?? 0,
      }));

    rows.push({
      exerciseId,
      name: first.exerciseName,
      workingMaxLb: max === undefined ? null : loadLine(max.valueKg),
      sourceLine: workingMaxSource(max, tops),
      dropLine: dropLineFor(tops),
      topSets: tops
        .slice()
        .reverse()
        .map((top): TopSetRow => ({
          date: top.date,
          dateLabel: formatDayShort(top.date),
          setLabel:
            top.reps === null
              ? loadLine(top.loadKg)
              : formatLoadedSet(top.reps, displayLoadLb(top.loadKg, 'barbell')),
          rpe: top.rpe === null ? '' : `RPE ${formatInValue(top.rpe)}`,
        })),
      velocityPoints,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "entered 275 lb, 1 Sep" or "est. 275 lb · Epley from 265 lb × 3, 9 Sep".
 *
 * The evidence set reads load then reps, which is the engine's own
 * `workingMaxSourceLine` wording; Today shows that line for the same set, and
 * the two must not disagree about which number is the load.
 */
function workingMaxSource(
  max: { readonly valueKg: number; readonly source: string; readonly frozenAt: string | null } | undefined,
  tops: readonly DayTop[],
): string {
  if (max === undefined) {
    return NO_MAX_LINE;
  }
  const lb = loadLine(max.valueKg);
  const on = max.frozenAt === null ? null : formatDayShort(max.frozenAt.slice(0, 10));
  if (max.source === 'entered') {
    return on === null ? `entered ${lb}` : `entered ${lb}, ${on}`;
  }
  const word = max.source === 'epley' ? 'Epley' : 'RPE';
  const evidence = tops[tops.length - 1];
  const from =
    evidence === undefined || evidence.reps === null
      ? null
      : `${loadLine(evidence.loadKg)} ${TIMES} ${formatInteger(evidence.reps)}`;
  const parts = [`est. ${lb}`, from === null ? word : `${word} from ${from}`];
  if (on !== null) parts.push(on);
  return `${parts[0]} · ${parts.slice(1).join(', ')}`;
}

/**
 * Jump readiness, one row a drop-jump session.
 *
 * Reps over 250 ms are non-reactive and leave the average; they are counted
 * and shown rather than dropped, because a session that drifted slow is the
 * signal, not a rounding detail.
 */
export function readinessRows(tests: readonly JumpTestWithReps[]): ReadinessRow[] {
  return tests
    .map((test) => jumpReadiness(toEngineTest(test)))
    .filter((stats) => stats.reactiveReps + stats.nonReactiveReps > 0)
    .reverse()
    .map((stats): ReadinessRow => ({
      id: stats.testId,
      date: stats.date,
      dateLabel: formatDayShort(stats.date),
      reactive: stats.reactiveReps,
      nonReactive: stats.nonReactiveReps,
      meanRsi: stats.meanRsi === null ? '' : formatVelocity(stats.meanRsi),
      bestRsi: stats.bestRsi === null ? '' : formatVelocity(stats.bestRsi),
      meanGct: stats.meanGctMs === null ? '' : `${formatInteger(stats.meanGctMs)} ms`,
      bestHeight: stats.bestHeightIn === null ? '' : formatInValue(stats.bestHeightIn),
    }));
}

/** Every attempt of the newest drop-jump session, non-reactive reps marked. */
export function readinessReps(tests: readonly JumpTestWithReps[]): ReadinessRep[] {
  const newest = tests[tests.length - 1];
  if (newest === undefined) return [];
  const reps: ReadinessRep[] = [];
  for (const rep of toEngineTest(newest).reps) {
    const gct = rep.gctMs;
    if (gct === undefined) continue;
    const rsi = rep.rsiCalc ?? computeRsi(rep);
    reps.push({
      repNumber: rep.repNumber,
      heightIn: formatInValue(mmToIn(rep.heightMm)),
      gctMs: `${formatInteger(gct)} ms`,
      rsi: rsi === null ? '' : formatVelocity(rsi),
      reactive: gct <= NON_REACTIVE_GCT_MS,
    });
  }
  return reps;
}
