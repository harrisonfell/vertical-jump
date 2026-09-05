import type { SessionPlan, SessionWindow, WallWork, WeekPlan } from '@vert/engine';
import { formatInteger } from '@vert/engine/units';
import { weekdayShort } from './dates';

/**
 * The climbing lines the app says for itself.
 *
 * Almost every sentence on the Plan is the engine's: it decided, so it words
 * it. One is not. The generator places the upper-power day on a climbing day
 * when the two windows clear each other (`house.sc.sport_requirements`), but
 * it says nothing about it, because from inside the week that placement is
 * simply where the day is. From outside it is the answer to "why is my hardest
 * pulling session on a day I climb", so the app says it, from the athlete's
 * own two windows and their own gap answer.
 *
 * Pure: given a week and the two windows it returns strings, and it invents no
 * number the athlete did not give.
 */

/** The gap the wall keeps when the athlete never answered (`house.sc.*`). */
export const DEFAULT_WALL_GAP_HOURS = 6;

export interface UpperPowerWindowInput {
  readonly wallWork: WallWork | null;
  readonly sessionWindow: SessionWindow | null;
  /** 0 Sunday to 6 Saturday, the day the session actually falls on. */
  readonly weekday: number;
  readonly sessionIntent: string | null | undefined;
}

/**
 * "Upper power on a climbing day: gym 08:00 to 10:00, wall 18:00 to 20:00,
 * kept 6 h apart."
 *
 * Null unless this really is the upper-power day, it really falls on a wall
 * day, and both windows are on file: without the two windows there is no fact
 * to state, only a rule, and the rules summary already states rules.
 */
export function upperPowerWindowLine(input: UpperPowerWindowInput): string | null {
  if (input.sessionIntent !== 'upper_power') return null;
  const wall = input.wallWork;
  if (wall === null || !wall.weekdays.includes(input.weekday as WallWork['weekdays'][number])) {
    return null;
  }
  if (wall.fingerLoad === 'light') return null;
  const gym = input.sessionWindow;
  if (gym === null) return null;
  const start = wall.typicalStart;
  const end = wall.typicalEnd;
  if (start === undefined || end === undefined) return null;
  const gap = wall.sameDayGapHours ?? DEFAULT_WALL_GAP_HOURS;
  return (
    `Upper power on a climbing day: gym ${gym.start} to ${gym.end}, ` +
    `wall ${start} to ${end}, kept ${formatInteger(gap)} h apart.`
  );
}

export interface ClimbingWeekLinesInput {
  readonly wallWork: WallWork | null;
  readonly sessionWindow: SessionWindow | null;
}

/** One session's weekday, from the plan's own field or from its date. */
function weekdayOfSession(session: SessionPlan): number {
  if (typeof session.weekday === 'number') return session.weekday;
  return new Date(`${session.date}T00:00:00Z`).getUTCDay();
}

/**
 * The week's climbing lines, each named by the day it belongs to, in the same
 * "Tue · ..." shape `weekDayLines` uses for the engine's own day sentences.
 */
export function climbingWeekLines(plan: WeekPlan, input: ClimbingWeekLinesInput): string[] {
  const lines: string[] = [];
  const ordered = [...plan.sessions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  for (const session of ordered) {
    const line = upperPowerWindowLine({
      wallWork: input.wallWork,
      sessionWindow: input.sessionWindow,
      weekday: weekdayOfSession(session),
      sessionIntent: session.sessionIntent,
    });
    if (line !== null) lines.push(`${weekdayShort(session.date)} · ${line}`);
  }
  return lines;
}
