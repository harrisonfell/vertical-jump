import { asymmetryPct, readAsymmetry, type AsymmetryBand } from '@vert/engine/analytics';
import { inToMm } from '@vert/engine/units';
import type { Side } from '@/data';
import {
  readDraft,
  rightAttemptsOf,
  type Attempt,
  type DraftIssue,
  type TestDraft,
} from './validate';

/**
 * The single-leg test (house rule `house.sc.asymmetry_tracking`).
 *
 * Three attempts a side, left and right, on the same instrument on the same
 * day. The best unflagged attempt is each side's number and the gap is
 * recomputed from the two through the engine, so a corrected rep changes the
 * gap, the band and the weaker-side ordering together.
 *
 * It is never canonical and never a PR: a single-leg jump is not the stream
 * the trend, the pace and the PR threshold are read from, so the save writes
 * it in its own mode and the sheet says so before the athlete presses it.
 */

/** Attempts a side, which is what the sheet opens with. */
export const SINGLE_LEG_ATTEMPTS = 3;

/** The mode a single-leg pair is filed under. Matches the store's own constant. */
export const SINGLE_LEG_MODE = 'single_leg';

export interface SingleLegReading {
  /** Every issue from both sides, in left-then-right order. */
  readonly issues: readonly DraftIssue[];
  readonly canSave: boolean;
  readonly leftBestIn: number | null;
  readonly rightBestIn: number | null;
  /** Signed: positive means the left leg jumped higher. Null before both sides. */
  readonly pct: number | null;
  readonly band: AsymmetryBand | null;
  /** Null inside the band: no side is named from noise. */
  readonly weakerSide: Side | null;
  /** The engine's own sentence for the pair, or the honest short form. */
  readonly line: string;
}

/** Which attempt errors belong to which side, so a row can find its own. */
export interface SideIssues {
  readonly left: readonly DraftIssue[];
  readonly right: readonly DraftIssue[];
}

function sideDraft(draft: TestDraft, attempts: readonly Attempt[]): TestDraft {
  return { ...draft, attempts };
}

/**
 * Read a single-leg draft live: both sides, the gap between them, and the band
 * it falls in. Nothing is saved and nothing is stored, so the number moves as
 * the athlete types.
 *
 * @param lastBestIn the previous single-leg best on the same side is not
 *   tracked separately, so the soft "far from your last test" warning is off
 *   here: a left leg is not the two-leg stream and a 6 in gap between them is
 *   ordinary rather than suspicious.
 */
export function readSingleLeg(draft: TestDraft): SingleLegReading {
  const left = readDraft(sideDraft(draft, draft.attempts), null, 'Left attempt');
  const right = readDraft(sideDraft(draft, rightAttemptsOf(draft)), null, 'Right attempt');
  const issues = [...left.issues, ...right.issues];

  const leftBestIn = left.bestIn;
  const rightBestIn = right.bestIn;
  if (leftBestIn === null || rightBestIn === null) {
    return {
      issues,
      canSave: false,
      leftBestIn,
      rightBestIn,
      pct: null,
      band: null,
      weakerSide: null,
      line:
        leftBestIn === null && rightBestIn === null
          ? 'Enter both legs. A gap needs a left and a right.'
          : `Enter the ${leftBestIn === null ? 'left' : 'right'} leg too. A gap needs both.`,
    };
  }

  const pct = asymmetryPct(leftBestIn, rightBestIn);
  const reading = readAsymmetry({
    date: '1970-01-01',
    instrument: draft.instrument,
    leftIn: leftBestIn,
    rightIn: rightBestIn,
    asymmetryPct: pct,
    weakerSide: null,
  });

  return {
    issues,
    canSave: !issues.some((issue) => issue.blocking),
    leftBestIn,
    rightBestIn,
    pct: reading.pct,
    band: reading.band,
    weakerSide: reading.weakerSide,
    line: reading.line,
  };
}

/** Each side's issues, keyed by side, so an attempt row shows its own error. */
export function singleLegIssues(draft: TestDraft): SideIssues {
  return {
    left: readDraft(sideDraft(draft, draft.attempts), null, 'Left attempt').issues,
    right: readDraft(sideDraft(draft, rightAttemptsOf(draft)), null, 'Right attempt').issues,
  };
}

/** The reps a save writes: left first, then right, each carrying its side. */
export function singleLegAttempts(draft: TestDraft): {
  readonly attemptIndex: number;
  readonly heightMm: number;
  readonly side: Side;
  readonly flagged: boolean;
  readonly rejectReason: string | null;
}[] {
  const rows: {
    attemptIndex: number;
    heightMm: number;
    side: Side;
    flagged: boolean;
    rejectReason: string | null;
  }[] = [];
  const push = (attempts: readonly Attempt[], side: Side): void => {
    for (const attempt of attempts) {
      if (attempt.heightIn === null) continue;
      rows.push({
        attemptIndex: rows.length + 1,
        heightMm: inToMm(attempt.heightIn),
        side,
        flagged: attempt.flagged,
        rejectReason: attempt.flagged ? 'landed outside the field' : null,
      });
    }
  };
  push(draft.attempts, 'left');
  push(rightAttemptsOf(draft), 'right');
  return rows;
}
