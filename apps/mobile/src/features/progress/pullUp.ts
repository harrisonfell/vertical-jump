import type { Ruleset } from '@vert/engine';
import { epley, loadExercises, usesAddedLoad } from '@vert/engine';
import {
  displayLoadLb,
  formatAddedLoadSet,
  formatInteger,
  formatLoadLb,
} from '@vert/engine/units';
import { formatInValue } from '@vert/engine/analytics';
import type { LiftSetRow, Week, WorkingMax } from '@/data';
import { formatDayShort } from '../../ui/charts/scale';
import { NO_MAX_LINE } from './derive';
import type { PullUpModel, PullUpPoint, TopSetRow } from './types';

/**
 * Pull-up strength (owner's spec, "Performance Correlates Driving Priority").
 *
 * Pull-up strength is the strongest single correlate with wall time in the
 * owner's spec, so it earns a section beside the jump number rather than one
 * row inside Lifts. Everything here is ADDED load: the athlete's bodyweight is
 * not on the bar, is not on the 5 lb grid, and is never part of the working
 * max, so every row reads "5 × BW + 40 lb" and the trend is a trend of what
 * hangs off the belt (`house.sc.upper_power_day`, engine `usesAddedLoad`).
 */

/** Said once on the screen, under the trend. Numbers are in the spec, not here. */
export const PULL_UP_CORRELATE_LINE =
  'Pull-up strength tracks wall time more closely than any other measure.';

/**
 * Which seeded exercises are added-load lifts, read from the engine rather
 * than listed here, so a weighted chin-up seeded later joins this section
 * without a second list to keep in step.
 */
export function addedLoadExerciseIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const exercise of loadExercises().exercises) {
    if (usesAddedLoad(exercise)) ids.add(exercise.id);
  }
  return ids;
}

/** An added load, snapped to the same 5 lb grid every prescription shows. */
function addedLb(kg: number, ruleset: Ruleset): number {
  return displayLoadLb(kg, 'barbell', ruleset.constants.loadGrid.barbellStepLb);
}

interface DayTop {
  readonly date: string;
  readonly loadKg: number;
  readonly reps: number | null;
  readonly rpe: number | null;
}

/** The heaviest logged set of the lift on each day it was trained. */
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

export interface PullUpInput {
  readonly liftSets: readonly LiftSetRow[];
  readonly weeks: readonly Week[];
  readonly workingMax: Readonly<Record<string, WorkingMax>>;
  readonly ruleset: Ruleset;
  /** Overridable so a test does not have to load the whole seed. */
  readonly addedLoadIds?: ReadonlySet<string>;
}

/**
 * One point a program week: the estimated added-load max behind that week's
 * heaviest logged set.
 *
 * R73's Epley, carrying the same confidence factor the engine folds in, so the
 * line the athlete reads is the estimate the generator would have made from
 * the same set rather than a second arithmetic. A week with no logged pull-up
 * set is a gap, never a repeat of the week before it: a flat segment across a
 * week off would read as strength held when nothing was measured.
 */
export function pullUpTrend(
  tops: readonly DayTop[],
  weeks: readonly Week[],
  ruleset: Ruleset,
): PullUpPoint[] {
  const confidence = ruleset.constants.workingMax.epleyConfidence;
  const maxReps = ruleset.constants.workingMax.epleyMaxReps;
  const points: PullUpPoint[] = [];

  for (const week of [...weeks].sort((a, b) => a.w - b.w)) {
    let best: { top: DayTop; estimateKg: number } | null = null;
    for (const top of tops) {
      if (top.date < week.windowStart || top.date > week.windowEnd) continue;
      const reps = top.reps;
      if (reps === null || !Number.isInteger(reps) || reps < 1 || reps > maxReps) continue;
      if (top.loadKg <= 0) continue;
      const estimateKg = epley(top.loadKg, reps) * confidence;
      if (best === null || estimateKg > best.estimateKg) best = { top, estimateKg };
    }
    if (best === null) continue;
    const lb = addedLb(best.estimateKg, ruleset);
    points.push({
      w: week.w,
      weekLabel: `Wk ${formatInteger(week.w)}`,
      date: best.top.date,
      dateLabel: formatDayShort(best.top.date),
      addedLb: lb,
      label: formatLoadLb(lb),
      fromLabel: formatAddedLoadSet(best.top.reps ?? 0, addedLb(best.top.loadKg, ruleset)),
    });
  }
  return points;
}

/**
 * "entered 40 lb added, 8 Sep" or "est. 40 lb added · Epley from BW + 35 lb × 5,
 * 20 Oct". The evidence set reads in the added-load notation, because that is
 * what the runner showed when it was logged.
 */
