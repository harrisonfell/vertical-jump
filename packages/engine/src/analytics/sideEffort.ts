/**
 * Per-side effort on unilateral work (house rule `house.sc.asymmetry_tracking`).
 *
 * A single-leg jump test measures a gap, but it only exists on a test day. A
 * unilateral lift logged per side carries the same signal every week it is
 * trained: at the same load for the same reps, the leg that reports the higher
 * RPE is doing more work to move the same weight, so it is the weaker side.
 * Three single-leg RDL sets at 30, 35 and 40 lb where the right leg never
 * passes RPE 6 and the left reaches 8 is a two-point gap, and that is enough to
 * put the left leg first without waiting for a test day.
 *
 * It is never a canonical test, never a personal record, and never a jump: it
 * decides an ordering and it writes a line. The measured gap from a single-leg
 * test outranks it wherever both exist, because inches are a measurement and an
 * RPE is a report.
 */
import type { Side } from '../types/core.js';
import { kgToLb, roundHalfUp } from '../units.js';

/**
 * A gap smaller than this many RPE points reads as level. One chip on the
 * row's scale is the smallest answer the athlete can give, so half of one is
 * the smallest gap that cannot be a single mis-tap.
 */
export const EFFORT_BAND_RPE = 0.5;

/**
 * What a per-side read needs from a logged set. Every `SetLog` satisfies it,
 * and so does any row a screen has already narrowed, which is why it is stated
 * here rather than taking `SetLog` and making a caller rebuild one.
 */
export interface SidedSetInput {
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  side?: Side | null;
  rpe?: number | null;
  loadKg?: number | null;
  repsDone?: number | null;
}

/** One set on a named side, reduced to what a pair needs, nothing null. */
interface SidedSet {
  /** Session, exercise and set number together: what makes two legs one set. */
  key: string;
  setNumber: number;
  exerciseId: string;
  side: Side;
  rpe: number;
  /** Rounded to a tenth of a pound, so a kilogram round trip never splits a pair. */
  loadLb: number | undefined;
  reps: number | undefined;
}

/** One set the athlete answered on both sides, at the same load and reps. */
export interface SidePair {
  setNumber: number;
  exerciseId: string;
  leftRpe: number;
  rightRpe: number;
  /** Left minus right: positive means the left leg worked harder. */
  gap: number;
}

/** What the logged sides say, once at least one pair is matched. */
export interface SideEffortReading {
  /** The sets answered on both sides at the same load and reps. */
  pairs: SidePair[];
  /** Mean RPE across the matched pairs, left leg. */
  leftRpe: number;
  /** Mean RPE across the matched pairs, right leg. */
  rightRpe: number;
  /** Mean of the per-pair gaps, so positive means the left leg worked harder. */
  gap: number;
  /** Null inside the band: no side is named from one chip of difference. */
  harderSide: Side | null;
  /** Second person, numbers first, no rule number. */
  line: string;
}

function optional(value: number | null | undefined): number | undefined {
  return value === null || value === undefined ? undefined : value;
}

function sidedSets(logs: readonly SidedSetInput[]): SidedSet[] {
  const out: SidedSet[] = [];
  for (const log of logs) {
    const side = log.side;
    const rpe = optional(log.rpe);
    if ((side !== 'left' && side !== 'right') || rpe === undefined) continue;
    const loadKg = optional(log.loadKg);
    out.push({
      // Pairs never cross a session or an exercise: set 1 of today's split
      // squat has nothing to do with set 1 of last week's RDL.
      key: `${log.sessionId} ${log.exerciseId} ${log.setNumber}`,
      setNumber: log.setNumber,
      exerciseId: log.exerciseId,
      side,
      rpe,
      loadLb: loadKg === undefined ? undefined : roundHalfUp(kgToLb(loadKg), 1),
      reps: optional(log.repsDone),
    });
  }
  return out;
}

/** Two sets are the same work when their load and their reps both agree. */
function sameWork(a: SidedSet, b: SidedSet): boolean {
  return a.loadLb === b.loadLb && a.reps === b.reps;
}

/** An RPE reads as a whole number or one decimal, never "6.0". */
function rpeWords(rpe: number): string {
  return `${roundHalfUp(rpe, 1)}`;
}

function effortLine(leftRpe: number, rightRpe: number, harderSide: Side | null): string {
  const efforts = `Left RPE ${rpeWords(leftRpe)}, right RPE ${rpeWords(rightRpe)} at the same loads.`;
  if (harderSide === null) return `${efforts} Level, so neither leg leads.`;
  return `${efforts} The ${harderSide} leg is working harder, so it goes first.`;
}

/** The pairs, matched leg to leg inside one session, exercise and set number. */
function pairsFrom(logs: readonly SidedSetInput[]): SidePair[] {
  const sets = sidedSets(logs);
  const pairs: SidePair[] = [];
  for (const left of sets) {
    if (left.side !== 'left') continue;
    const right = sets.find(
      (candidate) =>
        candidate.side === 'right' && candidate.key === left.key && sameWork(candidate, left),
    );
    if (right === undefined) continue;
    pairs.push({
      setNumber: left.setNumber,
      exerciseId: left.exerciseId,
      leftRpe: left.rpe,
      rightRpe: right.rpe,
      gap: left.rpe - right.rpe,
    });
  }
  return pairs.sort((a, b) => {
    if (a.exerciseId !== b.exerciseId) return a.exerciseId < b.exerciseId ? -1 : 1;
    return a.setNumber - b.setNumber;
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Read the sides out of logged sets.
 *
 * @param logs sets logged per side, any order, any number of exercises. Sets
 *   with no side or no RPE are ignored, so a row tapped once for both legs never
 *   invents a gap.
 * @param bandRpe a gap this small or smaller reads as level.
 * @returns null until one set carries both legs at the same load and reps,
 *   because a heavier left leg is a different set, not a gap.
 */
export function readSideEffort(
  logs: readonly SidedSetInput[],
  bandRpe: number = EFFORT_BAND_RPE,
): SideEffortReading | null {
  const pairs = pairsFrom(logs);
  if (pairs.length === 0) return null;

  const leftRpe = mean(pairs.map((pair) => pair.leftRpe));
  const rightRpe = mean(pairs.map((pair) => pair.rightRpe));
  const gap = mean(pairs.map((pair) => pair.gap));
  const harderSide: Side | null = Math.abs(gap) <= bandRpe ? null : gap > 0 ? 'left' : 'right';
  return {
    pairs,
    leftRpe,
    rightRpe,
    gap,
    harderSide,
    line: effortLine(leftRpe, rightRpe, harderSide),
  };
}

/**
 * The weaker side as logged unilateral work reports it, or null when the logs
 * do not name one. Handed to `weakerSideFrom` as the signal that stands in for
 * a single-leg test the athlete has not taken yet.
 */
export function harderSideFrom(
  logs: readonly SidedSetInput[],
  bandRpe: number = EFFORT_BAND_RPE,
): Side | null {
  return readSideEffort(logs, bandRpe)?.harderSide ?? null;
}

/**
 * The per-side tail of the last-time line: "left RPE 8, right RPE 6". Absent
 * when the two sides read the same effort, because a line that repeats itself
 * tells the athlete nothing the loads have not already said.
 */
export function sideEffortTail(logs: readonly SidedSetInput[]): string | undefined {
  const reading = readSideEffort(logs);
  if (reading === null || reading.gap === 0) return undefined;
  return `left RPE ${rpeWords(reading.leftRpe)}, right RPE ${rpeWords(reading.rightRpe)}`;
}
