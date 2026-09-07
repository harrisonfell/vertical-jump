// INTERPRETATION
// ---------------------------------------------------------------------------
// Rule 0 order, as this engine applies it, and who owns each step. The rule
// book is king; where brief section 09 names an override or a house rule, the
// named rule wins. Every step below is pure and takes its inputs from
// MaterializeContext: no clock, no Math.random, no I/O.
//
//  0. Load the ruleset and freeze the snapshot         ruleset/index.ts
//  1. BLOCK 1 Safety and pain. The self-screen gate     select/painGate.ts
//     (R2), severity and duration derivation, R3 to
//     R18 site rules, R20 to R22 at any severity, the
//     R1 under-18 cap, tendon protocols, house
//     templates for hamstring, hip and other. Produces
//     PainGateResult; nothing downstream may loosen it.
//  2. BLOCK 4 Volume, CNS, contacts. The week's         budgets.ts
//     extensive target E = clamp(bottom + 10k - 2H,     skeleton/index.ts
//     bottom, top) (R89 house), the hard caps R85 and
//     R52, the depth-jump rep budget, deload, taper
//     and peak factors, and heavy lifts per session
//     (R67). Read off the skeleton's targets.
//  3. BLOCK 5 Progression and phase. Week w-1's         adherence/index.ts
//     adherence, the outcome (R94 to R98 plus the       prescribe/workingMax.ts
//     added hold), R130 and R131 house magnitudes,
//     R110 plateau and R111 velocity swaps, the
//     block and layout position, the ladder rungs,
//     and the frozen working maxes (R72 to R74, R97,
//     the week-2 guard).
//  4. BLOCK 2 Session structure and ordering. Warm-up   select/index.ts
//     first, primer, primary block by day type, then
//     R31 to R44 ordering, the two-high-CNS cap and
//     the joint budgets R23 to R26.
//  5. BLOCK 3 Exercise selection and equipment. R19     select/index.ts
//     and R45 to R56, the pairing rules R47 to R50,
//     rotation R57, and the 8-exercise trim.
//  6. BLOCK 6 Per-set load prescription, a display      prescribe/index.ts
//     layer applied last. Scheme by load type, the      materialize/block6.ts
//     R156 start, the R161 descent, R155 held sets,     units.ts
//     R157 ramp sets, every cap lowest-wins, R162
//     rounding, and R164 rest. It never changes
//     selection.
//  7. Post-pass: R27 soreness reduction for today only, materialize.ts
//     the contact recount and hard-cap assertion, the
//     Plan's post-generation lines, and the snapshot.
// ---------------------------------------------------------------------------
import { CONTACT_CAPS, MAXIMAL_CNS_TOP_SET_PCT } from './budgets.js';
import { indexById } from './exercises/index.js';
import { mulberry32 } from './prng.js';
import { outcomeLine } from './adherence/index.js';
import { weekAt } from './skeleton/index.js';
import { evaluatePainGate } from './select/painGate.js';
import { selectSession, type SelectContext } from './select/assemble.js';
import { displayedRowCount } from './select/order.js';
import { estimateMinutes, prescribeSessionRows, type Block6Context } from './materialize/block6.js';
import { assertWeekInvariants } from './materialize/invariants.js';
import {
  houseRuleIdsFor,
  readinessStepLb,
  readinessSuffixFor,
  scoreReadinessToday,
} from './materialize/climbing.js';
import { applyReadinessAdjustment } from './readiness/index.js';
import {
  advancedSkeletonFor,
  frozenAtFor,
  holdWeekIndexes,
  outcomeDetail,
  priorOutcome,
  resolveWorkingMaxes,
} from './materialize/outcome.js';
import {
  deferTest,
  headerSuffixesFor,
  isReduced,
  ladderRungsFor,
  noticesFor,
  sorenessForSession,
  weekLines,
} from './materialize/lines.js';
import type { GenerationSnapshot, MaterializeContext, SessionPlan, WeekPlan } from './types/plan.js';

export * from './materialize/climbing.js';
export * from './materialize/copy.js';
export * from './materialize/block6.js';
export * from './materialize/invariants.js';
export * from './materialize/outcome.js';
export * from './materialize/lines.js';
// The multi-week half. Both import `materializeWeek` from here, so they are
// re-exported after it rather than beside the single-week modules.
export * from './materialize/chain.js';
export * from './materialize/project.js';

