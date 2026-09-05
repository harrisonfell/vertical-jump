/**
 * The layout table from brief section 09 "Blocks and layout", read out of the
 * ruleset so the Plan's rules summary and the generator never disagree.
 * Beginners always get a Strength block first at W of 4 or more.
 */
import type { LayoutRow, LayoutSpan, Ruleset } from '../types/ruleset.js';
import type { BlockType, Level, WeekKind } from '../types/core.js';
import type { PlanBlock } from '../types/plan.js';

/** One week of the layout, expanded from its span. */
export interface LayoutWeek {
  /** 1-based week number. */
  w: number;
  kind: WeekKind;
  blockType: BlockType;
}

/** "Beginners always get a Strength block first at W of 4 or more" (brief 09). */
export const BEGINNER_STRENGTH_FIRST_MIN_W = 4;

/** Thrown when a program length has no row in the table. */
export class LayoutRangeError extends RangeError {
  constructor(W: number, detail: string) {
    super(`no layout for W = ${W}: ${detail}`);
    this.name = 'LayoutRangeError';
  }
}

function expand(spans: LayoutSpan[]): LayoutWeek[] {
  const weeks: LayoutWeek[] = [];
  for (const span of spans) {
    for (let w = span.weekFrom; w <= span.weekTo; w += 1) {
      weeks.push({ w, kind: span.kind, blockType: span.blockType });
    }
  }
  return weeks;
}

/** The row for a program length, or undefined when the table has none. */
export function layoutRowFor(ruleset: Ruleset, W: number): LayoutRow | undefined {
  return ruleset.constants.layout.find((row) => row.W === W);
}

/**
 * Every week of a W-week program, in order.
 *
 * Programs longer than the table's last row chain 12-week programs from the
 * last test (brief section 09), which `planSkeleton` handles; this function
 * refuses rather than guessing.
 */
export function layoutFor(ruleset: Ruleset, W: number, level: Level): LayoutWeek[] {
  return expand(spansFor(ruleset, W, level));
}

/**
 * The spans for a program length and level, with the beginner substitution
 * already applied. Beginners always get a Strength block first at W of 4 or
 * more (brief section 09 "Blocks and layout"): the table spells that out at
 * W = 4 and the rule supplies it at W = 5, the only other length whose first
 * block is Power.
 */
export function spansFor(ruleset: Ruleset, W: number, level: Level): LayoutSpan[] {
  const { minProgramWeeks, maxLayoutWeeks } = ruleset.constants;
  if (!Number.isInteger(W)) throw new LayoutRangeError(W, 'W must be a whole number of weeks');
  if (W < minProgramWeeks) {
    throw new LayoutRangeError(W, `the shortest program is ${minProgramWeeks} weeks`);
  }
  if (W > maxLayoutWeeks) {
    throw new LayoutRangeError(W, `chain ${ruleset.constants.chainProgramWeeks}-week programs instead`);
  }
  const row = layoutRowFor(ruleset, W);
  if (row === undefined) throw new LayoutRangeError(W, 'the table has no row for this length');
  if (level !== 'beginner') return row.spans.map(copySpan);
  if (row.beginnerSpans !== undefined) return row.beginnerSpans.map(copySpan);
  return beginnerSpans(row.spans, W);
}

function copySpan(span: LayoutSpan): LayoutSpan {
  return { blockType: span.blockType, kind: span.kind, weekFrom: span.weekFrom, weekTo: span.weekTo };
}

/**
 * Retype the leading Power load span as Strength so a beginner opens on a
 * Strength block. Below `minW` the program is too short to carry one and the
 * table's own row stands.
 */
function beginnerSpans(spans: LayoutSpan[], W: number): LayoutSpan[] {
  const out = spans.map(copySpan);
  const first = out[0];
  if (W < BEGINNER_STRENGTH_FIRST_MIN_W || first === undefined) return out;
  if (first.blockType !== 'power' || first.kind !== 'load') return out;
  first.blockType = 'strength';
  return out;
}

/** "Strength 1-4", "Deload 5", "Taper 11", "Peak 12". */
function spanText(span: LayoutSpan): string {
  const name =
    span.kind === 'deload'
      ? 'Deload'
      : span.kind === 'taper'
        ? 'Taper'
        : span.kind === 'peak'
          ? 'Peak'
          : span.blockType === 'strength'
            ? 'Strength'
            : 'Power';
  const range = span.weekFrom === span.weekTo ? `${span.weekFrom}` : `${span.weekFrom}-${span.weekTo}`;
  return `${name} ${range}`;
}

/** The verbatim table row the Plan shows, beginner variant included. */
export function layoutTextFor(ruleset: Ruleset, W: number, level: Level): string {
  const row = layoutRowFor(ruleset, W);
  if (row === undefined) throw new LayoutRangeError(W, 'the table has no row for this length');
  if (level === 'beginner') {
    if (row.beginnerText !== undefined) return row.beginnerText;
    const spans = spansFor(ruleset, W, level);
    const changed = spans.some((span, index) => span.blockType !== row.spans[index]?.blockType);
    if (changed) return spans.map(spanText).join(' - ');
  }
  return row.text;
}

/** How a program longer than the table is split into a chain of programs. */
export interface ChainedProgram {
  /** True when the target date is further out than the table's last row. */
  chained: boolean;
  /** Weeks this program covers: W itself, or the chain length when chained. */
  programWeeks: number;
  /** Weeks left for the next program, built from the last test. 0 when none. */
  remainingWeeks: number;
}

/**
 * Programs longer than the table chain 12-week programs from the last test
 * (brief section 09 "Blocks and layout"). This returns the first program's
 * length and what is left over; it never guesses a longer table row.
 */
export function chainFor(ruleset: Ruleset, W: number): ChainedProgram {
  const { maxLayoutWeeks, chainProgramWeeks } = ruleset.constants;
  if (!Number.isInteger(W)) throw new LayoutRangeError(W, 'W must be a whole number of weeks');
  if (W <= maxLayoutWeeks) return { chained: false, programWeeks: W, remainingWeeks: 0 };
  return { chained: true, programWeeks: chainProgramWeeks, remainingWeeks: W - chainProgramWeeks };
}

/** `layoutFor` with the chain applied, so any W of 2 or more resolves. */
export function layoutForChained(
  ruleset: Ruleset,
  W: number,
  level: Level,
): ChainedProgram & { weeks: LayoutWeek[] } {
  const chain = chainFor(ruleset, W);
  return { ...chain, weeks: layoutFor(ruleset, chain.programWeeks, level) };
}

/** Contiguous runs of the same block type, in order. Strength then Power (R108). */
export function blocksFor(weeks: LayoutWeek[]): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  for (const week of weeks) {
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.type === week.blockType) {
      last.weekTo = week.w;
      continue;
    }
    blocks.push({ type: week.blockType, weekFrom: week.w, weekTo: week.w });
  }
  return blocks;
}
