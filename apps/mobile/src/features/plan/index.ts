/** Plan: the program as calendar weeks. */

export { PlanScreen } from './planScreen';
export { BlockBand, type BlockBandProps } from './blockBand';
export { WeekStrip, type WeekStripProps } from './weekStripView';
export { RulesSummary, type RulesSummaryProps } from './rulesSummary';
export { VersionHistory, type VersionHistoryProps } from './versionHistory';
export {
  blockLabelForWeek,
  blockSegments,
  phaseLabel,
  type BlockSegment,
  type SegmentWeek,
} from './blocks';
export { formatDayDate, formatDayMonth, weekdayShort } from './dates';
export {
  UPPER_POWER_LABEL,
  dayTypeLabel,
  fromEngineDayType,
  readPrescriptions,
  readSessionIntent,
  readSessionPlan,
  readSkeleton,
  readWeekPlan,
  toEngineDayType,
  toSessionRecord,
} from './engine';
export {
  contextTitle,
  programHeaderLine,
  sportLabel,
  trainingAgeLabel,
  versionNote,
  versionSpan,
  type ProgramHeaderInput,
  type VersionNoteInput,
} from './header';
export { countAdherence, ladderLine, liveAdherence } from './ladder';
export {
  PROJECTED_BY,
  buildPlanModel,
  isProjectedWeek,
  projectionLine,
  segmentWeeks,
  type PlanModel,
  type PlanModelInput,
} from './model';
export {
  FIRST_BUILD_REASON,
  NOTHING_TO_REVISE,
  REVISE_CAPTION,
  REVISE_LABEL,
  observedThroughWeek,
  projectedFromLayout,
  projectedFromReason,
  regeneratedSkeleton,
  revisePlanCopy,
  revisionReason,
  revisionTarget,
  toObservedWeeks,
  weekHasWork,
  type ObservedWeekSource,
  type RevisePlanCopy,
  type RevisionTarget,
  type RevisionTargetInput,
  type ReviseWeekFacts,
} from './revise';
export {
  backfillOnce,
  backfillProgram,
  backfillRange,
  useProjectionBackfill,
  type BackfillInput,
  type BackfillRange,
  type BackfillWeekFacts,
} from './backfill';
export {
  RevisionFailedError,
  rebuildFromWeek,
  refusalSentence,
  writeReplacedWeek,
  weekLayoutFor,
  type RebuildInput,
  type RebuildResult,
  type WeekFacts,
} from './rebuild';
export {
  reviseProgram,
  useRevise,
  useRevisionTarget,
  type ReviseInput,
  type RevisionResult,
} from './useRevise';
export {
  appliedRuleGroup,
  ruleGroups,
  ruleKindLabel,
  ruleNote,
  ruleNumbersNote,
  ruleSummaryLine,
  ruleTag,
  rulesSummaryCount,
  toRuleEntry,
  type RuleEntry,
  type RuleGroup,
  type RuleGroupKey,
} from './rules';
export { planNoticesFor, readinessChangedSomething, weekDayLines } from './weekLines';
export {
  DEFAULT_WALL_GAP_HOURS,
  climbingWeekLines,
  upperPowerWindowLine,
  type ClimbingWeekLinesInput,
  type UpperPowerWindowInput,
} from './climbLines';
export { PLAN_STATES, readPlanStates, type PlanState } from './states';
export {
  PROJECTED_LABEL,
  buildStrip,
  dayTypeShort,
  stripColumns,
  type CellState,
  type Strip,
  type StripCell,
  type StripColumn,
  type StripRow,
  type StripSessionInput,
  type StripWeekInput,
} from './weekStrip';
