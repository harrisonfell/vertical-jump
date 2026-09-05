import { weekdayLabelOf, weekdayOf } from '@vert/engine';
import { formatShortDate } from '@vert/engine/analytics';
import type { LocalDate } from '@/data/types';

/**
 * Calendar labels. The engine owns every training number; a calendar date is
 * not one, so the two pieces it does ship are composed here rather than
 * rebuilt: `weekdayLabelOf` for "Mon" and `formatShortDate` for "8 Sep".
 */

/** "Mon" for a local date. */
export function weekdayShort(date: LocalDate): string {
  return weekdayLabelOf(date, weekdayOf(date));
}

/** "Mon 8 Sep", the way the Plan header and the week rows write a day. */
export function formatDayDate(date: LocalDate): string {
  return `${weekdayShort(date)} ${formatShortDate(date)}`;
}

/** "8 Sep", for a column head that already carries its weekday. */
export function formatDayMonth(date: LocalDate): string {
  return formatShortDate(date);
}
