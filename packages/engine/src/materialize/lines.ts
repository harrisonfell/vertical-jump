/**
 * Everything the materializer writes on a week or a session once the rows are
 * chosen: the ladder rungs it reads, the R27 soreness answer for today, the
 * header suffixes, the notices, the Plan lines and the deferred test.
 */
import * as copy from './copy.js';
import { estimateMinutes } from './block6.js';
import { jointReductions } from './outcome.js';
import { countContacts } from '../budgets.js';
import { displayedRowCount } from '../select/order.js';
import { planRntSessions } from '../select/sport.js';
import type { ExerciseId, SessionBlockName } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type {
  MaterializeContext,
  SessionPlan,
  SkeletonWeek,
  WeekPlan,
} from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';

export function ladderRungsFor(context: MaterializeContext, week: SkeletonWeek): SkeletonWeek {
  const state = context.history.ladderState;
  if (Object.keys(state).length === 0) return week;
  const rungs = { ...week.targets.ladderRungs };
  for (const [ladderId, entry] of Object.entries(state)) rungs[ladderId] = entry.rung;
  return { ...week, targets: { ...week.targets, ladderRungs: rungs } };
}

export function sorenessForSession(context: MaterializeContext, session: { date: string }): number | null {
  const answer = context.history.sorenessToday;
  if (answer === null || answer === undefined) return null;
  return session.date === context.today ? answer : null;
}

export function isReduced(value: number | null, ruleset: Ruleset): boolean {
  return value !== null && value >= ruleset.constants.soreness.threshold;
}

export function headerSuffixesFor(
  week: SkeletonWeek,
  session: SessionPlan,
  context: MaterializeContext,
  restricted: boolean,
  firstProgramWeek1: boolean,
): string[] {
  const out: string[] = [];
  if (session.isTestDay) out.push(copy.SUFFIX.testDay);
  if (week.kind === 'deload') out.push(copy.SUFFIX.deload);
  if (week.kind === 'taper') out.push(copy.SUFFIX.taper);
  if (week.kind === 'peak') out.push(copy.SUFFIX.peak);
  if (week.repeatOfWeek !== undefined) out.push(copy.repeatSuffix(week.repeatOfWeek));
  if (context.athlete.inSeason) out.push(copy.SUFFIX.inSeason);
  if (firstProgramWeek1) out.push(copy.SUFFIX.week1);
  if (restricted) out.push(copy.SUFFIX.restricted);
  return out;
}

export function noticesFor(
  session: SessionPlan,
  week: SkeletonWeek,
  context: MaterializeContext,
  soreness: number | null,
  isBlockStart: boolean,
  byId: ReadonlyMap<ExerciseId, Exercise>,
): string[] {
  const constants = context.ruleset.constants;
  const out: string[] = [...session.notices];
  if (week.kind === 'deload') out.push(copy.deloadNotice(week.w, context.skeleton.W));
  if (week.kind === 'taper') out.push(copy.taperNotice(week.w, context.skeleton.W));
  if (isReduced(soreness, context.ruleset) && soreness !== null) {
    out.push(copy.sorenessNotice(soreness, constants.soreness.percentDrop));
  }
  if (isBlockStart && week.blockType === 'power') {
    const mainLift = byId.get(week.targets.mainLiftBySlot.lower);
    out.push(copy.blockTransitionNotice(week.w, mainLift?.name ?? 'The main lift', 3));
  }
  if (session.trimmed.length > 0) {
    const names = session.trimmed.map((entry) => byId.get(entry.exerciseId)?.name ?? entry.exerciseId);
    out.push(copy.trimmedNotice(constants.maxDisplayedExercises, names));
  }
  return out;
}


/**
 * The Plan's post-generation lines derivable from a materialized week alone:
 * the week-kind notice, the repeat label, the tendon line, the trims and the
 * maximal-CNS count. `materializeWeek` stores the full set in `week.lines`.
 */
