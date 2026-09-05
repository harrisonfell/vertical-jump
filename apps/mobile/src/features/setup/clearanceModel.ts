/**
 * Which clearance screen applies, and what it says.
 *
 * Block 1 owns both sentences, so this asks the engine rather than writing
 * them again: only the general self-screen blocks generation (R2), and a site
 * at 5+ shows the two choices with the exclusions applied either way.
 */
import { RULESET_V1, addDays, evaluatePainGate } from '@vert/engine';
import type { ClearanceScreen, PainGateResultWithExtras } from '@vert/engine';
import type { Athlete, LocalDate, PainStatus } from '@/data';
import { readClearanceAnswers, toEnginePain } from './engineAthlete';

/** Two weeks: R6's window and the day-14 reassessment. */
export const REASSESS_DAYS = 14;

export interface PainGateInput {
  readonly athlete: Athlete | null;
  readonly pains: readonly PainStatus[];
  readonly today: LocalDate;
  /** Set once the athlete chose "Build the restricted plan anyway". */
  readonly buildAnyway?: boolean;
}

/** Block 1's whole verdict for the athlete as they are stored right now. */
export function painGateFor(input: PainGateInput): PainGateResultWithExtras {
  const painStatus = [];
  for (const row of input.pains) {
    const converted = toEnginePain(row);
    if (converted !== null) painStatus.push(converted);
  }
  return evaluatePainGate(
    {
      clearance: readClearanceAnswers(input.athlete?.clearance, input.athlete?.isAdult ?? true),
      painStatus,
      isAdult: input.athlete?.isAdult ?? true,
      today: input.today,
      ...(input.buildAnyway === undefined ? null : { buildAnyway: input.buildAnyway }),
    },
    RULESET_V1,
  );
}

/** The screen to show, or null when nothing is in the way. */
export function clearanceScreenFor(input: PainGateInput): ClearanceScreen | null {
  return painGateFor(input).clearanceScreen;
}

/** The day the site is re-asked. Moderate treatment continues until answered. */
export function reassessDueAt(today: LocalDate): LocalDate {
  return addDays(today, REASSESS_DAYS);
}

/** True when a severe site is on file, whichever choice the athlete made. */
export function hasSeverePain(pains: readonly PainStatus[]): boolean {
  return pains.some((row) => row.severityDerived === 'severe' && row.clearedAt === null);
}

/** The lower-limb sites that keep depth jumps off the table. */
const LOWER_LIMB = new Set(['knee', 'achilles_calf', 'shin', 'hamstring', 'hip']);

export function hasLowerLimbPain(pains: readonly PainStatus[]): boolean {
  return pains.some((row) => row.clearedAt === null && LOWER_LIMB.has(row.location));
}

/**
 * Where setup goes next, given what is on file. The app gate owns the same
 * decision for a cold start; this one is for a screen that has just written
 * something and knows more than the cache does.
 */
export function nextSetupRoute(athlete: Athlete | null, hasProgram: boolean): string {
  if (athlete === null) return '/setup/gate';
  if (athlete.daysPerWeek === null) return '/setup/one';
  const profileComplete =
    athlete.weekdays.length > 0 && athlete.goalHeightMm !== null && athlete.targetDate !== null;
  if (!profileComplete) return '/setup/two';
  if (!hasProgram) return '/setup/build';
  return '/';
}
