/**
 * What a program-affecting edit changes, and where the change starts.
 *
 * Brief section 07 "Regeneration and pain": any program-affecting edit shows
 * what will change, then regenerates from the next unstarted week as a new
 * version; completed blocks are not repeated. Pain outranks that, because
 * safety runs first: a pain change re-materialises from the next unlogged
 * session and says "Applied from today's session" instead of asking.
 *
 * Everything here is pure so the confirm sheet and the test see the same
 * sentences.
 */
import {
  formatHeightIn,
  formatInteger,
  formatLoadLb,
  kgToLb,
  roundHalfUp,
  weekdayLabelOf,
  weekdayOf,
  analytics,
} from '@vert/engine';
import type { LocalDate } from '@/data';

/** A program parameter the athlete can edit in Settings. */
export type ProgramParam =
  | 'trainingAge'
  | 'sport'
  | 'secondaryGoal'
  | 'daysPerWeek'
  | 'weekdays'
  | 'goalHeight'
  | 'targetDate'
  | 'inSeason'
  | 'bodyweight'
  | 'fingerHistory'
  | 'gripMode'
  | 'fingerPainCeiling'
  | 'weakerSide'
  | 'wallWorkDays'
  | 'wallWindow'
  | 'wallFingerLoad'
  | 'wallGapHours'
  | 'valgusControl';

/** The parameters that are safe to change without rebuilding anything. */
const DISPLAY_ONLY: ReadonlySet<ProgramParam> = new Set(['bodyweight']);

