import { weekdayLabelOf } from '@vert/engine';
import { formatInteger } from '@vert/engine/units';
import { formatShortDate } from '@vert/engine/analytics';
import { weekdayOf } from '../../lib/localDay';

/**
 * The header sentence, which is the whole orientation the runner offers:
 * where the athlete is in the program, what today is, and how long it takes.
 *
 * Suffixes arrive from the engine already carrying their dot ("· Test day"),
 * so they are appended and never re-punctuated.
 */

export interface HeaderInput {
  readonly w: number;
  readonly W: number;
  readonly blockType: string | null;
  readonly dayType: string;
  readonly suffixes: readonly string[];
  /** Added when the pain gate has the program on a restricted plan. */
  readonly restricted?: boolean;
}

const BLOCK_WORDS: Readonly<Record<string, string>> = {
  strength: 'Strength block',
  power: 'Power block',
};

export function headerTitle({
  w,
  W,
  blockType,
  dayType,
  suffixes,
  restricted = false,
}: HeaderInput): string {
  const parts = [`Week ${formatInteger(w)} of ${formatInteger(W)}`];
  const block = blockType === null ? null : BLOCK_WORDS[blockType];
  if (block !== undefined && block !== null) parts.push(block);
  parts.push(dayType);

  const all = restricted && !suffixes.includes('· Restricted')
    ? [...suffixes, '· Restricted']
    : [...suffixes];

  return [parts.join(' · '), ...all].join(' ');
}

/** "Thu 22 Oct". The weekday earns its place: the runner is a calendar screen. */
export function headerDate(date: string): string {
  return `${weekdayLabelOf(date, weekdayOf(date))} ${formatShortDate(date)}`;
}

/** "about 100 min", or nothing when the engine had no estimate to give. */
export function headerDuration(minutes: number | null): string | undefined {
  if (minutes === null || minutes <= 0) return undefined;
  return `about ${formatInteger(minutes)} min`;
}

/** "Rest day · Week 7", the header of the day with no session on it. */
export function restDayTitle(w: number): string {
  return `Rest day · Week ${formatInteger(w)}`;
}

/**
 * W comes from the skeleton the program was built with, never from the count of
 * weeks materialised so far: week 7 of a twelve-week program has seven rows.
 */
export function skeletonWeekCount(snapshot: unknown): number | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const weeks = (snapshot as { weeks?: unknown }).weeks;
  return Array.isArray(weeks) && weeks.length > 0 ? weeks.length : null;
}
