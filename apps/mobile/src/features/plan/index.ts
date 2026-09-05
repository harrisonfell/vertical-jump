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
export { buildPlanModel, segmentWeeks, type PlanModel, type PlanModelInput } from './model';
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
