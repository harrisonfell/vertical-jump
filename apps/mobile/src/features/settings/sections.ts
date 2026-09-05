/**
 * What Settings shows, decided before anything renders.
 *
 * The empty state belongs to the athlete row, not to the program. The moment
 * setup saves an answer there is something to show, and an athlete who has
 * answered the questions but not yet built a program was being told "No
 * profile yet" over the top of answers already on file (defect D-49). A
 * program that has not been built is one row that says so, with the action
 * that builds it, and every other section reads exactly as it will after the
 * build.
 */

export type SettingsSectionId =
  | 'athlete'
  | 'program'
  | 'lifts'
  | 'readiness'
  | 'link'
  | 'autoregulation'
  | 'data';

/** Every section, in the order the screen lays them down. */
const ALL_SECTIONS: readonly SettingsSectionId[] = [
  'athlete',
  'program',
  'lifts',
  'readiness',
  'link',
  'autoregulation',
  'data',
];

/** Shown only when the device has no athlete row at all. */
export const NO_PROFILE_LINE =
  'No profile yet. Answer the setup questions and your settings appear here.';

/** The Program row before there is a program. */
export const NOT_BUILT_VALUE = 'Not built yet';
export const NOT_BUILT_CAPTION =
  'Your answers are saved. Building turns them into weeks and sessions.';
export const BUILD_PROGRAM_LABEL = 'Build program';
/** Step two is where the training days, the goal and the target date are set. */
export const BUILD_PROGRAM_ROUTE = '/setup/two';

export type ProgramShape = 'built' | 'not_built';

export interface SettingsView {
  /** True only with no athlete row: nothing has been answered on this device. */
  readonly empty: boolean;
  /** The sections that render, in order. Empty when the screen is empty. */
  readonly sections: readonly SettingsSectionId[];
  /** Whether the Program section shows its parameters or the build row. */
  readonly program: ProgramShape;
}

export interface SettingsViewInput {
  readonly hasAthlete: boolean;
  readonly hasProgram: boolean;
}

export function settingsView({ hasAthlete, hasProgram }: SettingsViewInput): SettingsView {
  if (!hasAthlete) return { empty: true, sections: [], program: 'not_built' };
  return { empty: false, sections: ALL_SECTIONS, program: hasProgram ? 'built' : 'not_built' };
}
