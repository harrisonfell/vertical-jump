import { addDays, weekdayLabelOf, weekdayOf } from '@vert/engine';
import { joinParts } from '@vert/engine/analytics';
import type { GlyphName } from '@/ui';
import type { DayType, LocalDate, SessionStatus, WeekKind } from '@/data/types';
import { formatDayDate, formatDayMonth } from './dates';
import { dayTypeLabel } from './engine';

/**
 * The week strip: rows are calendar weeks from day 0's weekday, columns are
 * the actual weekdays, and every cell carries a day type and a state as a
 * glyph plus a word. No state is ever colour alone (brief section 06).
 *
 * Rest days are cells too. A week with four training days has three of them,
 * and drawing them keeps the calendar honest: the athlete can see where the
 * gaps sit before deciding to move a session.
 */

/** The five cell states, plus rest for a day with no session on it. */
export type CellState = SessionStatus | 'rest';

export interface StripColumn {
  readonly key: string;
  /** "Mon". */
  readonly label: string;
  /** 0 Sunday to 6 Saturday. */
  readonly weekday: number;
}

export interface StripCell {
  readonly key: string;
  readonly date: LocalDate;
  /** "8 Sep". */
  readonly dateLabel: string;
  readonly dayType: DayType | null;
  /** The words the day is called: "Upper power" on a climber's Tuesday. */
  readonly dayTypeLabel: string;
  /** "Lower", "Upper power", "Power", "Recovery", "Rest". */
  readonly dayTypeShort: string;
  readonly dayGlyph: GlyphName;
  readonly state: CellState;
  /** "Done", "Not finished", "Missed", "Planned", "Rest". */
  readonly stateLabel: string;
  readonly stateGlyph: GlyphName | null;
  readonly isTest: boolean;
  readonly isToday: boolean;
  readonly isPast: boolean;
  /** Null when the week has not been built yet, so the cell does not open. */
  readonly sessionId: string | null;
  /** The whole cell as one sentence, for a screen reader. */
  readonly label: string;
}

export interface StripRow {
  readonly w: number;
  /** "Week 7". */
  readonly weekLabel: string;
  readonly kind: WeekKind;
  /** "Repeat of week 6" when R94 repeated it. */
  readonly repeatLabel: string | null;
  /** True for a week built from the plan as written, not from real outcomes. */
  readonly projected: boolean;
  /** "Projected", the one honest word for such a week. Null otherwise. */
  readonly projectedLabel: string | null;
  readonly isCurrent: boolean;
  readonly cells: StripCell[];
}

export interface StripWeekInput {
  readonly w: number;
  readonly windowStart: LocalDate;
  readonly kind: WeekKind;
  readonly repeatOfWeek?: number;
  /**
   * True when the week was materialized from the plan as written rather than
   * from what the athlete actually did. Every week after the current one is
   * projected until a real week is logged and the plan is revised.
   */
  readonly projected?: boolean;
}

export interface StripSessionInput {
  /** Null until the week is built: a cell with no id does not open. */
  readonly id: string | null;
  readonly date: LocalDate;
  readonly dayType: DayType;
  readonly status: SessionStatus;
  readonly isTest: boolean;
  /**
   * True when this sport runs the Upper Strength day as a power day
   * (house rule `house.sc.upper_power_day`). It changes the word, never the
   * stored day type.
   */
  readonly upperPower?: boolean;
}

const DAY_SHORT: Readonly<Record<DayType, string>> = {
  'Full Body Strength': 'Full body',
  'Lower Strength': 'Lower',
  'Upper Strength': 'Upper',
  'Upper + Mobility': 'Upper + mob',
  'Power + Speed': 'Power',
  Power: 'Power',
  Speed: 'Speed',
  'Recovery - Mobility': 'Recovery',
};

const DAY_GLYPH: Readonly<Record<DayType, GlyphName>> = {
  'Full Body Strength': 'day-strength',
  'Lower Strength': 'day-strength',
  'Upper Strength': 'day-upper',
  'Upper + Mobility': 'day-upper',
  'Power + Speed': 'day-power',
  Power: 'day-power',
  Speed: 'day-power',
  'Recovery - Mobility': 'day-recovery',
};

