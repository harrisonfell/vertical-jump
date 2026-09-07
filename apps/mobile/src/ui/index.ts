/** The UI kit's public surface. Screens import from here, never from a file. */

export { Text, type TextProps, type TextVariant } from './text';
export {
  ThemeProvider,
  breakpoint,
  fontFamily,
  radius,
  space,
  type,
  useScheme,
  useTheme,
  type ColorToken,
  type Theme,
  type TypeVariant,
} from './theme';
export { colors, type DataTokenName, type SchemeColors, type SchemeName } from './tokens.generated';

export { withAlpha, BACKDROP_ALPHA } from './color';
export {
  EASE_OUT_QUART,
  LANDING_PROMPT_SECONDS,
  SKELETON_CYCLE_MS,
  SKELETON_OPACITY,
  duration,
  easeOutQuart,
  type DurationToken,
} from './motion';
export {
  ariaState,
  describedBy,
  keyToIndex,
  moveIndex,
  rovingTabIndex,
  selectionState,
  useFocusVisible,
  useReducedMotion,
  type A11yState,
  type AriaState,
  type DescribedProps,
  type FocusVisible,
  type SelectableRole,
} from './a11y';

export {
  GLYPHS,
  GLYPH_NAMES,
  GLYPH_STROKE,
  GLYPH_VIEW_BOX,
  Glyph,
  PlanGlyph,
  ProgressGlyph,
  TodayGlyph,
  glyphNames,
  glyphPaths,
  type GlyphName,
  type GlyphPath,
  type GlyphProps,
  type NamedGlyphProps,
} from './glyphs';

export { Hairline, type HairlineProps } from './primitives/hairline';
export { FOCUS_OFFSET, FOCUS_WIDTH, FocusRing, type FocusRingProps } from './primitives/focusRing';
export {
  CONTENT_WIDTH,
  Screen,
  TwoColumn,
  gutterFor,
  type ScreenProps,
  type TwoColumnProps,
} from './primitives/screen';
export { Header, type HeaderProps } from './primitives/header';
export {
  Button,
  ButtonRow,
  type ButtonProps,
  type ButtonRowProps,
  type ButtonSize,
  type ButtonVariant,
} from './primitives/button';
export {
  Chip,
  ChipRow,
  type ChipOption,
  type ChipProps,
  type ChipRowProps,
} from './primitives/chip';
export {
  AnswerGroup,
  AnswerRow,
  type AnswerGroupProps,
  type AnswerOption,
  type AnswerRowProps,
} from './primitives/answerRow';
export { Field, type FieldProps } from './primitives/field';
export { DateField, type DateFieldProps } from './primitives/dateField';
export {
  clampDate,
  dateFieldText,
  dateToLocalDate,
  formatFullDate,
  localDateToDate,
  pickerStart,
  todayFromClock,
  type PickerStartInput,
} from './primitives/dateFieldModel';
export { Stepper, type StepperProps } from './primitives/stepper';
export {
  clampToBounds,
  decimalsForStep,
  parseNumeric,
  roundTo,
  stepDisabled,
  stepValue,
  type StepBounds,
} from './primitives/stepperMath';
export {
  SET_ROW_GRID,
  SetRow,
  type LandingQuality,
  type SetRowKind,
  type SetRowLogResult,
  type SetRowProps,
} from './primitives/setRow';
export {
  LANDING_SECONDS,
  canLog,
  initialSetRowState,
  logResult,
  setRowReducer,
  type SetRowConfig,
  type SetRowEvent,
  type SetRowPhase,
  type SetRowState,
} from './primitives/setRowState';
export { ExerciseHeader, type ExerciseHeaderProps } from './primitives/exerciseHeader';
export {
  SLOT_STATE_WORD,
  STRIP_WRAP_WIDTH,
  Strip,
  type RecoveryBand,
  type StripProps,
  type StripSlot,
  type StripSlotState,
  type StripState,
} from './primitives/strip';
export { Notice, type NoticeProps } from './primitives/notice';
export { ResultBlock, type ResultBlockProps } from './primitives/resultBlock';
export {
  FooterLine,
  RestBar,
  type FooterLineProps,
  type RestBarProps,
} from './primitives/restBar';
export {
  PROGRESS_TRACK_HEIGHT,
  ProgressBar,
  type ProgressBarProps,
} from './primitives/progressBar';
export { Table, type TableColumn, type TableProps } from './primitives/table';
export { Disclosure, type DisclosureProps } from './primitives/disclosure';
export { EmptyState, type EmptyStateProps } from './primitives/emptyState';
export { Sheet, useSheet, type SheetProps, type SheetState } from './sheet';
export { Skeleton, type SkeletonKind, type SkeletonProps } from './skeleton';

export { NAV_ITEMS, isActive, type NavItem } from './navigation/items';
export { NavRail } from './navigation/navRail';
export { TabBar } from './navigation/tabBar';
