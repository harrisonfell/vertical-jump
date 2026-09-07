import { ObservedWeekError } from '@vert/engine';
import type { PreviousWeekContext, SetLog as EngineSetLog } from '@vert/engine';
import { revisionStore } from '@/data';
import type { Json, LocalDate, SessionWithStatus } from '@/data/types';
import { nextUnstartedWeek, type WeekProgress } from '../settings/regenerate';
import { readWeekPlan, toSessionRecord } from './engine';

/**
 * When the plan is rebuilt, from which week, and out of what.
 *
 * Everything here is pure, so the confirm sheet, the automatic trigger on
 * Today and the tests all read the same arithmetic. The mutation in
 * `useRevise.ts` does the writing; this file only decides.
 *
 * The whole feature rests on one honest split. Weeks the athlete has touched
 * are evidence and are never rewritten. Weeks that have not opened yet are a
 * projection: the plan as it would go if every week went as written. A week
 * with real outcomes turns the weeks after it from a guess into a better
 * guess, and that is all a revision is.
 */

/** How the newest version row says the current projections were derived. */
export const FIRST_BUILD_REASON = 'first build';

/** The Settings row, and the caption under it. */
export const REVISE_LABEL = 'Revise plan';
export const REVISE_CAPTION = 'Rebuilds every unstarted week from what you have logged.';
export const NOTHING_TO_REVISE = 'Nothing to revise yet';

/**
 * `revised from week 3`, the reason stored on the new version row.
 *
 * The number is the last week actually **folded** into the projection, which
 * is the week before the first rebuilt one, not the newest week that happens
 * to hold a log. Those differ the moment a set is logged out of order: with
 * week 4 trained and one set entered late against week 6, the fold reads weeks
 * 1 to 4 and nothing else, so recording 6 here would claim evidence the
 * projection never saw and would then refuse to revise when week 5 is finally
 * logged.
 */
export function revisionReason(foldedThrough: number): string {
  return `revised from week ${foldedThrough}`;
}

/**
 * The week the current projections were derived from, read back out of the
 * newest version row's reason.
 *
 * Deriving it from the reason keeps the trigger to data the app already
 * stores: no new column, no new key. Nothing else reads that string
 * programmatically, and a reason from any other path (a settings
 * regeneration, say) reads as 0, which simply means "no outcomes folded in
 * yet".
 */
export function projectedFromReason(reason: string | null | undefined): number {
  if (typeof reason !== 'string') return 0;
  const match = /^revised from week (\d+)$/.exec(reason.trim());
  if (match === null) return 0;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The week a **finished** settings regeneration rebuilt from, read back out of
 * the newest version row's layout.
 *
 * A regeneration that rebuilt weeks `N..W` has already folded weeks 1 to `N-1`
 * in, exactly as a revision from week `N` would have, so the trigger must read
 * it as such or the very next Today mount would revise again over weeks written
 * moments earlier: the same content under new ids, and a version row per mount.
 *
 * `rebuiltWeeks` is what separates a finished regeneration from one whose
 * rebuild threw, and from the rows an older build wrote before a regeneration
 * rebuilt anything at all. Both of those read as 0 here, which leaves the
 * trigger armed so the automatic revision repairs them.
 */
export function projectedFromLayout(layout: Json): number {
  if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) return 0;
  const record = layout as Record<string, unknown>;
  const rebuilt = record['rebuiltWeeks'];
  if (!Array.isArray(rebuilt) || rebuilt.length === 0) return 0;
  const fromWeek = record['fromWeek'];
  if (typeof fromWeek !== 'number' || !Number.isFinite(fromWeek) || fromWeek < 1) return 0;
  return fromWeek - 1;
}

