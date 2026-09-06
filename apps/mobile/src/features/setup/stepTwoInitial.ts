/**
 * Step 2's starting point, decided before a single field is drawn.
 *
 * The form seeds its state once, on mount, which makes "the row has not been
 * read yet" and "the row is empty" the same thing to a screen that renders
 * both as blanks. They are not the same thing: a screen that opens on an
 * unread row seeds itself from nothing, never corrects, and then says the
 * program starts today because no weekday has been picked. So "not read yet"
 * is a state of its own here, and the screen holds the skeleton until this
 * says otherwise.
 *
 * Pure on purpose: the decision is the part worth testing, and none of it
 * needs a renderer.
 */
import { kgToLb } from '@vert/engine';
import type { SessionWindow, WallWork } from '@vert/engine';
import type { Athlete, JumpTestWithReps, LocalDate, PainStatus } from '@/data';
import { bestSetsDraftFrom } from './bestSets';
import { hasLowerLimbPain } from './clearanceModel';
import { wallWorkFrom } from './climbing';
import { readBestSets, readSessionWindow, readWallWork, trainingAgeFromYears } from './engineAthlete';
import { DEFAULT_INVENTORY, readInventory } from './inventory';
import { maxRowsFor } from './maxLifts';
import { OWNER_STEP_ONE, OWNER_STEP_TWO } from './ownerPrefill';
import { SPORT_OPTIONS, type SportValue, type TrainingAgeValue } from './questions';
import { readinessConfigValuesFrom } from './readinessConfig';
import { MAX_LIFT_IDS } from './saveStepTwo';
import { STEP_TWO_DEFAULTS, type StepTwoValues } from './stepTwoValues';
import { mmToInches } from './stepTwoValidation';

/** The stored day count, narrowed. Four is what the rule book assumes. */
function daysOrDefault(value: number | null): 2 | 3 | 4 | 5 {
  return value === 2 || value === 3 || value === 5 ? value : 4;
}

/** The stored sport, narrowed. It decides which lifts step 2 asks a max for. */
function sportOf(sport: string | null): SportValue {
  return SPORT_OPTIONS.find((option) => option.value === sport)?.value ?? 'basketball';
}

function maxLb(athlete: Athlete | null, id: string): string {
  const max = athlete?.workingMax[id];
  if (max === undefined) return '';
  return `${Math.round(kgToLb(max.valueKg))}`;
}

/** The form, filled from the row on file and the baseline test beside it. */
function storedValues(
  athlete: Athlete | null,
  baseline: JumpTestWithReps | null,
  today: LocalDate,
): Partial<StepTwoValues> {
  const sport = sportOf(athlete?.sport ?? null);
  const reachTouch = baseline?.instrument === 'vertec_reach_touch';
  const jumpIn = baseline?.bestHeightMm == null ? null : mmToInches(baseline.bestHeightMm);
  const reachIn = athlete?.standingReachMm == null ? null : mmToInches(athlete.standingReachMm);
  const gym = readSessionWindow(athlete?.sessionWindow ?? null);

  return {
    measure: reachTouch ? 'reach' : 'device',
    baselineIn: reachTouch || jumpIn === null ? '' : `${jumpIn}`,
    reachIn: reachIn === null ? '' : `${reachIn}`,
    touchIn: reachTouch && jumpIn !== null && reachIn !== null ? `${jumpIn + reachIn}` : '',
    canonical: baseline?.canonical ?? false,
    goalIn: athlete?.goalHeightMm == null ? '' : `${mmToInches(athlete.goalHeightMm)}`,
    targetDate: athlete?.targetDate ?? '',
    weekdays: athlete?.weekdays ?? [],
    daysPerWeek: daysOrDefault(athlete?.daysPerWeek ?? null),
    gymStart: gym?.start ?? '',
    gymEnd: gym?.end ?? '',
    bodyweightLb:
      athlete?.bodyweightKg == null ? '' : `${Math.round(kgToLb(athlete.bodyweightKg))}`,
    squatLb: maxLb(athlete, MAX_LIFT_IDS.squat),
    hingeLb: maxLb(athlete, MAX_LIFT_IDS.hinge),
    pressLb: maxLb(athlete, MAX_LIFT_IDS.press),
    boxSquatLb: maxLb(athlete, MAX_LIFT_IDS.boxSquat),
    // The stored pull-up max is an Epley estimate, not the number that was
    // typed, so the field opens empty rather than showing a load back that
    // the athlete never entered.
    pullUpAddedLb: '',
    bestSets: bestSetsDraftFrom(
      readBestSets(athlete?.bestSets ?? null),
      maxRowsFor(sport).map((row) => row.field),
      today,
    ),
    readinessConfig: readinessConfigValuesFrom(athlete?.readinessConfig),
    inSeason: athlete?.inSeason ?? false,
    inventory: readInventory(athlete?.inventory) ?? DEFAULT_INVENTORY,
    readiness:
      athlete?.readinessPassedAt == null
        ? STEP_TWO_DEFAULTS.readiness
        : { squat: true, landing: true, training: true, pain: true },
  };
}

