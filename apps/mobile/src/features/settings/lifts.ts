/**
 * The Lifts section: entered against estimated working max, per lift.
 *
 * The working max is frozen and monotone by the engine's safety override, so
 * Settings never edits it live; it shows where the number came from and, when
 * an estimate is available and different, offers to adopt it. "Working max" is
 * the word the whole product uses for the per-lift maximum the engine reads
 * (brief section 13 "Vocabulary").
 */
import { displayLoadLb, formatLoadLb } from '@vert/engine';

/** One lift, as the store holds it, plus whatever estimate exists today. */
export interface LiftSource {
  readonly exerciseId: string;
  readonly name: string;
  readonly valueKg: number | null;
  readonly source: 'entered' | 'epley' | 'rpe' | null;
  readonly confidence: number | null;
  /** The estimate from logged sets, when there is one. */
  readonly estimateKg: number | null;
}

export interface LiftRow {
  readonly exerciseId: string;
  readonly name: string;
  /** "275 lb", or "No 1RM yet". */
  readonly valueLine: string;
  /** Where the number came from, in plain words. */
  readonly sourceLine: string;
  /** "estimate 290 lb", or null when there is nothing to compare with. */
  readonly estimateLine: string | null;
  /** True when "Use estimate" would change something. */
  readonly canUseEstimate: boolean;
  readonly estimateKg: number | null;
}

const SOURCE_WORDS: Readonly<Record<'entered' | 'epley' | 'rpe', string>> = {
  entered: 'entered',
  epley: 'from a logged set (Epley × 0.95)',
  rpe: 'from week 1 at RPE 6-7',
};

/** The line on an exercise that has no max yet (brief section 06). */
export const NO_MAX_LINE = 'No 1RM yet · log load and effort; prescribed after 2 sets';

function lb(kg: number): string {
  return formatLoadLb(displayLoadLb(kg, 'barbell'));
}

/** One row per loadable lift, in the order the store returned them. */
export function workingMaxRows(sources: readonly LiftSource[]): LiftRow[] {
  return sources.map((lift) => {
    const hasValue = lift.valueKg !== null;
    const estimate = lift.estimateKg;
    const differs =
      estimate !== null && (lift.valueKg === null || Math.abs(estimate - lift.valueKg) >= 1);

    return {
      exerciseId: lift.exerciseId,
      name: lift.name,
      valueLine: hasValue && lift.valueKg !== null ? lb(lift.valueKg) : 'No 1RM yet',
      sourceLine: lift.source === null ? NO_MAX_LINE : SOURCE_WORDS[lift.source],
      estimateLine: estimate === null ? null : `estimate ${lb(estimate)}`,
      canUseEstimate: differs,
      estimateKg: estimate,
    };
  });
}
