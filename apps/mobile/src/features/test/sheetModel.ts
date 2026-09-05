import { useMemo } from 'react';
import type { Instrument, JumpTest as EngineJumpTest, ReadinessTestConfig } from '@vert/engine';
import { RULESET_V1 } from '@vert/engine';
import { inToMm, mmToIn } from '@vert/engine/units';
import {
  classifyTest,
  instrumentLabel,
  prThreshold,
  type TestClassification,
} from '@vert/engine/analytics';
import { SINGLE_LEG_ATTEMPTS } from './singleLeg';
import { blankAttempt, draftKind, isRsiMode, type TestDraft, type TestKind } from './validate';

/**
 * The test sheet's own model: the draft it opens with, the mode words, and the
 * live classification it previews. Split from the sheet so the screen file
 * stays layout and the rules stay testable without a renderer.
 */

/** Rows the sheet opens with. Empty, so an unused one is not an attempt. */
export const OPENING_ATTEMPTS = 3;
export const MAX_ATTEMPTS = 5;
export const BOX_HEIGHTS_IN = [12, 18, 24] as const;

const DRAFT_ID = 'draft-test';
const DRAFT_CREATED_AT = '1970-01-01T00:00:00.000Z';

/** The mode string a stream is filed under. */
export function modeFor(instrument: Instrument, kind: TestKind = 'jump'): string {
  if (kind === 'single_leg') return 'single_leg';
  switch (instrument) {
    case 'ovr_jump_regular':
      return 'Regular';
    case 'ovr_jump_rsi':
      return 'RSI';
    case 'vertec_reach_touch':
      return 'reach_touch';
    case 'manual':
      return 'manual';
  }
}

export interface EmptyDraftInput {
  readonly instrument: Instrument;
  readonly kind: TestKind;
  readonly bodyweightLb: number | null;
  /** How many attempts the readiness test asks for. */
  readonly throwAttempts: number;
}

/**
 * A clean draft.
 *
 * A single-leg pair is never canonical: it is its own mode and never joins the
 * trend, the pace or a PR (`house.sc.asymmetry_tracking`), so the flag is off
 * and the sheet does not offer it.
 */
export function emptyDraft(input: EmptyDraftInput): TestDraft {
  const { instrument, kind } = input;
  const sideRows = kind === 'single_leg' ? SINGLE_LEG_ATTEMPTS : OPENING_ATTEMPTS;
  return {
    kind,
    instrument,
    attempts: Array.from({ length: sideRows }, () => blankAttempt(instrument)),
    rightAttempts:
      kind === 'single_leg'
        ? Array.from({ length: SINGLE_LEG_ATTEMPTS }, () => blankAttempt(instrument))
        : [],
    throwAttempts:
      kind === 'readiness_throw'
        ? Array.from({ length: Math.max(1, input.throwAttempts) }, () => null)
        : [],
    bodyweightLb: input.bodyweightLb,
    boxHeightIn: isRsiMode(instrument) && kind === 'jump' ? 18 : null,
    notes: '',
    canonical: kind === 'jump',
  };
}

/** How many attempts the gate's configured test asks for. */
export function throwAttemptCount(config: ReadinessTestConfig): number {
  return Math.max(1, Math.round(config.attempts));
}

export interface ClassificationView {
  readonly value: string;
  readonly line: string;
}

/**
 * The live result line, from the same classifier Progress reads.
 *
 * It is a preview: the same words the record will carry ("New PR · +1.2 over
 * 27 Sep"), on paper, so the sheet and Progress never disagree about what the
 * number means. Nothing here paints the committed surface, and nothing outside
 * the canonical jump stream is classified at all.
 */
export function useClassification(
  draft: TestDraft,
  bestIn: number | null,
  stream: readonly EngineJumpTest[],
  mode: string,
  localDate: string,
): ClassificationView | null {
  return useMemo(() => {
    if (draftKind(draft) !== 'jump') return null;
    if (bestIn === null || !draft.canonical) return null;
    const preview: EngineJumpTest = {
      id: DRAFT_ID,
      date: localDate,
      instrument: draft.instrument,
      mode,
      unitPreference: 'in',
      isBaseline: false,
      canonical: true,
      scheduled: true,
      createdAt: DRAFT_CREATED_AT,
      reps: draft.attempts
        .filter((attempt) => attempt.heightIn !== null)
        .map((attempt, index) => ({
          id: `${DRAFT_ID}-${index + 1}`,
          repNumber: index + 1,
          heightMm: inToMm(attempt.heightIn ?? 0),
          flagged: attempt.flagged,
          entrySource: 'typed' as const,
        }))
        .filter((rep) => rep.flagged || rep.heightMm > 0),
    };
    let result: TestClassification;
    try {
      const threshold = prThreshold([...stream, preview], draft.instrument, RULESET_V1);
      result = classifyTest(preview, [...stream, preview], threshold, {
        instrumentLabel: instrumentLabel(draft.instrument),
      });
    } catch {
      return null;
    }
    return { value: mmToIn(result.heightMm).toFixed(1), line: result.line };
  }, [bestIn, draft, localDate, mode, stream]);
}

/** The morning's recovery, stored beside the test so a rescore cannot move it. */
export function snapshotOf(
  recovery:
    | { readonly recoveryScore: number | null; readonly hrvRmssdMilli: number | null }
    | null
    | undefined,
): Record<string, number | null> | null {
  if (recovery === null || recovery === undefined) return null;
  return {
    recovery: recovery.recoveryScore,
    hrvMs: recovery.hrvRmssdMilli === null ? null : Math.round(recovery.hrvRmssdMilli),
  };
}
