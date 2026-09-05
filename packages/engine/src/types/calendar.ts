/**
 * Calendar primitives. The engine never touches `Date.now`: "today" is always
 * passed in, and a training week is the calendar week from day 0, the first
 * chosen weekday (brief 09 "Calendar and generation", the one declared
 * deviation from the rule book's floating 7-day window).
 */

/** An ISO local date, `YYYY-MM-DD`. No time, no zone: the athlete's own day. */
export type LocalDate = string;

/** 0 is Sunday through 6 is Saturday, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** An inclusive calendar window, `start` on day 0 and `end` on day 6. */
export interface DateWindow {
  start: LocalDate;
  end: LocalDate;
}

/** An ISO 8601 instant, `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export type IsoInstant = string;