/**
 * The skeleton a settings regeneration stored on its version row, if that is
 * what this layout is.
 *
 * A regeneration re-plans the whole skeleton from the athlete's new answers
 * and writes it as `{ fromWeek, skeleton, changedFields }` on a new version
 * row. It never updates `program.snapshot`. A revision that read the snapshot
 * would therefore rebuild every unstarted week from the answers the athlete
 * has just replaced: four days a week after they moved to three, the old
 * target date, the old wall days.
 *
 * The other two layouts on that column are arrays, from the first build and
 * from a revision, and neither carries a skeleton. Returns null for both.
 */
export function regeneratedSkeleton(layout: Json): Json | null {
  if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) return null;
  const inner = (layout as Record<string, unknown>)['skeleton'];
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return null;
  return inner as Json;
}

/**
 * One week, reduced to what the trigger needs: its number, when its window
 * opens, and whether anything in it is logged. The same shape the settings
 * regeneration reads, deliberately.
 */
export type ReviseWeekFacts = WeekProgress;

/** The newest week that has anything logged in it, or 0 for none. */
export function observedThroughWeek(weeks: readonly ReviseWeekFacts[]): number {
  let highest = 0;
  for (const week of weeks) {
    if (week.loggedSets > 0 && week.w > highest) highest = week.w;
  }
  return highest;
}

export interface RevisionTargetInput {
  readonly weeks: readonly ReviseWeekFacts[];
  readonly today: LocalDate;
  /** The newest `program_version.reason`. */
  readonly latestReason: string | null | undefined;
  /**
   * The newest `program_version.week_layout`. A revision records the week it
   * projected from in its reason; a settings regeneration records it in this
   * layout, because its reason has to stay the sentence the version history
   * shows. Optional, so a caller that only has the reason still reads right.
   */
  readonly latestLayout?: Json;
}

export interface RevisionTarget {
  /** The first week that may be rebuilt, or null when none is left. */
  readonly fromWeek: number | null;
  readonly observedThrough: number;
  /**
   * The last week a revision would actually fold in: everything below
   * `fromWeek` is evidence, everything from it on is rewritten. This, not
   * `observedThrough`, is what the version row records and what the trigger
   * compares against.
   */
  readonly foldedThrough: number;
  readonly projectedFrom: number;
  /** The last week of the program, so the copy can name the range. */
  readonly lastWeek: number;
  /** True when there are new outcomes and somewhere to put them. */
  readonly shouldRevise: boolean;
}

/**
 * The automatic trigger, as arithmetic over rows Today already loads.
 *
 * Revise when the fold would now reach further than it did when the current
 * projections were written, there is something logged to fold, and there is
 * still an unstarted week to rebuild. `nextUnstartedWeek` is the settings
 * regeneration's own selection, reused rather than rewritten: a week counts as
 * begun once its window opens or anything in it is logged, so neither path can
 * rewrite a week the athlete is standing in.
 *
 * The comparison is on `foldedThrough` rather than `observedThrough` because
 * the two come apart when a set is logged out of order. A stray set entered
 * late against a week the fold has not reached would otherwise be recorded as
 * the week the projection came from, and the weeks in between could then be
 * trained without the trigger ever firing again.
 */
export function revisionTarget(input: RevisionTargetInput): RevisionTarget {
  const fromWeek = nextUnstartedWeek(input.weeks, input.today);
  const observedThrough = observedThroughWeek(input.weeks);
  const foldedThrough = fromWeek === null ? 0 : fromWeek - 1;
  // Either kind of rebuild counts. A revision names its fold in the reason, a
  // finished regeneration in the layout, and whichever reached further is what
  // the current projections were written from.
  const projectedFrom = Math.max(
    projectedFromReason(input.latestReason),
    projectedFromLayout(input.latestLayout ?? null),
  );
  const lastWeek = input.weeks.reduce((highest, week) => Math.max(highest, week.w), 0);
  return {
    fromWeek,
    observedThrough,
    foldedThrough,
    projectedFrom,
    lastWeek,
    // `observedThrough > 0` keeps a brand new program still: its early windows
    // open on their own, and rebuilding a projection from no outcomes at all
    // would be churn that changes nothing.
    shouldRevise: fromWeek !== null && observedThrough > 0 && foldedThrough > projectedFrom,
  };
}