export interface ParamChange {
  readonly field: ProgramParam;
  /** "Days a week", "Target date". Sentence case, never a rule number. */
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** The snapshot the change list is computed from. */
export interface ProgramParams {
  readonly trainingAgeYears: number | null;
  readonly sport: string | null;
  readonly secondaryGoal: string | null;
  readonly daysPerWeek: number | null;
  readonly weekdays: readonly number[];
  readonly goalHeightMm: number | null;
  readonly targetDate: LocalDate | null;
  readonly inSeason: boolean;
  readonly bodyweightKg: number | null;
  /* the climbing answers, each of which moves a house rule */
  readonly fingerHistory: boolean;
  readonly gripMode: string;
  readonly fingerPainCeiling: number;
  readonly weakerSide: string | null;
  readonly wallWorkDays: readonly number[];
  /** "18:00 to 20:00", or "not set". */
  readonly wallWindow: string;
  /** House `house.sc.hard_finger_spacing`: does the wall load the fingers. */
  readonly wallFingerHard: boolean;
  /** Hours gym finger work keeps from the wall on a shared day. */
  readonly wallGapHours: number;
  readonly valgusControl: boolean;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The training-age answer, in the words the athlete chose (brief 13). */
export function trainingAgeLabel(years: number | null): string {
  if (years === null) return 'not set';
  if (years < 0.5) return 'None';
  if (years < 1) return 'Less than 1 year';
  if (years < 4) return '1-3 yrs';
  return '4+ yrs';
}

export function weekdaysLabel(weekdays: readonly number[]): string {
  if (weekdays.length === 0) return 'not set';
  return weekdays.map((day) => WEEKDAY_NAMES[day] ?? '?').join(' ');
}

function sportLabel(sport: string | null): string {
  if (sport === null || sport === '') return 'not set';
  return sport.charAt(0).toUpperCase() + sport.slice(1).replace(/_/g, ' ');
}

/** "Upper body power", or "none" when the second goal was left unanswered. */
function secondaryGoalLabel(goal: string | null): string {
  if (goal === null || goal === '') return 'none';
  return goal.replace(/_/g, ' ');
}

function gripLabel(mode: string): string {
  return mode === 'open_hand' ? 'open hand only' : 'any';
}

function sideLabel(side: string | null): string {
  return side === null || side === '' ? 'not set' : side;
}

function heightLabel(mm: number | null): string {
  return mm === null ? 'not set' : formatHeightIn(mm);
}

/**
 * "Mon 12 Oct 2026". A target date is a day the athlete has to recognise in a
 * calendar, so Settings reads it as one; the ISO string stays the edited value
 * (defect D-27).
 */
export function formatCalendarDate(date: LocalDate): string {
  return `${weekdayLabelOf(date, weekdayOf(date))} ${analytics.formatShortDate(date)} ${date.slice(0, 4)}`;
}

/**
 * "8 Oct" from either a calendar day or an ISO timestamp. Settings never shows
 * a raw ISO string to the athlete (defect D-27); the stored value is untouched.
 */
export function shortCalendarDate(when: string): string {
  return analytics.formatShortDate(when.slice(0, 10));
}

function dateLabel(date: LocalDate | null): string {
  return date === null ? 'not set' : analytics.formatShortDate(date);
}

function weightLabel(kg: number | null): string {
  return kg === null ? 'not set' : formatLoadLb(roundHalfUp(kgToLb(kg), 0));
}

/** Every field that differs, in the order the Settings list shows them. */
export function diffParams(before: ProgramParams, after: ProgramParams): ParamChange[] {
  const changes: ParamChange[] = [];

  const push = (field: ProgramParam, label: string, from: string, to: string): void => {
    if (from !== to) changes.push({ field, label, from, to });
  };

  push(
    'trainingAge',
    'Training age',
    trainingAgeLabel(before.trainingAgeYears),
    trainingAgeLabel(after.trainingAgeYears),
  );
  push('sport', 'Sport', sportLabel(before.sport), sportLabel(after.sport));
  push(
    'secondaryGoal',
    'Second goal',
    secondaryGoalLabel(before.secondaryGoal),
    secondaryGoalLabel(after.secondaryGoal),
  );
  push(
    'daysPerWeek',
    'Days a week',
    before.daysPerWeek === null ? 'not set' : `${before.daysPerWeek}`,
    after.daysPerWeek === null ? 'not set' : `${after.daysPerWeek}`,
  );
  push('weekdays', 'Training days', weekdaysLabel(before.weekdays), weekdaysLabel(after.weekdays));
  push('goalHeight', 'Goal height', heightLabel(before.goalHeightMm), heightLabel(after.goalHeightMm));
  push('targetDate', 'Target date', dateLabel(before.targetDate), dateLabel(after.targetDate));
  push('inSeason', 'In-season', before.inSeason ? 'yes' : 'no', after.inSeason ? 'yes' : 'no');
  push('bodyweight', 'Bodyweight', weightLabel(before.bodyweightKg), weightLabel(after.bodyweightKg));
  push(
    'fingerHistory',
    'Finger or pulley injury history',
    before.fingerHistory ? 'yes' : 'no',
    after.fingerHistory ? 'yes' : 'no',
  );
  push('gripMode', 'Grip', gripLabel(before.gripMode), gripLabel(after.gripMode));
  push(
    'fingerPainCeiling',
    'Finger pain ceiling',
    `${formatInteger(before.fingerPainCeiling)} / 10`,
    `${formatInteger(after.fingerPainCeiling)} / 10`,
  );
  push('weakerSide', 'Weaker side', sideLabel(before.weakerSide), sideLabel(after.weakerSide));
  push(
    'wallWorkDays',
    'Wall work days',
    weekdaysLabel(before.wallWorkDays),
    weekdaysLabel(after.wallWorkDays),
  );
  push('wallWindow', 'Wall work window', before.wallWindow, after.wallWindow);
  push(
    'wallFingerLoad',
    'Climbing counts as hard finger work',
    before.wallFingerHard ? 'yes' : 'no',
    after.wallFingerHard ? 'yes' : 'no',
  );
  push(
    'wallGapHours',
    'Same-day gym and climbing gap',
    `${formatInteger(before.wallGapHours)} h`,
    `${formatInteger(after.wallGapHours)} h`,
  );
  push(
    'valgusControl',
    'Valgus control (RNT)',
    before.valgusControl ? 'on' : 'off',
    after.valgusControl ? 'on' : 'off',
  );

  return changes;
}

/** True when at least one changed field actually moves the program. */
export function needsRegeneration(changes: readonly ParamChange[]): boolean {
  return changes.some((change) => !DISPLAY_ONLY.has(change.field));
}

/** One week, reduced to what "has this started" needs. */
export interface WeekProgress {
  readonly w: number;
  readonly windowStart: LocalDate;
  /** Sets logged anywhere in the week. */
  readonly loggedSets: number;
}

/**
 * The next week that has not begun. A week counts as begun once its window has
 * opened or anything in it is logged, so a regeneration never rewrites a week
 * the athlete is standing in.
 */
export function nextUnstartedWeek(
  weeks: readonly WeekProgress[],
  today: LocalDate,
): number | null {
  const ordered = [...weeks].sort((a, b) => a.w - b.w);
  for (const week of ordered) {
    if (week.loggedSets > 0) continue;
    if (week.windowStart <= today) continue;
    return week.w;
  }
  return null;
}

export interface RegenerationPlan {
  readonly changes: readonly ParamChange[];
  /** Null when nothing left to rebuild: the program has run out of weeks. */
  readonly fromWeek: number | null;
  /** "Regenerate from Week 8?" */
  readonly title: string;
  /** One line per change, plus what carries forward. */
  readonly lines: readonly string[];
  readonly confirmLabel: string;
}

/** What the confirm sheet says, built from the diff and the week the plan resumes at. */
export function regenerationPlan(
  changes: readonly ParamChange[],
  fromWeek: number | null,
  built = true,
): RegenerationPlan {
  const lines = changes.map((change) => `${change.label}: ${change.from} to ${change.to}`);

  // Nothing has been built, so nothing is being rebuilt: the answers are just
  // saved, and the build reads them when it runs.
  if (!built) {
    return {
      changes,
      fromWeek: null,
      title: 'Save your answers?',
      lines: [...lines, 'No program is built yet. Your answers are used when you build one.'],
      confirmLabel: 'Save answers',
    };
  }

  if (fromWeek === null) {
    return {
      changes,
      fromWeek,
      title: 'No weeks left to rebuild',
      lines: [
        ...lines,
        'This program has no unstarted weeks. The change is saved and applies to the next program.',
      ],
      confirmLabel: 'Save changes',
    };
  }

  return {
    changes,
    fromWeek,
    title: `Regenerate from Week ${fromWeek}?`,
    lines: [
      ...lines,
      `Weeks 1 to ${fromWeek - 1} keep their logs and are not rebuilt.`,
      'Ladder rungs and working maxes carry forward, re-clamped to your level.',
      'The old version stays readable in the Plan version history.',
    ],
    confirmLabel: `Regenerate from Week ${fromWeek}`,
  };
}

/** Pain never asks. It applies from the next unlogged session (brief 06). */
export const PAIN_APPLIED_LINE = "Applied from today's session";

/** The caption every athlete answer carries in Settings. */
export const CHANGES_YOUR_PROGRAM = 'Changes your program';

/**
 * The reason string stored on the new ProgramVersion row, so the Plan's
 * version history can say "v2 since 3 Oct (target date moved)".
 */
export function versionReason(changes: readonly ParamChange[]): string {
  if (changes.length === 0) return 'no change';
  if (changes.length === 1) {
    const only = changes[0];
    return only === undefined ? 'no change' : `${only.label.toLowerCase()} changed`;
  }
  return `${changes.length} settings changed`;
}
