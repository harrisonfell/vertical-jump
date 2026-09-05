/**
 * The questions setup asks, in the order it asks them.
 *
 * Gate 0 is the PAR-Q+ 2023 general health screen, seven questions, in plain
 * words. Step 1 is the ThisFiTT onboarding verbatim: its order, its answers.
 * Nothing here is invented; the two added items are the "Are you 18 or older?"
 * row (R1) and the Shin location the brief adds for R7 to R9.
 */
import type { ReadinessTestKind } from '@vert/engine';
import type { AnswerOption } from '@/ui';

/** The seven screening keys, in the order they are asked. */
export const RED_FLAG_KEYS = [
  'heartCondition',
  'chestPain',
  'dizziness',
  'chronicCondition',
  'prescriptionMedication',
  'boneOrJointProblem',
  'supervisedActivityOnly',
] as const;

export type RedFlagKey = (typeof RED_FLAG_KEYS)[number];

export interface GateQuestion {
  readonly key: RedFlagKey;
  readonly text: string;
  /** The PAR-Q+ qualifier, where the form carries one. */
  readonly detail?: string;
}

/** PAR-Q+ 2023 general health questions, plain, in order. */
export const GATE_QUESTIONS: readonly GateQuestion[] = [
  {
    key: 'heartCondition',
    text: 'Has a doctor ever said that you have a heart condition or high blood pressure?',
  },
  {
    key: 'chestPain',
    text: 'Do you feel pain in your chest at rest, during your daily activities, or when you are physically active?',
  },
  {
    key: 'dizziness',
    text: 'Do you lose balance because of dizziness, or have you lost consciousness in the last 12 months?',
    detail: 'Dizziness with over-breathing during hard exercise does not count.',
  },
  {
    key: 'chronicCondition',
    text: 'Have you ever been diagnosed with another chronic medical condition?',
    detail: 'Other than heart disease or high blood pressure.',
  },
  {
    key: 'prescriptionMedication',
    text: 'Are you currently taking prescribed medication for a chronic medical condition?',
  },
  {
    key: 'boneOrJointProblem',
    text: 'Do you have a bone or joint problem that could get worse if you become more physically active?',
  },
  {
    key: 'supervisedActivityOnly',
    text: 'Has a doctor ever said that you should only do medically supervised physical activity?',
  },
];

export const ADULT_QUESTION = 'Are you 18 or older?';

/** The yes and no pair, in the order a screening form asks it. */
export const YES_NO: readonly { readonly value: 'no' | 'yes'; readonly label: string }[] = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
];

/* --------------------------------------------------- step 1: the onboarding */

export type SportValue =
  | 'basketball'
  | 'speed_climbing'
  | 'football'
  | 'soccer'
  | 'track_field'
  | 'volleyball'
  | 'baseball'
  | 'none';

/**
 * Onboarding question 2, with Speed climbing second.
 *
 * Volleyball and baseball stay in `SportValue` so a profile saved before this
 * list still narrows to a sport the engine knows, but they are not offered:
 * the list an athlete picks from is the one the owner asked for.
 */
export const SPORT_OPTIONS: readonly AnswerOption<SportValue>[] = [
  { value: 'basketball', label: 'Basketball' },
  { value: 'speed_climbing', label: 'Speed climbing' },
  { value: 'football', label: 'Football' },
  { value: 'soccer', label: 'Soccer' },
  { value: 'track_field', label: 'Track and field' },
  { value: 'none', label: 'Other' },
];

export type SecondaryGoalValue =
  | 'upper_body_power'
  | 'speed'
  | 'strength'
  | 'injury_prevention';

/** The second goal, asked after the fixed primary one. None is no answer. */
export const SECONDARY_GOAL_OPTIONS: readonly AnswerOption<SecondaryGoalValue | 'none'>[] = [
  { value: 'upper_body_power', label: 'Upper body power' },
  { value: 'speed', label: 'Speed' },
  { value: 'strength', label: 'Strength' },
  { value: 'injury_prevention', label: 'Injury prevention' },
  { value: 'none', label: 'None' },
];

export type TrainingAgeValue = 'none' | 'lt1' | '1to3' | '4plus';