export interface StepTwoInitialInput {
  /** `undefined` while the read is in flight; `null` once it answered "no row". */
  readonly athlete: Athlete | null | undefined;
  readonly baseline: JumpTestWithReps | null | undefined;
  readonly pains: readonly PainStatus[] | undefined;
  readonly today: LocalDate;
  /** Settings asked for the owner's saved profile to fill the form. */
  readonly ownerRequested: boolean;
  /**
   * False while the database is still opening or the owner's boot write is
   * still in flight. Either one means the row about to be read is not the row
   * the athlete has.
   */
  readonly settled: boolean;
}

/** Everything step 2 needs before it can seed itself. */
export interface StepTwoStart {
  readonly values: Partial<StepTwoValues>;
  readonly trainingAge: TrainingAgeValue;
  readonly sport: SportValue;
  readonly wallWork: WallWork | null;
  readonly sessionWindow: SessionWindow | null;
  /** A reported lower-limb site keeps depth jumps off. */
  readonly lowerLimbPain: boolean;
}

export type StepTwoInitial = { readonly ready: false } | ({ readonly ready: true } & StepTwoStart);

const NOT_READY: StepTwoInitial = { ready: false };

/**
 * The form's opening values, or `ready: false` while anything it reads from is
 * still on its way.
 */
export function stepTwoInitial(input: StepTwoInitialInput): StepTwoInitial {
  if (!input.settled) return NOT_READY;
  if (input.athlete === undefined || input.baseline === undefined) return NOT_READY;
  if (input.pains === undefined) return NOT_READY;

  const athlete = input.athlete;
  const rowSport = athlete?.sport ?? null;
  const rowDays = athlete?.daysPerWeek ?? null;
  // Step 1 is saved before step 2 opens. For the answers step 2 only reads
  // (the days a week, the sport, the wall) the row outranks the saved profile
  // once it carries them: a step 1 answered as three days must not open a
  // step 2 that says "Pick 4" and checks the picks against a wall the athlete
  // just changed.
  const stepOneOnFile = rowSport !== null && rowDays !== null;
  const owner = input.ownerRequested && !stepOneOnFile;
  return {
    ready: true,
    // "Use my saved profile" answers everything step 2 asks except the two
    // heights and the date, which the athlete types over the top of it.
    values: input.ownerRequested
      ? {
          ...OWNER_STEP_TWO,
          readiness: STEP_TWO_DEFAULTS.readiness,
          ...(stepOneOnFile ? { daysPerWeek: daysOrDefault(rowDays) } : null),
        }
      : storedValues(athlete, input.baseline, input.today),
    trainingAge: owner
      ? OWNER_STEP_ONE.trainingAge
      : trainingAgeFromYears(athlete?.trainingAgeYears ?? null),
    sport: owner ? OWNER_STEP_ONE.sport : sportOf(rowSport),
    wallWork: owner ? wallWorkFrom(OWNER_STEP_ONE) : readWallWork(athlete?.wallWork ?? null),
    sessionWindow: readSessionWindow(athlete?.sessionWindow ?? null),
    lowerLimbPain: hasLowerLimbPain(input.pains),
  };
}
