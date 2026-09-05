import type { Instrument } from '@vert/engine';
import { formatInteger, inToMm } from '@vert/engine/units';
import { formatInValue } from '@vert/engine/analytics';

/**
 * The jump-test sheet's rules, with nothing on screen in them.
 *
 * The bounds are the device's own: the OVR Jump does not record a jump under
 * 6 in and rejects a rep whose contact time runs past a second. A reading
 * outside them is a mis-typed number or an attempt that left the field, so it
 * blocks the save until it is corrected or flagged. A jump more than 6 in
 * above the last test is possible but rare, so it warns and lets the athlete
 * through: the app does not know better than the person who watched it.
 */
export const HEIGHT_MIN_IN = 6;
export const HEIGHT_MAX_IN = 60;
export const GCT_MIN_MS = 100;
export const GCT_MAX_MS = 1000;
export const SOFT_CHANGE_IN = 6;
export const HEIGHT_STEP_IN = 0.1;

/** The four ways a number gets in (brief section 05, section 10). */
export const INSTRUMENT_OPTIONS: readonly { value: Instrument; label: string }[] = [
  { value: 'ovr_jump_regular', label: 'OVR Jump Regular' },
  { value: 'ovr_jump_rsi', label: 'OVR Jump RSI' },
  { value: 'vertec_reach_touch', label: 'Vertec reach minus touch' },
  { value: 'manual', label: 'Manual' },
];

/**
 * What the sheet is logging.
 *
 * `jump` is the canonical stream: one instrument, one mode, the trend, the
 * pace and the PR read from it. The other two are their own streams and reach
 * none of that: a single-leg pair is the asymmetry stream
 * (`house.sc.asymmetry_tracking`) and a readiness throw is channel B of the
 * gate (`house.sc.readiness_gate`).
 */
export type TestKind = 'jump' | 'single_leg' | 'readiness_throw';

/** The one selector's value: an instrument, or one of the two other streams. */
export type TestSelection = Instrument | 'single_leg' | 'readiness_throw';

/** The instruments and the two other streams, in one list, in reading order. */
export const MODE_OPTIONS: readonly { value: TestSelection; label: string }[] = [
  ...INSTRUMENT_OPTIONS,
  { value: 'single_leg', label: 'Single leg (left and right)' },
  { value: 'readiness_throw', label: 'Readiness throw' },
];

/** Which stream a selection belongs to. */
export function kindFor(selection: TestSelection): TestKind {
  if (selection === 'single_leg') return 'single_leg';
  if (selection === 'readiness_throw') return 'readiness_throw';
  return 'jump';
}

/** What the selector shows for a draft: the kind when it has one, else the instrument. */
export function selectionFor(kind: TestKind, instrument: Instrument): TestSelection {
  return kind === 'jump' ? instrument : kind;
}

export interface Attempt {
  /** Null until the athlete types the number off the device's display. */
  readonly heightIn: number | null;
  /** Ground contact time in whole milliseconds. RSI mode only. */
  readonly gctMs: number | null;
  /** Landed outside the 18 in field, or read under the device's floor. */
  readonly flagged: boolean;
}

/**
 * A draft in the sheet.
 *
 * The three fields the two newer streams need are optional, and absent reads
 * as the jump stream with nothing beside it: a caller that builds a jump draft
 * by hand (the runner's own test form) keeps working untouched, and
 * `draftKind`, `rightAttemptsOf` and `throwAttemptsOf` are the readers that
 * turn absent into the default once.
 */
export interface TestDraft {
  readonly kind?: TestKind;
  readonly instrument: Instrument;
  /** The jump attempts, and in single-leg mode the LEFT leg's attempts. */
  readonly attempts: readonly Attempt[];
  /** Single leg only: the right leg. Ignored by every other kind. */
  readonly rightAttempts?: readonly Attempt[];
  /** Readiness throw only: one reading per attempt, in the metric's unit. */
  readonly throwAttempts?: readonly (number | null)[];
  readonly bodyweightLb: number | null;
  readonly boxHeightIn: number | null;
  readonly notes: string;
  readonly canonical: boolean;
}

/** What the draft is logging. A draft with no kind is a jump test. */
export function draftKind(draft: TestDraft): TestKind {
  return draft.kind ?? 'jump';
}

/** The right leg's attempts, or none outside single-leg mode. */
export function rightAttemptsOf(draft: TestDraft): readonly Attempt[] {
  return draft.rightAttempts ?? [];
}

/** The readiness test's attempts, or none outside that mode. */
export function throwAttemptsOf(draft: TestDraft): readonly (number | null)[] {
  return draft.throwAttempts ?? [];
}

export interface DraftIssue {
  /** The attempt this is about, or null for the sheet as a whole. */
  readonly index: number | null;
  readonly message: string;
  /** A blocking issue keeps Save disabled; a warning does not. */
  readonly blocking: boolean;
}

export interface DraftReading {
  readonly issues: readonly DraftIssue[];
  readonly canSave: boolean;
  /** Best unflagged attempt, in inches. Null when every attempt is flagged. */
  readonly bestIn: number | null;
  /** Best minus worst unflagged attempt, in inches. */
  readonly spreadIn: number | null;
  readonly counted: number;
}