/** The confirm sheet, and the state of the row that opens it. */
export interface RevisePlanCopy {
  readonly title: string;
  readonly lines: readonly string[];
  readonly confirmLabel: string;
  /** The caption under the Settings row. */
  readonly caption: string;
  readonly disabled: boolean;
}

/** What the sheet says before anything is written. */
export function revisePlanCopy(target: RevisionTarget): RevisePlanCopy {
  const { fromWeek, lastWeek, foldedThrough } = target;

  if (fromWeek === null) {
    return {
      title: 'No weeks left to rebuild',
      lines: ['This program has no unstarted weeks, so there is nothing to rebuild.'],
      confirmLabel: 'Close',
      caption: NOTHING_TO_REVISE,
      disabled: true,
    };
  }

  const range = fromWeek === lastWeek ? `Week ${fromWeek}` : `Weeks ${fromWeek} to ${lastWeek}`;
  // The week the fold reaches, not the newest week holding a log: a set
  // entered late against a week further on is not evidence this rebuild sees.
  const source =
    target.observedThrough === 0 || foldedThrough === 0
      ? 'Nothing is logged yet, so they are rebuilt from the plan as written.'
      : `They are rebuilt from what you logged through week ${foldedThrough}.`;

  return {
    title: `Revise from week ${fromWeek}?`,
    lines: [
      `${range} are rebuilt.`,
      source,
      // There is no week 0 to keep, so the line that names what is kept has to
      // change rather than read "Weeks 1 to 0".
      fromWeek === 1
        ? 'Nothing is logged yet, so the whole program is rebuilt.'
        : `Weeks 1 to ${fromWeek - 1} keep their sessions and their logs.`,
      'A session with anything logged in it is never touched.',
      'The old version stays readable in the Plan version history.',
    ],
    confirmLabel: `Revise from week ${fromWeek}`,
    caption: target.shouldRevise ? REVISE_CAPTION : NOTHING_TO_REVISE,
    disabled: !target.shouldRevise,
  };
}

/**
 * True when a week has been touched: a logged set anywhere in it, or a session
 * marked complete.
 *
 * By the way `fromWeek` is chosen this can never be true for a week a revision
 * is about to rebuild. The guard is kept anyway, because "a session with any
 * set log or a completed record is never touched" should be true by inspection
 * of the write, not by an argument about the read that preceded it.
 */
export function weekHasWork(sessions: readonly SessionWithStatus[]): boolean {
  return sessions.some(
    (session) => session.loggedSetCount > 0 || session.markedCompleteAt !== null,
  );
}

/** One week the athlete really trained, as the store holds it. */
export interface ObservedWeekSource {
  readonly w: number;
  /** The stored `WeekPlan`, from `week.snapshot`. */
  readonly snapshot: Json;
  readonly sessions: readonly SessionWithStatus[];
  /** The week's real set logs, already in the engine's shape. */
  readonly logs: readonly EngineSetLog[];
}

/**
 * The observed weeks in the shape `foldObservedWeeks` reads.
 *
 * Every session record is renamed to the id the engine's own plan uses, the
 * same remap `listWeekEngineLogs` does for the logs. Without it adherence
 * matches nothing and every real week folds in as a hold.
 */
export function toObservedWeeks(
  sources: readonly ObservedWeekSource[],
): PreviousWeekContext[] {
  return [...sources]
    .sort((a, b) => a.w - b.w)
    .map((source) => {
      const plan = readWeekPlan(source.snapshot);
      if (plan === null) {
        throw new ObservedWeekError(
          source.w,
          `Week ${source.w} has no readable saved plan, so it cannot be revised.`,
        );
      }
      const sessions = [...source.sessions]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((session) => ({
          ...toSessionRecord(session),
          sessionId: revisionStore.engineSessionId(session.snapshot, source.w, session.orderIndex),
        }));
      return { plan, logs: [...source.logs], sessions };
    });
}
