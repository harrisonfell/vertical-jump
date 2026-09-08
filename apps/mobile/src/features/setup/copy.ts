/**
 * Every fixed string setup shows. Brief section 13 wording is verbatim; the
 * rest is second person, numbers over adjectives, no hype and no guilt.
 *
 * Lines that carry numbers are built by the functions at the bottom so a
 * screen never assembles a sentence out of template literals of its own.
 */
import { formatShortDate } from '@vert/engine/analytics';
import { formatInteger, weekdayOf } from '@vert/engine';
import type { LocalDate } from '@/data';

export const SETUP_COPY = {
  /* gate 0 */
  gateTitle: 'Medical self-screen',
  gateLead:
    'Seven standard screening questions, then your age. Answer them once. Your answers stay on this phone.',
  gateAdultDetail: 'Under 18 caps maximal loading at 90% effort.',
  gateSubmit: 'Save answers',
  gateUnanswered: 'Answer every question before you continue.',

  /* clearance */
  clearanceTitle: 'Medical clearance',
  clearanceSelfScreen:
    'Medical clearance needed. You answered yes to a screening question. No program is built until a clinician clears you.',
  clearanceReprompt: 'You will be asked again in 2 weeks.',
  clearanceStillReachable: 'Settings, Whoop, export and your past data stay reachable.',
  clearanceDateLabel: 'Cleared by a clinician on a date',
  clearanceDateHelper: 'Use YYYY-MM-DD, for example 2026-09-04.',
  clearanceDateRequired: 'Enter the date you were cleared. Use YYYY-MM-DD, for example 2026-09-04.',
  clearanceDateInvalid: "That isn't a date. Use YYYY-MM-DD, for example 2026-09-04.",
  clearanceDateFuture: 'That date is in the future. Enter the date you were cleared.',
  clearanceRecord: 'Record clearance',
  clearanceBuildAnyway: 'Build the restricted plan anyway',
  clearanceEitherWay: 'The exclusions apply either way.',
  clearanceOpenSettings: 'Open Settings',

  /* step 1 */
  stepOneTitle: 'Your answers',
  stepOneSport: 'What sport do you play most?',
  stepOneTrainingAge: 'How much weight room experience do you have?',
  stepOneAvailability: 'How many days a week can you realistically train?',
  stepOnePain: 'Are you dealing with any pain or injury right now?',
  stepOnePainLocation: 'Where is the main issue?',
  stepOnePainSeverity: 'How severe is it right now?',
  stepOnePainDuration: 'How long has it bothered you?',
  stepOnePainDurationDetail: '12 weeks is the boundary between acute and chronic.',
  stepOneSecondGoal: 'Second goal',
  stepOneSecondGoalDetail: 'One more thing the program makes room for. None is an answer.',
  stepOneFingerHistory: 'Finger or pulley injury history',
  stepOneFingerHistoryDetail: 'An A2 pulley strain counts. This changes which pulling rows you are given.',
  stepOneGripTitle: 'Grip and knees',
  stepOneGripLead:
    'Five answers the climbing rules read. Each one is used by name on the Plan.',
  stepOneGrip: 'Grip on pulling movements',
  stepOneGripDetail: 'Open hand only leaves crimped variants out of the pool.',
  stepOneCeiling: 'Finger pain ceiling',
  stepOneCeilingDetail:
    'At or above this, hard finger work comes off the day and the session says so.',
  stepOneWallDays: 'Wall work days',
  stepOneWallDaysDetail: 'The days you climb. Knee alignment work sits at least 6 h away from them.',
  stepOneWallStart: 'Wall work starts',
  stepOneWallEnd: 'Wall work ends',
  stepOneWallTimeHelper: 'Use a 24-hour time, for example 18:00.',
  stepOneWallFinger: 'Climbing counts as hard finger work',
  stepOneWallFingerDetail:
    'On for speed climbing: a wall session loads the fingers, so gym pulling keeps 48 h from it. Turn it off only if your climbing is genuinely light on the hands.',
  stepOneWallGap: 'Same-day gym and climbing gap',
  stepOneWallGapDetail:
    'Gym pulling and the wall may share a day when they are at least this far apart. Anything closer moves the pulling to light work.',
  stepOneValgus: 'Valgus control (RNT) twice a week',
  stepOneValgusDetail: 'Band-pulled knee alignment, reps end when the knee drifts.',
  stepOneWeakerSide: 'Weaker side',
  stepOneWeakerSideDetail: 'The weaker leg goes first on single-leg work. A single-leg test overrides this.',
  stepOneSubmit: 'Save and continue',
  stepOneIncomplete: 'Answer every question before you continue.',

  /* step 2 */
  stepTwoTitle: 'Jump inputs',
  stepTwoMeasure: 'How do you measure your jump?',
  stepTwoMeasureDevice: 'OVR Jump',
  stepTwoMeasureDeviceDetail: 'Type the number off the device display.',
  stepTwoMeasureReach: 'Reach and touch',
  stepTwoMeasureReachDetail: 'No device yet. Stored on the Vertec stream.',
  stepTwoBaselineLabel: 'Baseline jump height',
  stepTwoReachLabel: 'Standing reach',
  stepTwoTouchLabel: 'Touch height',
  stepTwoCanonical: 'Measured today under test conditions',
  stepTwoCanonicalDetail:
    'Leave this off and the baseline stays an open marker until your first real test.',
  stepTwoGoalLabel: 'Goal jump height',
  stepTwoTargetLabel: 'Target date',
  stepTwoTargetHelper: 'At least 2 weeks out.',
  stepTwoWeekdays: 'Which days do you train?',
  stepTwoGym: 'When do you lift?',
  stepTwoGymStart: 'Gym session starts',
  stepTwoGymEnd: 'Gym session ends',
  stepTwoGymTimeHelper: 'Use a 24-hour time, for example 08:00.',
  stepTwoInventory: 'Equipment',
  stepTwoInventoryEdit: 'Edit equipment',
  stepTwoBodyweight: 'Bodyweight',
  stepTwoMaxesTitle: 'Per-lift 1RM, optional',
  stepTwoMaxesCaption:
    'Enter a 1RM if you know it. Without one, your first week runs at RPE 6-7 and you log the weight you use; loads are prescribed from week 2',
  stepTwoSquat: 'Back squat 1RM',
  stepTwoHinge: 'Trap-bar deadlift 1RM',
  stepTwoPress: 'Dumbbell bench press 1RM',
  stepTwoPressDetail: 'The heaviest pair you have pressed for one rep. This is the lift the program prescribes on Upper Strength.',
  stepTwoInSeason: 'In season',
  stepTwoInSeasonDetail: 'Games count as the change-of-direction session and jump contacts halve.',
  stepTwoReadiness: 'Depth-jump readiness',
  stepTwoReadinessPainOk: 'No lower-limb pain (from your answers)',
  stepTwoReadinessPainNo: 'You reported lower-limb pain, so depth jumps stay off.',
  stepTwoClimbMaxesTitle: 'Per-lift 1RM, optional',
  stepTwoBoxSquat: 'Box squat 1RM',
  stepTwoBoxSquatDetail: 'The lower main lift for this sport. Every working set is a percentage of it.',
  stepTwoPullUp: 'Weighted pull-up added load (about 5RM)',
  stepTwoPullUpDetail:
    'The load you hang, not your bodyweight. Rows read "5 × BW + 45 lb".',
  stepTwoEnteredMaxCaption:
    'What you enter replaces the max on file, a lower number included, from the next week your program builds.',
  stepTwoBestSetTitle: 'Best recent set, optional',
  stepTwoBestSetCaption:
    'One set you know was close to your limit. A set at RPE 8 or higher with 6 reps or fewer counts as a near-max for the estimate, so it is read at face value instead of being discounted.',
  stepTwoBestSetReps: 'Reps',
  stepTwoBestSetLoad: 'Load',
  stepTwoBestSetAddedLoad: 'Added load',
  stepTwoBestSetRpe: 'Effort (RPE)',
  stepTwoBestSetDate: 'Date',
  stepTwoBestSetDateHelper: 'The day you did the set. Defaults to today.',
  stepTwoReadinessTest: 'Readiness test',
  stepTwoReadinessTestDetail:
    'The neuromuscular channel of the daily gate. The recovery score is the other one, and the two are never averaged.',
  stepTwoReadinessAttempts: 'Attempts',
  stepTwoReadinessAttemptsDetail: "The best of them is the day's number.",
  stepTwoReadinessWindow: 'Baseline window',
  stepTwoReadinessWindowDetail: 'How many earlier tests the rolling median is taken over.',
  stepTwoReadinessThreshold: 'Low threshold',
  stepTwoReadinessThresholdDetail: 'More than this far below the median reads low.',
  stepTwoSubmit: 'Save and continue',
  stepTwoRefusalDetail: 'Fix it above, then save again.',
  stepTwoBestSetIncomplete: 'A best recent set above is incomplete.',

  /* step 3 */
  stepThreeTitle: 'Whoop',
  stepThreeNoServer: 'Whoop connects once the review server is set up. Skip for now.',
  stepThreeLead:
    'Whoop adds recovery, sleep and strain beside your own numbers. It never changes a prescription unless you turn autoregulation on later.',
  stepThreeConnect: 'Connect Whoop',
  stepThreeSkip: 'Skip for now',
  stepThreeCancelled: 'Connection cancelled, nothing changed.',
  stepThreeFailed: "Couldn't reach the review server. Check your connection.",
  stepThreeAttribution: 'Data by WHOOP',

  /* build */
  buildTitle: 'Build program',
  buildRunning: 'Building your program',
  buildRuleBook: 'Running the rule book',
  buildSavingProgram: 'Saving the program',
  buildBuildingWeek: 'Building week',
  buildWritingWeek: 'Writing week',
  buildSessionWord: 'session',
  buildLead:
    'This runs the rule book over your answers and writes every session of every week.',
  buildAction: 'Build program',
  buildRetry: 'Build again',
  buildValidationTitle: 'A rule refused this program',
  buildValidationLead: 'Nothing was saved. Change an answer and build again.',
  buildBlocked:
    'No program is built until a clinician clears you. Record the clearance and build again.',
  buildSummaryTitle: 'Program built',
  buildGoToToday: 'Go to Today',
  buildBackToAnswers: 'Change your answers',

  /* pairing */
  pairTitle: 'Pair this phone',
  loginTitle: 'Sign in',
  pairNoServer:
    'No review server is set up yet. Everything you log stays on this phone.',
  pairPrivacyLink: 'Read the privacy page',
  pairCodeLabel: 'One-time code',
  pairCodeHelper: 'Enter the code shown on the web review. Six digits.',
  pairCodeInvalid: 'That code needs six digits.',
  pairCodeWrong: "That code didn't work. Check the web review and type it again.",
  pairSubmit: 'Pair this phone',
  pairDone: 'This phone is paired.',
  loginPassphraseLabel: 'Passphrase',
  loginPassphraseHelper: 'The passphrase you set on the review server.',
  loginWrong: 'Wrong passphrase',
  loginSubmit: 'Sign in',
  pairUnreachable: "Couldn't reach the review server. Check your connection.",

  /* privacy */
  privacyTitle: 'Privacy',
  privacySupport: 'support: set in Settings',
} as const;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Why step 2 asks a climber when they lift (`house.sc.sport_requirements`):
 * the hard pulling day may share a wall day only when the gym clears the wall
 * by the same-day gap, and two blank fields leave the engine on its assumed
 * window, which is said out loud rather than applied in silence.
 */
