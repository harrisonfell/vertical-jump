/**
 * How an outcome moves the skeleton forward.
 *
 * Progress, small and hold change only the weeks after w: k, the extensive
 * floor, the R156 starting offsets (reset at every block start, R107) and the
 * ladder rungs. A repeat (R94) clones week w's targets into week w + 1 and
 * pays for the extra week by taking a load week off the longest remaining
 * block, then the taper, then flagging the date (brief section 09 "Outcomes at
 * generation" and section 06 "Repeat week").
 */
import type { OutcomeDecision } from '../types/logs.js';
import type { PlanBlock, PlanSkeleton, SkeletonTargets, SkeletonWeek } from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';
import { blocksFor } from './layout.js';
import { advanceRungs, raiseStartOffsets, zeroStartOffsets } from './targets.js';

/** The exact copy the Plan shows when no load week is left to remove. */
export const DATE_AT_RISK_LINE = 'Target date at risk: no load weeks left to remove. Move the date?';

/** What a repeat cost the program. */
export interface RepeatAbsorption {
  skeleton: PlanSkeleton;
  /** The week number whose load week was removed, when one was. */
  removedLoadWeek?: number;
  /** True when the taper was spent instead of a load week. */
  droppedTaper: boolean;
  /** True when nothing was left to give and the target date is now at risk. */
  dateAtRisk: boolean;
}

/** What an outcome did to the skeleton. */
export interface SkeletonAdvance extends RepeatAbsorption {
  outcome: OutcomeDecision['kind'];
}

function recomputeBlocks(weeks: readonly SkeletonWeek[]): PlanBlock[] {
  return blocksFor(weeks.map((week) => ({ w: week.w, kind: week.kind, blockType: week.blockType })));
}

/** Weeks re-anchored to the fixed calendar windows and sessions, in order. */
function reanchor(original: readonly SkeletonWeek[], sequence: readonly SkeletonWeek[]): SkeletonWeek[] {
  const weeks: SkeletonWeek[] = [];
  for (let index = 0; index < original.length; index += 1) {
    const anchor = original[index];
    const source = sequence[index];
    if (anchor === undefined || source === undefined) continue;
    weeks.push({
      ...source,
      w: anchor.w,
      windowStart: anchor.windowStart,
      windowEnd: anchor.windowEnd,
      sessions: anchor.sessions,
    });
  }
  return weeks;
}

/**
 * The index of the load week to give up: the last load week of whichever
 * block still has the most load weeks left after `fromIndex`. Ties go to the
 * later block, so the Strength block keeps its length while it can.
 */
function loadWeekToRemove(sequence: readonly SkeletonWeek[], fromIndex: number): number {
  const counts = new Map<string, number[]>();
  for (let index = fromIndex; index < sequence.length; index += 1) {
    const week = sequence[index];
    if (week === undefined || week.kind !== 'load') continue;
    // A repeat clone is the week this absorption is paying FOR, not a load
    // week it may spend: counting it would let every repeat remove the clone
    // it just inserted, and the pool would never drain.
    if (week.repeatOfWeek !== undefined) continue;
    const key = week.blockType;
    const list = counts.get(key) ?? [];
    list.push(index);
    counts.set(key, list);
  }
  let best: number[] = [];
  for (const list of counts.values()) {
    if (list.length > best.length || (list.length === best.length && list.length > 0)) best = list;
  }
  return best[best.length - 1] ?? -1;
}

/**
 * A repeat (R94) costs the longest remaining block a load week, then the
 * taper, then flags the date. Returns the skeleton with the weeks re-laid on
 * the same calendar windows.
 */
