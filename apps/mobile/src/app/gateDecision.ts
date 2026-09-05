/**
 * First-run routing, as a table.
 *
 * The decision is pure so it can be read and tested without a database, a
 * router, or a render. Its one hard rule: nothing redirects while the database
 * is still opening, because a redirect fired against unknown state sends the
 * athlete to setup on top of a program that is already there.
 */

export type GateState =
  | 'loading'
  | 'error'
  | 'setupGate'
  | 'clearance'
  | 'setupOne'
  | 'setupTwo'
  | 'setupBuild'
  | 'ready';

/** The seven self-screen questions (engine `ClearanceAnswers`). */
const RED_FLAG_KEYS = [
  'heartCondition',
  'chestPain',
  'dizziness',
  'chronicCondition',
  'prescriptionMedication',
  'boneOrJointProblem',
  'supervisedActivityOnly',
] as const;

export interface ClearanceReading {
  /** The athlete has answered the self-screen at least once. */
  readonly answered: boolean;
  /** At least one question came back yes, which blocks generation (R2). */
  readonly failed: boolean;
  /** A clinician has since cleared them, which unblocks it. */
  readonly clearedByClinician: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function filledString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** Reads the athlete's stored clearance JSON without trusting its shape. */
export function readClearance(value: unknown): ClearanceReading {
  if (!isRecord(value)) return { answered: false, failed: false, clearedByClinician: false };

  const flags = RED_FLAG_KEYS.some((key) => value[key] === true);
  const listed = Array.isArray(value['redFlags']) && value['redFlags'].length > 0;

  return {
    answered: filledString(value['attestedAt']),
    failed: flags || listed,
    clearedByClinician: filledString(value['clearedByClinicianAt']),
  };
}

/** Only the athlete fields the gate reads. */
export interface GateAthlete {
  readonly clearance: unknown;
  /** Step 1's own answer. Present means step 1 has been through once. */
  readonly sport: string | null;
  readonly daysPerWeek: number | null;
  readonly weekdays: readonly number[];
  readonly goalHeightMm: number | null;
  readonly targetDate: string | null;
}

export interface GateInput {
  readonly dbStatus: 'opening' | 'ready' | 'error';
  /** False while the athlete query is still in flight. */
  readonly athleteLoaded: boolean;
  /** False while the program query is still in flight. */
  readonly programLoaded: boolean;
  readonly athlete: GateAthlete | null;
  readonly hasProgram: boolean;
  /**
   * False while the owner's saved profile is still being written
   * (`EXPO_PUBLIC_OWNER=1`). Defaults to true, because nothing is pending on
   * every other boot.
   */
  readonly prefillSettled?: boolean;
}

/**
 * True once step 1 has been answered: the sport and the days a week are the
 * two it always writes, and the athlete row carries neither before it.
 */
export function stepOneComplete(athlete: GateAthlete): boolean {
  return filledString(athlete.sport) && athlete.daysPerWeek !== null;
}

/** Enough answers for the builder to run without asking anything else. */
export function profileComplete(athlete: GateAthlete): boolean {
  return (
    athlete.daysPerWeek !== null &&
    athlete.weekdays.length > 0 &&
    athlete.goalHeightMm !== null &&
    filledString(athlete.targetDate)
  );
}

/**
 * The table, top to bottom. The first row that matches wins.
 *
 * | database opening or queries in flight | loading    |
 * | database failed to open               | error      |
 * | no clearance answers                  | setupGate  |
 * | self-screen failed, no clinician note | clearance  |
 * | no program, profile complete          | setupBuild |
 * | no program, step 1 answered           | setupTwo   |
 * | no program, nothing answered          | setupOne   |
 * | otherwise                             | ready      |
 */
export function decideGate(input: GateInput): GateState {
  if (input.dbStatus === 'error') return 'error';
  if (input.dbStatus !== 'ready') return 'loading';
  if (input.prefillSettled === false) return 'loading';
  if (!input.athleteLoaded || !input.programLoaded) return 'loading';

  const athlete = input.athlete;
  if (athlete === null) return 'setupGate';

  const clearance = readClearance(athlete.clearance);
  if (!clearance.answered) return 'setupGate';
  if (clearance.failed && !clearance.clearedByClinician) return 'clearance';

  if (!input.hasProgram) {
    if (profileComplete(athlete)) return 'setupBuild';
    // Step 1 is on file, so the questions left are step 2's: the baseline, the
    // goal and the date. Sending the athlete back to step 1 would make them
    // re-answer what they already answered.
    return stepOneComplete(athlete) ? 'setupTwo' : 'setupOne';
  }
  return 'ready';
}

/** Where a state sends the athlete, or null when it stays on the tabs. */
export function gateRedirect(state: GateState): string | null {
  switch (state) {
    case 'setupGate':
      return '/setup/gate';
    case 'clearance':
      return '/clearance';
    case 'setupOne':
      return '/setup/one';
    case 'setupTwo':
      return '/setup/two';
    case 'setupBuild':
      return '/setup/build';
    default:
      return null;
  }
}