export function gymWindowDetail(
  gapHours: number,
  assumed: { readonly start: string; readonly end: string },
): string {
  return (
    `Hard pulling shares a climbing day only when the gym is ${formatInteger(gapHours)} h clear of the wall.` +
    ` Blank assumes ${assumed.start} to ${assumed.end}.`
  );
}

/** "Mon 8 Sep": the weekday and short date the key copy writes. */
export function formatDayDate(date: LocalDate): string {
  const short = WEEKDAY_SHORT[weekdayOf(date)] ?? '';
  return `${short} ${formatShortDate(date)}`;
}

export interface ProgramBuiltInput {
  readonly weeks: number;
  readonly daysPerWeek: number;
  readonly week1Start: LocalDate;
  readonly firstTestDate: LocalDate | null;
  readonly peakEnd: LocalDate;
}

/** Brief section 13 "Program built", verbatim, with this program's numbers. */
export function programBuiltLine(input: ProgramBuiltInput): string {
  const test =
    input.firstTestDate === null
      ? ''
      : `, first jump test ${formatDayDate(input.firstTestDate)}`;
  return [
    `Program built: ${input.weeks} weeks, ${input.daysPerWeek} days a week.`,
    ` Week 1 starts ${formatDayDate(input.week1Start)}${test},`,
    ` peak week ends ${formatDayDate(input.peakEnd)}.`,
    ' Week 1 is moderate effort (RPE 6-7) on lifts without a max;',
    ' loads are prescribed from week 2.',
  ].join('');
}

/**
 * The wait after five failed attempts, brief section 13 "Try again in 60 s",
 * counted down so the screen never names a wait that has already passed.
 */
export function lockoutLine(seconds: number): string {
  return `Try again in ${String(Math.max(0, Math.round(seconds)))} s`;
}

/** The reassessment prompt, brief section 13, with the site named. */
export function reassessmentLine(locationPhrase: string, severityWord: string): string {
  return [
    `${locationPhrase} check.`,
    ` Two weeks ago you reported new, ${severityWord} ${locationPhrase.toLowerCase()} pain`,
    ' and the program ran it as moderate. How is it now?',
  ].join('');
}