export function postGenerationLines(week: WeekPlan, ruleset: Ruleset): string[] {
  const lines: string[] = [];
  if (week.outcome !== undefined) lines.push(week.outcome.line);
  if (week.repeatOfWeek !== undefined) {
    lines.push(`Repeat of week ${week.repeatOfWeek}: same loads, same sets.`);
  }
  const trimmed = week.sessions.flatMap((session) => session.trimmed);
  if (trimmed.length > 0) {
    lines.push(
      copy.trimmedNotice(
        ruleset.constants.maxDisplayedExercises,
        trimmed.map((entry) => entry.exerciseId),
      ),
    );
  }
  return lines;
}

export function tendonEntries(
  week: WeekPlan,
  byId: ReadonlyMap<ExerciseId, Exercise>,
): { name: string; weekdayLabel: string; extraSet: boolean }[] {
  const out: { name: string; weekdayLabel: string; extraSet: boolean }[] = [];
  for (const session of week.sessions) {
    const hasDepthJump = session.blocks.some((block) =>
      block.exercises.some((row) => byId.get(row.exerciseId)?.readinessRequired === true),
    );
    for (const block of session.blocks) {
      for (const row of block.exercises) {
        const exercise = byId.get(row.exerciseId);
        if (exercise?.tendonTarget === undefined) continue;
        out.push({
          name: exercise.name,
          weekdayLabel: copy.weekdayLabelOf(session.date, session.weekday),
          extraSet: hasDepthJump,
        });
      }
    }
  }
  return out;
}

export function weekLines(
  week: WeekPlan,
  skeletonWeek: SkeletonWeek,
  context: MaterializeContext,
  isBlockStart: boolean,
  firstProgramWeek1: boolean,
  restrictedSentence: string | undefined,
  byId: ReadonlyMap<ExerciseId, Exercise>,
): string[] {
  const lines: string[] = [];
  if (week.outcome !== undefined) lines.push(week.outcome.line);
  lines.push(...skeletonWeek.notes);
  if (isBlockStart && skeletonWeek.blockType === 'power') {
    const mainLift = byId.get(skeletonWeek.targets.mainLiftBySlot.lower);
    lines.push(copy.blockTransitionNotice(skeletonWeek.w, mainLift?.name ?? 'The main lift', 3));
  }
  for (const entry of jointReductions(context)) {
    lines.push(copy.jointReductionLine(entry.joint, entry.lastWeek, entry.thisWeek));
  }
  if (context.athlete.trainingAge === 'none') {
    lines.push(copy.tendonRunwayLine(skeletonWeek.targets.tendonMode));
  }
  const tendon = tendonEntries(week, byId);
  if (tendon.length > 0) lines.push(copy.tendonLine(tendon));
  const rotated = week.sessions.flatMap((session) =>
    session.blocks.flatMap((block) =>
      block.exercises.filter((row) => row.rotationNote !== undefined).map((row) => row.name),
    ),
  );
  if (rotated.length > 0) lines.push(copy.accessoryRotationLine(rotated));
  // House `house.sc.rnt_valgus_control`: "If no session is far enough from the
  // wall, the row moves to the next one that is and says why." The day it
  // moved OFF carries no RNT row, so the explanation belongs to the week.
  lines.push(...planRntSessions(skeletonWeek.sessions, context.athlete, context.ruleset).movedLines);
  if (context.athlete.sport === 'basketball' && !context.athlete.inSeason) {
    lines.push(copy.BASKETBALL_LINE);
  }
  if (firstProgramWeek1) lines.push(copy.WEEK1_LINE);
  if (context.athlete.inSeason) lines.push(copy.IN_SEASON_LINE);
  if (restrictedSentence !== undefined) lines.push(copy.restrictedLine(restrictedSentence));
  return [...new Set(lines)];
}



/** What `deferTest` needs to leave both sessions consistent after the move. */
export interface DeferTestOptions {
  ruleset: Ruleset;
  byId: ReadonlyMap<ExerciseId, Exercise>;
  /** The house maximal-CNS test, so this file does not reach into selection. */
  isMaximalCns: (session: SessionPlan) => boolean;
}

/** Blocks the re-trim may take a row from, lowest priority first. */
const DEFER_TRIM_ORDER: SessionBlockName[] = [
  'cod',
  'conditioning',
  'accessory',
  'injury_prevention_core',
  'secondary',
  'primer',
  'power',
  'recovery',
];