const STATE_LABEL: Readonly<Record<CellState, string>> = {
  rest: 'Rest',
  planned: 'Planned',
  done: 'Done',
  not_finished: 'Not finished',
  missed: 'Missed',
};

const STATE_GLYPH: Readonly<Record<CellState, GlyphName | null>> = {
  rest: null,
  planned: 'state-planned',
  done: 'state-done',
  not_finished: 'state-notfinished',
  missed: 'state-missed',
};

/** The one word a projected week carries. Plain, and never colour alone. */
export const PROJECTED_LABEL = 'Projected';

/** The short word a cell shows for its day type. */
export function dayTypeShort(dayType: DayType, upperPower = false): string {
  return upperPower && dayType === 'Upper Strength' ? 'Upper power' : DAY_SHORT[dayType];
}

/** The seven column heads, starting from day 0's weekday. */
export function stripColumns(day0: LocalDate): StripColumn[] {
  return Array.from({ length: 7 }, (_unused, offset) => {
    const date = addDays(day0, offset);
    const weekday = weekdayOf(date);
    return { key: `col-${weekday}`, label: weekdayLabelOf(date, weekday), weekday };
  });
}

function buildCell(
  date: LocalDate,
  session: StripSessionInput | undefined,
  today: LocalDate,
): StripCell {
  const state: CellState = session === undefined ? 'rest' : session.status;
  const dayType = session === undefined ? null : session.dayType;
  const isTest = session?.isTest === true;
  const upperPower = session?.upperPower === true;
  const label = dayType === null ? 'Rest' : dayTypeLabel(dayType, upperPower);

  return {
    key: date,
    date,
    dateLabel: formatDayMonth(date),
    dayType,
    dayTypeLabel: label,
    dayTypeShort: dayType === null ? 'Rest' : dayTypeShort(dayType, upperPower),
    dayGlyph: dayType === null ? 'day-rest' : DAY_GLYPH[dayType],
    state,
    stateLabel: STATE_LABEL[state],
    stateGlyph: STATE_GLYPH[state],
    isTest,
    isToday: date === today,
    isPast: date < today,
    sessionId: session?.id ?? null,
    label: joinParts([
      formatDayDate(date),
      dayType === null ? 'Rest day' : label,
      isTest ? 'test day' : null,
      state === 'rest' ? null : STATE_LABEL[state].toLowerCase(),
    ]),
  };
}

export interface StripInput {
  readonly weeks: readonly StripWeekInput[];
  readonly sessions: readonly StripSessionInput[];
  readonly today: LocalDate;
  /** The week today sits in, outlined green in the band and marked here. */
  readonly currentWeek: number | null;
}

export interface Strip {
  readonly columns: StripColumn[];
  readonly rows: StripRow[];
}

/** The whole grid: seven columns, one row per calendar week. */
export function buildStrip(input: StripInput): Strip {
  const weeks = [...input.weeks].sort((a, b) => a.w - b.w);
  const first = weeks[0];
  if (first === undefined) return { columns: [], rows: [] };

  const byDate = new Map<LocalDate, StripSessionInput>();
  for (const session of input.sessions) byDate.set(session.date, session);

  const columns = stripColumns(first.windowStart);

  const rows = weeks.map<StripRow>((week) => ({
    w: week.w,
    weekLabel: `Week ${week.w}`,
    kind: week.kind,
    repeatLabel: week.repeatOfWeek === undefined ? null : `Repeat of week ${week.repeatOfWeek}`,
    projected: week.projected === true,
    projectedLabel: week.projected === true ? PROJECTED_LABEL : null,
    isCurrent: week.w === input.currentWeek,
    cells: Array.from({ length: 7 }, (_unused, offset) => {
      const date = addDays(week.windowStart, offset);
      return buildCell(date, byDate.get(date), input.today);
    }),
  }));

  return { columns, rows };
}