export function pullUpSourceLine(
  max: WorkingMax | undefined,
  tops: readonly DayTop[],
  ruleset: Ruleset,
): string {
  if (max === undefined) return NO_MAX_LINE;
  const lb = `${formatLoadLb(addedLb(max.valueKg, ruleset))} added`;
  const on = max.frozenAt === null ? null : formatDayShort(max.frozenAt.slice(0, 10));
  if (max.source === 'entered') return on === null ? `entered ${lb}` : `entered ${lb}, ${on}`;
  const word = max.source === 'epley' ? 'Epley' : 'RPE';
  const evidence = tops[tops.length - 1];
  const from =
    evidence === undefined || evidence.reps === null
      ? null
      : formatAddedLoadSet(evidence.reps, addedLb(evidence.loadKg, ruleset));
  const parts = [`est. ${lb}`, from === null ? word : `${word} from ${from}`];
  if (on !== null) parts.push(on);
  return `${parts[0]} · ${parts.slice(1).join(', ')}`;
}

/**
 * The last load drop on the lift, in plain words.
 *
 * R97 drops the working max 5% after a failed week and 10% on the second
 * failure, so a fall of about that size between two top sets is the drop
 * showing in the logs; anything smaller is the week's own wave.
 */
export function pullUpDropLine(tops: readonly DayTop[]): string | null {
  for (let index = tops.length - 1; index > 0; index -= 1) {
    const current = tops[index];
    const previous = tops[index - 1];
    if (current === undefined || previous === undefined) continue;
    if (previous.loadKg <= 0) continue;
    const change = (current.loadKg - previous.loadKg) / previous.loadKg;
    if (change > -0.04) continue;
    return `Loads −${Math.round(Math.abs(change) * 100)}% after missed reps · ${formatDayShort(current.date)}`;
  }
  return null;
}

/** How much of a line there is, said before it is read. */
export function pullUpTrendCaption(points: readonly PullUpPoint[]): string {
  if (points.length === 0) return 'No weighted pull-up sets logged yet.';
  if (points.length === 1) {
    return `One week on file (${points[0]?.label ?? ''}). A line needs a second week.`;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return '';
  const change = last.addedLb - first.addedLb;
  const sign = change < 0 ? '−' : '+';
  const move =
    change === 0
      ? 'level'
      : `${sign}${formatInteger(Math.abs(change))} lb`;
  return `${formatInteger(points.length)} weeks · ${first.label} to ${last.label} · ${move}`;
}

/**
 * The Pull-up strength section, or null before the first weighted pull-up set
 * is logged. Only added-load lifts qualify; an ordinary bodyweight pull-up has
 * no load to trend.
 */
export function buildPullUp(input: PullUpInput): PullUpModel | null {
  const ids = input.addedLoadIds ?? addedLoadExerciseIds();
  const mine = input.liftSets.filter((set) => ids.has(set.exerciseId));
  const first = mine[0];
  if (first === undefined) return null;

  // One section, not one a variant: a cluster row is the same lift with a cue
  // on it, so its sets belong to the same trend. The section is named after
  // whichever variant has the most sets on file.
  const counts = new Map<string, { name: string; count: number }>();
  for (const set of mine) {
    const entry = counts.get(set.exerciseId) ?? { name: set.exerciseName, count: 0 };
    entry.count += 1;
    counts.set(set.exerciseId, entry);
  }
  let leadId = first.exerciseId;
  let leadName = first.exerciseName;
  let leadCount = 0;
  for (const [id, entry] of counts) {
    if (entry.count > leadCount) {
      leadCount = entry.count;
      leadId = id;
      leadName = entry.name;
    }
  }

  const tops = topSetsByDay(mine);
  const max = input.workingMax[leadId];
  const trend = pullUpTrend(tops, input.weeks, input.ruleset);

  return {
    exerciseId: leadId,
    name: leadName,
    workingMaxLb:
      max === undefined ? null : `${formatLoadLb(addedLb(max.valueKg, input.ruleset))} added`,
    sourceLine: pullUpSourceLine(max, tops, input.ruleset),
    dropLine: pullUpDropLine(tops),
    trend,
    trendCaption: pullUpTrendCaption(trend),
    topSets: tops
      .slice()
      .reverse()
      .map((top): TopSetRow => ({
        date: top.date,
        dateLabel: formatDayShort(top.date),
        setLabel:
          top.reps === null
            ? `BW + ${formatLoadLb(addedLb(top.loadKg, input.ruleset))}`
            : formatAddedLoadSet(top.reps, addedLb(top.loadKg, input.ruleset)),
        rpe: top.rpe === null ? '' : `RPE ${formatInValue(top.rpe)}`,
      })),
    correlateLine: PULL_UP_CORRELATE_LINE,
  };
}