/**
 * The session a deferred test rides. R119 excludes high-CNS work from a
 * recovery session, so a real training day is preferred; when the week has
 * none left the recovery day takes it and stops being a recovery session.
 */
function receivingSession(sessions: readonly SessionPlan[], index: number): SessionPlan | undefined {
  for (let at = index + 1; at < sessions.length; at += 1) {
    const candidate = sessions[at];
    if (candidate !== undefined && candidate.dayType !== 'recovery_mobility') return candidate;
  }
  return sessions[index + 1];
}

/** The 8-row cap is a hard checklist item, so the receiver is trimmed again. */
function retrim(session: SessionPlan, options: DeferTestOptions): void {
  const max = options.ruleset.constants.maxDisplayedExercises;
  let guard = 0;
  while (displayedRowCount(session.blocks) > max && guard < 32) {
    guard += 1;
    let removed = false;
    for (const name of DEFER_TRIM_ORDER) {
      const block = session.blocks.find((entry) => entry.name === name);
      if (block === undefined) continue;
      const at = [...block.exercises]
        .reverse()
        .find((row) => options.byId.get(row.exerciseId)?.tendonTarget === undefined);
      if (at === undefined) continue;
      block.exercises = block.exercises.filter((row) => row !== at);
      session.trimmed = [
        ...session.trimmed,
        {
          exerciseId: at.exerciseId,
          reason: `Trimmed to keep the session at ${max} exercises`,
        },
      ];
      removed = true;
      break;
    }
    if (!removed) break;
  }
  session.blocks = session.blocks.filter((block) => block.exercises.length > 0);
}

/** Contacts, minutes and the maximal-CNS flag, redone from the blocks. */
function recount(session: SessionPlan, options: DeferTestOptions): void {
  session.contacts = countContacts(session.blocks, options.byId, session.contacts.targetExtensive);
  session.estimatedMinutes = estimateMinutes(session.blocks, options.ruleset);
  session.isMaximalCns = options.isMaximalCns(session);
}

/**
 * Move a soreness-deferred test onto the next scheduled session (brief 09:
 * "a scheduled test is deferred", "a deferred test rides the next session,
 * after the warm-up and before the main lift").
 *
 * Both sessions are left consistent: the donor stops being the test day and
 * gives up the test's contacts, the receiver is re-trimmed to the 8-row cap
 * and recounted, and neither keeps a stale header suffix. When the week has no
 * later session the test is not moved at all, so a status never disagrees with
 * the blocks.
 */
export function deferTest(
  sessions: SessionPlan[],
  index: number,
  options: DeferTestOptions,
): void {
  const from = sessions[index];
  if (from === undefined) return;
  const testBlock = from.blocks.find((block) => block.name === 'jump_test');
  if (testBlock === undefined) return;
  const to = receivingSession(sessions, index);
  if (to === undefined) return;

  from.blocks = from.blocks.filter((block) => block.name !== 'jump_test');
  from.isTestDay = false;
  from.testStatus = 'deferred';
  from.headerSuffixes = from.headerSuffixes.filter((entry) => entry !== copy.SUFFIX.testDay);
  from.notices = [
    ...from.notices,
    copy.testDeferredNotice(copy.weekdayLabelOf(to.date, to.weekday)),
  ];

  const warmUpAt = to.blocks.findIndex((block) => block.name === 'warm_up');
  to.blocks = [
    ...to.blocks.slice(0, warmUpAt + 1),
    testBlock,
    ...to.blocks.slice(warmUpAt + 1),
  ];
  // R118 and R119: a session carrying 5 maximal jump attempts is not a
  // recovery session any more, so it takes the day type the test came from
  // rather than keeping a recovery intent it no longer has.
  if (to.dayType === 'recovery_mobility') to.dayType = from.dayType;
  to.isTestDay = true;
  to.testStatus = 'planned';
  if (!to.headerSuffixes.includes(copy.SUFFIX.testDay)) {
    to.headerSuffixes = [copy.SUFFIX.testDay, ...to.headerSuffixes];
  }
  retrim(to, options);
  recount(from, options);
  recount(to, options);
}
