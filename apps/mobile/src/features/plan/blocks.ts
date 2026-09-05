import type { BlockType, WeekKind } from '@vert/engine';

/**
 * The block band: Strength, Deload, Power, Taper, Peak.
 *
 * A segment is a run of consecutive weeks that read as one phase. A load week
 * takes its block's name; a deload, taper or peak week is its own phase,
 * because that is the word the athlete needs when they look at the shape of
 * the program (brief section 09 "Blocks and layout").
 */

export interface SegmentWeek {
  readonly w: number;
  readonly kind: WeekKind;
  readonly blockType: BlockType;
}

export interface BlockSegment {
  readonly key: string;
  /** "Strength", "Deload", "Power", "Taper", "Peak". */
  readonly label: string;
  readonly weekFrom: number;
  readonly weekTo: number;
  /** How many weeks the segment spans, which is its width in the band. */
  readonly weeks: number;
  /** Deload, taper and peak weeks: cut volume, drawn a tone lighter. */
  readonly reduced: boolean;
  /** "Strength 1-4", "Deload 5". */
  readonly span: string;
}

/** The phase word for one week. */
export function phaseLabel(week: SegmentWeek): string {
  if (week.kind === 'deload') return 'Deload';
  if (week.kind === 'taper') return 'Taper';
  if (week.kind === 'peak') return 'Peak';
  return week.blockType === 'power' ? 'Power' : 'Strength';
}

function spanOf(label: string, from: number, to: number): string {
  return from === to ? `${label} ${from}` : `${label} ${from}-${to}`;
}

/** Consecutive weeks of the same phase, in program order. */
export function blockSegments(weeks: readonly SegmentWeek[]): BlockSegment[] {
  const ordered = [...weeks].sort((a, b) => a.w - b.w);
  const segments: BlockSegment[] = [];

  for (const week of ordered) {
    const label = phaseLabel(week);
    const last = segments[segments.length - 1];
    if (last !== undefined && last.label === label && last.weekTo === week.w - 1) {
      segments[segments.length - 1] = {
        ...last,
        weekTo: week.w,
        weeks: last.weeks + 1,
        span: spanOf(label, last.weekFrom, week.w),
      };
      continue;
    }
    segments.push({
      key: `${label}-${week.w}`,
      label,
      weekFrom: week.w,
      weekTo: week.w,
      weeks: 1,
      reduced: week.kind !== 'load',
      span: spanOf(label, week.w, week.w),
    });
  }

  return segments;
}

/** The phase word for the week today sits in, for the sticky header. */
export function blockLabelForWeek(weeks: readonly SegmentWeek[], w: number): string | null {
  const week = weeks.find((entry) => entry.w === w);
  return week === undefined ? null : phaseLabel(week);
}