/** Onboarding question 3, verbatim. Level is derived from this and never typed. */
export const TRAINING_AGE_OPTIONS: readonly AnswerOption<TrainingAgeValue>[] = [
  { value: 'none', label: 'None' },
  { value: 'lt1', label: 'Less than 1 year' },
  { value: '1to3', label: '1-3 years' },
  { value: '4plus', label: '4+ years' },
];

/** Onboarding question 4, with 2 added and labelled as the declared minimum. */
export const AVAILABILITY_OPTIONS: readonly AnswerOption<2 | 3 | 4 | 5>[] = [
  { value: 2, label: '2 days a week', detail: 'The minimum this program runs on.' },
  { value: 3, label: '3 days a week' },
  { value: 4, label: '4 days a week' },
  { value: 5, label: '5 days a week' },
];

export type PainLocationValue =
  | 'knee'
  | 'achilles_calf'
  | 'shin'
  | 'hamstring'
  | 'hip'
  | 'back'
  | 'shoulder'
  | 'finger'
  | 'other';

/**
 * Onboarding question 5's locations, with Shin added beside Achilles / Calf
 * and Finger added for the pulley template (`house.pain_finger`).
 */
export const PAIN_LOCATION_OPTIONS: readonly AnswerOption<PainLocationValue>[] = [
  { value: 'knee', label: 'Knee' },
  { value: 'achilles_calf', label: 'Achilles / Calf' },
  { value: 'shin', label: 'Shin' },
  { value: 'hamstring', label: 'Hamstring' },
  { value: 'hip', label: 'Hip' },
  { value: 'back', label: 'Back' },
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'finger', label: 'Finger' },
  { value: 'other', label: 'Other' },
];

/** The three chips the athlete taps, verbatim. Stored as 1, 3 and 5. */
export const PAIN_SEVERITY_OPTIONS: readonly AnswerOption<1 | 3 | 5>[] = [
  { value: 1, label: '1-2 (minor)' },
  { value: 3, label: '3-4 (moderate)' },
  { value: 5, label: '5+ (limits training)' },
];

/** The duration boundary: 12 weeks is where acute becomes chronic (ICD-11). */
export const PAIN_DURATION_OPTIONS: readonly AnswerOption<'acute' | 'chronic'>[] = [
  { value: 'acute', label: 'Under 12 weeks' },
  { value: 'chronic', label: '12 weeks or more' },
];

/**
 * The depth-jump readiness checklist, from the house rule
 * `house.depth_jump_readiness`. The pain item reads from step 1.
 */
export const READINESS_ITEMS = [
  { key: 'squat', label: 'A squat at 1.5 times bodyweight, or 20 single-leg box squats' },
  { key: 'landing', label: 'A clean landing from a 12 in step-off' },
  { key: 'training', label: 'Three months of consistent training' },
  { key: 'pain', label: 'No lower-limb pain' },
] as const;

export type ReadinessKey = (typeof READINESS_ITEMS)[number]['key'];

/* ---------------------------------------------- the climbing answers */

export type GripModeValue = 'open_hand' | 'any';

/** House `house.sc.open_hand_grip`. Open hand only is the safer of the two. */
export const GRIP_MODE_OPTIONS: readonly AnswerOption<GripModeValue>[] = [
  { value: 'open_hand', label: 'Open hand only' },
  { value: 'any', label: 'Any' },
];

export type WeakerSideValue = 'left' | 'right' | 'unsure';

/** House `house.sc.weaker_side_first`. Not sure is answered by a test later. */
export const WEAKER_SIDE_OPTIONS: readonly AnswerOption<WeakerSideValue>[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'unsure', label: 'Not sure' },
];

/** House `house.sc.readiness_gate` channel B, swappable, never hardcoded. */
export const READINESS_KIND_OPTIONS: readonly AnswerOption<ReadinessTestKind>[] = [
  { value: 'seated_mb_throw', label: 'Seated med ball throw', detail: 'Distance, best of 3.' },
  { value: 'cmj', label: 'CMJ', detail: 'Countermovement jump height, best of 3.' },
  { value: 'rsi', label: 'RSI', detail: 'Reactive strength index, best of 3.' },
];

/** Monday first, the way a training week is read. Sunday closes it. */
export const WEEKDAY_CHIPS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];