/** Thrown when Block 1's self-screen refuses to generate at all (R2). */
export class GenerationBlockedError extends Error {
  readonly sentence: string;

  constructor(sentence: string) {
    super(sentence);
    this.name = 'GenerationBlockedError';
    this.sentence = sentence;
  }
}

/** One session inside an already-decided week. */
export function materializeSession(
  context: MaterializeContext,
  sessionIndex: number,
): SessionPlan {
  const week = weekAt(context.skeleton, context.w);
  if (week === undefined) throw new RangeError(`no week ${context.w} in this program`);
  const sessions = materializeWeek(context).sessions;
  const session = sessions[sessionIndex];
  if (session === undefined) throw new RangeError(`no session ${sessionIndex} in week ${context.w}`);
  return session;
}

/** Build week w of the program from its skeleton and the prior week's logs. */
export function materializeWeek(context: MaterializeContext): WeekPlan {
  const { ruleset, athlete } = context;
  const byId = indexById(context.exercises);
  const painGate = evaluatePainGate(
    {
      clearance: athlete.clearance,
      painStatus: athlete.painStatus,
      isAdult: athlete.isAdult,
      today: context.today,
    },
    ruleset,
  );
  if (painGate.blocksGeneration) {
    throw new GenerationBlockedError(painGate.clearanceScreen?.sentence ?? 'Medical clearance needed.');
  }

  const { adherence, decision } = priorOutcome(context);
  const advanced = advancedSkeletonFor(context, decision);

  const base = weekAt(advanced, context.w);
  if (base === undefined) throw new RangeError(`no week ${context.w} in this program`);
  const week = ladderRungsFor(context, base);
  const { workingMaxes, sourceLogs } = resolveWorkingMaxes(context, week, decision);

  const firstProgramWeek1 = context.w === 1 && context.history.firstProgram !== false;
  const block = advanced.blocks.find(
    (entry) => context.w >= entry.weekFrom && context.w <= entry.weekTo,
  );
  const isBlockStart = block !== undefined && block.weekFrom === context.w;
  const isFirstBlock = advanced.blocks[0] === block;
  const restrictedSentence =
    painGate.clearanceScreen?.kind === 'severe_pain'
      ? painGate.clearanceScreen.sentence
      : undefined;

  const holdWeeks = holdWeekIndexes(context);
  const prng = mulberry32(context.seed);
  const sessions: SessionPlan[] = [];
  let deferAt = -1;
  // House `house.sc.readiness_gate`: scored once for the day, before any
  // session is built, because `holdVolume` binds the extensive target the
  // generator spends and a built session cannot un-take a raise.
  const readiness = scoreReadinessToday(context);
  const readinessStep = readinessStepLb(athlete);

  week.sessions.forEach((skeletonSession, index) => {
    const soreness = sorenessForSession(context, skeletonSession);
    const reduced = isReduced(soreness, ruleset);
    const isToday = skeletonSession.date === context.today;
    const fingerPain = isToday ? context.history.fingerPainToday ?? null : null;
    const selectContext: SelectContext = {
      athlete,
      ruleset,
      exercises: context.exercises,
      ladders: context.ladders,
      week,
      session: skeletonSession,
      painGate,
      rotationHistory: context.history.rotationHistory,
      jointHighStressLastWeek: context.history.jointHighStressLastWeek,
      prng: prng.fork(`w${context.w}:d${skeletonSession.dayIndex}`),
      isFirstBlock,
      blockTransition: isBlockStart,
      plateau: context.history.testPlateau,
      workingMaxUp10: Object.values(context.history.liftRaisedSinceBlockStart).some(Boolean),
      sorenessReduction: reduced,
      fingerPainToday: fingerPain,
      holdExtensiveRaise: isToday && readiness?.adjustment.holdVolume === true,
    };
    const selected = selectSession(selectContext);
    const block6: Block6Context = {
      athlete,
      ruleset,
      exercises: context.exercises,
      week,
      W: advanced.W,
      workingMaxes,
      workingMaxLogs: sourceLogs,
      painCaps: painGate.caps,
      isFirstProgramWeek1: firstProgramWeek1,
      percentWeekIndexByLift: context.history.percentWeekIndexByLift ?? {},
      previousLogs: context.prevWeek?.logs ?? [],
      holdWeekIndexByExercise: holdWeeks,
      dayType: skeletonSession.dayType,
    };
    if (selected.sessionIntent !== undefined) block6.sessionIntent = selected.sessionIntent;
    if (painGate.lines[0] !== undefined) block6.painCapReason = painGate.lines[0];
    if (soreness !== null) block6.sorenessToday = soreness;

    let prescribed = prescribeSessionRows(selected, block6);
    prescribed.headerSuffixes = headerSuffixesFor(
      week,
      prescribed,
      context,
      painGate.restricted,
      firstProgramWeek1,
    );
    prescribed.notices = noticesFor(prescribed, week, context, soreness, isBlockStart, byId);
    // Today only, downward only, and every reduced set keeps its unreduced
    // twin in `original` (house `house.sc.readiness_gate`).
    if (isToday && readiness !== undefined) {
      const suffix = readinessSuffixFor(readiness);
      prescribed = applyReadinessAdjustment(prescribed, readiness, {
        exercisesById: byId,
        stepLb: readinessStep,
      });
      if (suffix !== undefined) prescribed.headerSuffixes = [...prescribed.headerSuffixes, suffix];
      prescribed.estimatedMinutes = estimateMinutes(prescribed.blocks, ruleset);
    }
    prescribed.isMaximalCns = isMaximalCns(prescribed, context);
    sessions.push(prescribed);
    if (reduced && prescribed.isTestDay) deferAt = index;
  });

  if (deferAt >= 0) {
    deferTest(sessions, deferAt, {
      ruleset,
      byId,
      isMaximalCns: (session) => isMaximalCns(session, context),
    });
  }

  const snapshot: GenerationSnapshot = {
    adherenceUsed: adherence.pct,
    outcome: decision?.kind ?? 'progress',
    workingMaxes,
    targets: week.targets,
    k: week.k,
    seed: context.seed,
    rulesetVersion: ruleset.version,
    generatedAt: frozenAtFor(context, week),
  };

  const plan: WeekPlan = {
    w: week.w,
    kind: week.kind,
    blockType: week.blockType,
    windowStart: week.windowStart,
    windowEnd: week.windowEnd,
    sessions,
    snapshot,
    lines: [],
  };
  if (decision !== undefined) {
    const detail = outcomeDetail(context, decision, sessions, byId);
    plan.outcome = {
      kind: decision.kind,
      line: outcomeLine(context.w - 1, adherence, decision, detail),
    };
  }
  if (week.repeatOfWeek !== undefined) plan.repeatOfWeek = week.repeatOfWeek;
  const houseRuleIds = houseRuleIdsFor(plan, context, byId);
  if (houseRuleIds.length > 0) plan.houseRuleIds = houseRuleIds;
  plan.lines = weekLines(
    plan,
    week,
    context,
    isBlockStart,
    firstProgramWeek1,
    restrictedSentence,
    byId,
  );

  assertWeekInvariants(plan, context);
  return plan;
}

/**
 * House definition (brief section 09): a heavy-strength top set at or above
 * 85 percent or RPE 8.5, or 10 or more high-intensity contacts, or any
 * depth-jump session. The test day always qualifies.
 */
export function isMaximalCns(session: SessionPlan, context: MaterializeContext): boolean {
  if (session.isTestDay) return true;
  if (session.contacts.highIntensity >= 10) return true;
  const byId = indexById(context.exercises);
  for (const block of session.blocks) {
    for (const row of block.exercises) {
      if (byId.get(row.exerciseId)?.readinessRequired === true) return true;
      if (row.loadType !== 'heavy_strength') continue;
      for (const set of row.sets) {
        if ((set.loadPercent ?? 0) >= MAXIMAL_CNS_TOP_SET_PCT) return true;
        if ((set.targetRpe ?? 0) >= context.ruleset.constants.rpeCap.intermediate) return true;
      }
    }
  }
  return false;
}

/** Rows the 8-exercise cap counts, re-exported for the invariant grid. */
export { displayedRowCount };

/** The hard contact caps, re-exported so callers need not reach into budgets. */
export { CONTACT_CAPS };
