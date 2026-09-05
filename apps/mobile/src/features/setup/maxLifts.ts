/**
 * Which lifts a sport asks an entered 1RM for.
 *
 * Speed climbing runs the box squat as the lower main lift and the weighted
 * pull-up as the upper one, so those are the two numbers it asks for; every
 * other sport keeps the back squat, the trap-bar deadlift and the dumbbell
 * bench press it always had. Pure, so the row list can be read without a
 * render.
 */
import { SETUP_COPY } from './copy';
import type { SportValue } from './questions';
import { showsClimbingLifts } from './climbing';
import type { StepTwoField } from './stepTwoValidation';

/** The five text fields the entered maxes are typed into. */
export interface MaxesValues {
  readonly squatLb: string;
  readonly hingeLb: string;
  readonly pressLb: string;
  readonly boxSquatLb: string;
  readonly pullUpAddedLb: string;
}

export interface MaxLiftRow {
  readonly field: keyof MaxesValues & StepTwoField;
  readonly label: string;
  readonly helper?: string;
  readonly testID: string;
}

const CLIMBING_ROWS: readonly MaxLiftRow[] = [
  {
    field: 'boxSquatLb',
    label: SETUP_COPY.stepTwoBoxSquat,
    helper: SETUP_COPY.stepTwoBoxSquatDetail,
    testID: 'step-two-box-squat',
  },
  {
    field: 'pullUpAddedLb',
    label: SETUP_COPY.stepTwoPullUp,
    helper: SETUP_COPY.stepTwoPullUpDetail,
    testID: 'step-two-pull-up',
  },
];

const DEFAULT_ROWS: readonly MaxLiftRow[] = [
  { field: 'squatLb', label: SETUP_COPY.stepTwoSquat, testID: 'step-two-squat' },
  { field: 'hingeLb', label: SETUP_COPY.stepTwoHinge, testID: 'step-two-hinge' },
  {
    field: 'pressLb',
    label: SETUP_COPY.stepTwoPress,
    helper: SETUP_COPY.stepTwoPressDetail,
    testID: 'step-two-press',
  },
];

/** The lifts this sport asks a 1RM for, in the order they are shown. */
export function maxRowsFor(sport: SportValue): readonly MaxLiftRow[] {
  return showsClimbingLifts(sport) ? CLIMBING_ROWS : DEFAULT_ROWS;
}

/**
 * The caption under the rows. An entered value outranks the frozen max at the
 * next week build, a lower number included, and the climbing rows say so.
 */
export function maxesCaptionFor(sport: SportValue): string {
  return showsClimbingLifts(sport)
    ? `${SETUP_COPY.stepTwoMaxesCaption}. ${SETUP_COPY.stepTwoEnteredMaxCaption}`
    : SETUP_COPY.stepTwoMaxesCaption;
}