export function absorbRepeatDetailed(
  skeleton: PlanSkeleton,
  w: number,
  ruleset: Ruleset,
): RepeatAbsorption {
  void ruleset;
  const original = skeleton.weeks;
  const repeatedIndex = original.findIndex((week) => week.w === w);
  if (repeatedIndex < 0) return { skeleton, droppedTaper: false, dateAtRisk: false };
  const repeated = original[repeatedIndex];
  if (repeated === undefined || repeatedIndex + 1 >= original.length) {
    return { skeleton, droppedTaper: false, dateAtRisk: false };
  }

  const clone: SkeletonWeek = {
    ...repeated,
    k: repeated.k,
    targets: { ...repeated.targets, ladderRungs: { ...repeated.targets.ladderRungs } },
    repeatOfWeek: w,
    notes: [`Repeat of week ${w}: same loads, same sets.`],
  };

  const sequence = [...original];
  sequence.splice(repeatedIndex + 1, 0, clone);
  const removeIndex = loadWeekToRemove(sequence, repeatedIndex + 2);
  if (removeIndex >= 0) {
    const removed = sequence[removeIndex];
    sequence.splice(removeIndex, 1);
    const weeks = reanchor(original, sequence);
    return {
      skeleton: { ...skeleton, weeks, blocks: recomputeBlocks(weeks) },
      removedLoadWeek: removed?.w,
      droppedTaper: false,
      dateAtRisk: false,
    };
  }

  const taperIndex = sequence.findIndex(
    (week, index) => index > repeatedIndex + 1 && week.kind === 'taper',
  );
  if (taperIndex >= 0) {
    sequence.splice(taperIndex, 1);
    const weeks = reanchor(original, sequence);
    return {
      skeleton: { ...skeleton, weeks, blocks: recomputeBlocks(weeks) },
      droppedTaper: true,
      dateAtRisk: false,
    };
  }

  const nextIndex = repeatedIndex + 1;
  const weeks = original.map((week, index) => {
    if (index !== nextIndex) return week;
    // The line is a fact about the program, not an event: repeating again must
    // not stack another copy of it on the same week.
    if (week.kind === 'peak') {
      return { ...week, notes: [...new Set([...week.notes, DATE_AT_RISK_LINE])] };
    }
    return {
      ...clone,
      w: week.w,
      windowStart: week.windowStart,
      windowEnd: week.windowEnd,
      sessions: week.sessions,
      notes: [...new Set([...clone.notes, DATE_AT_RISK_LINE])],
    };
  });
  return {
    skeleton: { ...skeleton, weeks, blocks: recomputeBlocks(weeks) },
    droppedTaper: false,
    dateAtRisk: true,
  };
}

/** The contract signature: the repeated skeleton alone. */
export function absorbRepeat(skeleton: PlanSkeleton, w: number, ruleset: Ruleset): PlanSkeleton {
  return absorbRepeatDetailed(skeleton, w, ruleset).skeleton;
}

function raiseFloor(targets: SkeletonTargets, contacts: number): SkeletonTargets {
  if (contacts === 0) return targets;
  return {
    ...targets,
    extensiveBottom: Math.min(targets.extensiveTop, targets.extensiveBottom + contacts),
  };
}

function cutVolume(targets: SkeletonTargets, cutPct: number): SkeletonTargets {
  if (cutPct <= 0) return targets;
  const keep = 1 - cutPct / 100;
  return {
    ...targets,
    extensiveBottom: Math.round(targets.extensiveBottom * keep),
    extensiveTop: Math.round(targets.extensiveTop * keep),
    highIntensityAllowance: Math.floor(targets.highIntensityAllowance * keep),
    depthJumpReps: Math.floor(targets.depthJumpReps * keep),
  };
}

/**
 * Apply week w's outcome to every week after it. The weeks up to and
 * including w are untouched: their prescriptions are already history.
 *
 * `advancesThisBlock` is how many ladder rungs the current block has already
 * spent, which the caller carries in `MaterializeHistory.ladderState`.
 */
export function applyOutcomeToSkeleton(
  skeleton: PlanSkeleton,
  w: number,
  decision: OutcomeDecision,
  ruleset: Ruleset,
  advancesThisBlock = 0,
): SkeletonAdvance {
  const base =
    decision.kind === 'repeat'
      ? absorbRepeatDetailed(skeleton, w, ruleset)
      : { skeleton, droppedTaper: false, dateAtRisk: false };

  // R107: a new block starts at the low end of each range, so every week from
  // the next block start onward is reset, not just the block's first week.
  const blockStartOf = (week: number): number => {
    const block = base.skeleton.blocks.find(
      (entry) => week >= entry.weekFrom && week <= entry.weekTo,
    );
    return block?.weekFrom ?? 1;
  };
  const judged = base.skeleton.weeks.find((week) => week.w === w);
  const nextK = (judged?.k ?? 0) + decision.deltaK;

  const weeks = base.skeleton.weeks.map((week) => {
    if (week.w <= w) return week;
    let targets = raiseFloor(week.targets, decision.deltaExtensiveContacts);
    targets = {
      ...targets,
      startOffsetPct:
        blockStartOf(week.w) > w
          ? zeroStartOffsets()
          : raiseStartOffsets(week.targets.startOffsetPct, decision.deltaStartPct),
      ladderRungs: advanceRungs(
        week.targets.ladderRungs,
        week.kind,
        decision.allowLadderAdvance,
        advancesThisBlock,
        ruleset,
      ),
    };
    if (week.w === w + 1) targets = cutVolume(targets, decision.volumeCutPct);
    return { ...week, k: nextK, targets };
  });

  return {
    ...base,
    outcome: decision.kind,
    skeleton: { ...base.skeleton, weeks },
  };
}