/** RSI as the app computes it: height in metres over contact time in seconds. */
export function derivedRsi(heightIn: number | null, gctMs: number | null): number | null {
  if (heightIn === null) return null;
  if (gctMs === null || gctMs <= 0) return null;
  return (heightIn * 0.0254) / (gctMs / 1000);
}

export function isRsiMode(instrument: Instrument): boolean {
  return instrument === 'ovr_jump_rsi';
}

/**
 * One empty attempt row.
 *
 * The height starts null rather than at the device's floor: a row nobody typed
 * into is not an attempt, and seeding it with 6.0 in would count a jump that
 * never happened into the best, the spread, and from there into the PR noise
 * floor for the rest of the program.
 */
export function blankAttempt(instrument: Instrument): Attempt {
  return {
    heightIn: null,
    gctMs: isRsiMode(instrument) ? 200 : null,
    flagged: false,
  };
}

/**
 * Read a draft: the issues, the live best and spread, and whether Save is on.
 *
 * `lastBestIn` is the previous session's best on the same stream; without one
 * the soft warning has nothing to compare against and stays quiet.
 */
export function readDraft(
  draft: TestDraft,
  lastBestIn: number | null,
  noun = 'Attempt',
): DraftReading {
  const issues: DraftIssue[] = [];
  const counted: number[] = [];

  draft.attempts.forEach((attempt, index) => {
    const number = index + 1;
    const named = `${noun} ${number}`;
    // An untyped row is neither an attempt nor an error: the athlete took
    // three jumps or one, and the sheet opens with room for five.
    if (attempt.heightIn === null) return;
    const heightIn = attempt.heightIn;
    if (!attempt.flagged) {
      if (heightIn < HEIGHT_MIN_IN) {
        issues.push({
          index,
          blocking: true,
          message: `${named} reads ${formatInValue(heightIn)} in. The device does not record under ${formatInValue(HEIGHT_MIN_IN)} in. Check the number, or flag the attempt.`,
        });
      } else if (heightIn > HEIGHT_MAX_IN) {
        issues.push({
          index,
          blocking: true,
          message: `${named} reads ${formatInValue(heightIn)} in, over the ${formatInValue(HEIGHT_MAX_IN)} in ceiling. Check the number.`,
        });
      } else {
        counted.push(heightIn);
        if (lastBestIn !== null && Math.abs(heightIn - lastBestIn) > SOFT_CHANGE_IN) {
          const delta = formatInValue(Math.abs(heightIn - lastBestIn));
          const direction = heightIn > lastBestIn ? 'above' : 'below';
          issues.push({
            index,
            blocking: false,
            message: `${named} is ${delta} in ${direction} your last test. Check the number, or save it if it is right.`,
          });
        }
      }
    }

    if (isRsiMode(draft.instrument) && !attempt.flagged) {
      const gct = attempt.gctMs;
      if (gct === null) {
        issues.push({
          index,
          blocking: true,
          message: `${named} needs a contact time. RSI mode reads height and contact time together.`,
        });
      } else if (gct < GCT_MIN_MS || gct > GCT_MAX_MS) {
        issues.push({
          index,
          blocking: true,
          message: `${named} contact time ${formatInteger(gct)} ms. Contact time reads between ${GCT_MIN_MS} and ${GCT_MAX_MS} ms. Check the number.`,
        });
      }
    }
  });

  if (counted.length === 0) {
    issues.push({
      index: null,
      blocking: true,
      message: `Enter at least one ${noun.toLowerCase()} that is not flagged.`,
    });
  }

  const bestIn = counted.length === 0 ? null : Math.max(...counted);
  const spreadIn = counted.length < 2 ? null : Math.max(...counted) - Math.min(...counted);

  return {
    issues,
    canSave: !issues.some((issue) => issue.blocking),
    bestIn,
    spreadIn,
    counted: counted.length,
  };
}

/** The attempts a save writes, in the store's own units. */
export function draftAttempts(draft: TestDraft): {
  readonly attemptIndex: number;
  readonly heightMm: number;
  readonly gctMs: number | null;
  readonly rsiCalc: number | null;
  readonly flagged: boolean;
  readonly rejectReason: string | null;
}[] {
  // Rows that were never typed into are not written: a test of one attempt is
  // one rep on file, and the attempt numbers close up behind it.
  return draft.attempts
    .filter((attempt): attempt is Attempt & { heightIn: number } => attempt.heightIn !== null)
    .map((attempt, index) => ({
      attemptIndex: index + 1,
      heightMm: inToMm(attempt.heightIn),
      gctMs: attempt.gctMs,
      rsiCalc: derivedRsi(attempt.heightIn, attempt.gctMs),
      flagged: attempt.flagged,
      rejectReason: attempt.flagged ? 'landed outside the field' : null,
    }));
}

/** "Best 32.5 in · spread 0.7 in · 5 attempts", or the honest short form. */
export function summaryLine(reading: DraftReading): string {
  if (reading.bestIn === null) return 'No attempt counted yet.';
  const parts = [`Best ${formatInValue(reading.bestIn)} in`];
  if (reading.spreadIn !== null) parts.push(`spread ${formatInValue(reading.spreadIn)} in`);
  parts.push(`${reading.counted} ${reading.counted === 1 ? 'attempt' : 'attempts'}`);
  return parts.join(' · ');
}
