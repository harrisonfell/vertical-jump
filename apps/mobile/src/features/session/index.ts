/** Session detail: one session in the past or the future. */

export { SessionScreen, type SessionScreenProps } from './sessionScreen';
export { PastView, type PastViewProps } from './pastView';
export { FutureView, type FutureViewProps } from './futureView';
export { RetroView, type RetroViewProps } from './retroView';
export {
  ExerciseRows,
  SessionBlocks,
  type ExerciseRowsProps,
  type SessionBlocksProps,
} from './exerciseRows';
export { WhoopMatch, type WhoopMatchProps } from './whoopMatch';
export { blockName, groupExercises, isGrouped, type ExerciseGroup } from './blockNames';
export { useFingerPainOn } from './answers';
export {
  hasHardFingerWork,
  rowNotes,
  rowNotesFor,
  type RowNotes,
} from './planNotes';
export {
  AWAITING_WORKOUT,
  PROJECTED_CAPTION,
  compareSets,
  doneSummaryLine,
  feelLine,
  fingerPainLine,
  finishedAfterBuildLine,
  futureTargetsLine,
  matchWindow,
  nextWeekIsFinal,
  notBuiltLine,
  notFinishedLine,
  rowNoteLine,
  sessionMinutes,
  sessionView,
  tonnageLb,
  usesAddedLoadDisplay,
  workoutEvidenceLine,
  type CompareOptions,
  type DoneSummaryInput,
  type FutureTargetsInput,
  type MatchWindow,
  type SessionView,
  type SetRowModel,
  type WeekSource,
  type WorkoutEvidence,
} from './detail';
export { SESSION_STATES, readSessionStates, type SessionState } from './states';
