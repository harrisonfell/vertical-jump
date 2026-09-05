/**
 * Every string the materializer puts on a week or a session, built from real
 * numbers. Copy comes from brief section 05 "States" and section 13 "Key
 * copy"; no rule numbers appear in a runner string (section 13).
 */
import type { LocalDate } from '../types/calendar.js';
import type { WorkingMax } from '../types/athlete.js';
import type { StressedJoint } from '../types/core.js';
import { MINUS, formatLoadLb, kgToLb } from '../units.js';

/** Header suffixes, in the order brief section 05 lists them. */
export const SUFFIX = {
  testDay: '· Test day',
  deload: '· Deload',
  taper: '· Taper',
  peak: '· Peak',
  inSeason: '· In-season',
  week1: '· Week 1 (RPE 6-7)',
  restricted: '· Restricted',
  /** House `house.sc.readiness_gate`: power and maximal work drop one tier. */
  readinessTierDown: '· Readiness: one tier down',
  /** House `house.sc.readiness_gate`: today's volume raise is not taken. */
  readinessHeld: '· Readiness: volume held',
} as const;

/** "· Repeat of week 3". */
export function repeatSuffix(weekNumber: number): string {
  return `· Repeat of week ${weekNumber}`;
}

/** "Deload week (5 of 12). Sets and contacts cut by half. Loads held. Planned." */
export function deloadNotice(w: number, W: number): string {
  return `Deload week (${w} of ${W}). Sets and contacts cut by half. Loads held. Planned.`;
}

/** "Taper week (11 of 12). Volume halved, loads held, box heights held. No depth jumps this week." */
export function taperNotice(w: number, W: number): string {
  return `Taper week (${w} of ${W}). Volume halved, loads held, box heights held. No depth jumps this week.`;
}

/** "Soreness 8/10. Today one tier down: reps up, loads −10%, no depth jumps." */
export function sorenessNotice(value: number, percentDrop: number): string {
  return `Soreness ${value}/10. Today one tier down: reps up, loads ${MINUS}${percentDrop}%, no depth jumps.`;
}

/** "Test moved to Sat (soreness)." */
export function testDeferredNotice(weekdayLabel: string): string {
  return `Test moved to ${weekdayLabel} (soreness).`;
}

/** "Power block begins (week 6). Main lift down to 3 sets, jumps up. Back squat stays." */
export function blockTransitionNotice(w: number, mainLiftName: string, sets: number): string {
  return `Power block begins (week ${w}). Main lift down to ${sets} sets, jumps up. ${mainLiftName} stays.`;
}

/** "Trimmed to 8 exercises: dropped lateral lunge". */
export function trimmedNotice(max: number, names: readonly string[]): string {
  return `Trimmed to ${max} exercises: dropped ${names.join(', ')}`;
}

/**
 * "Loads now prescribed. Working max from week 1: trap-bar deadlift 275 lb
 * (265 × 3) · DB bench 70 lb (60 × 8). Top sets capped at 80% this week."
 */
export function workingMaxEstablishedNotice(
  entries: readonly { name: string; workingMax: WorkingMax }[],
  guardPct: number,
): string {
  const parts = entries.map(
    (entry) => `${entry.name} ${formatLoadLb(kgToLb(entry.workingMax.valueKg))}`,
  );
  return `Loads now prescribed. Working max from week 1: ${parts.join(' · ')}. Top sets capped at ${guardPct}% this week.`;
}

/** "Tendon work: heavy slow calf raise Mon, calf iso Sat (+1 set: depth-jump week)." */
export function tendonLine(
  entries: readonly { name: string; weekdayLabel: string; extraSet: boolean }[],
): string {
  const parts = entries.map(
    (entry) =>
      `${entry.name.toLowerCase()} ${entry.weekdayLabel}${entry.extraSet ? ' (+1 set: depth-jump week)' : ''}`,
  );
  return `Tendon work: ${parts.join(', ')}.`;
}

const JOINT_WORD: Record<StressedJoint, string> = {
  knee: 'Knee',
  spine: 'Spine',
  shoulder: 'Shoulder',
};

/** "Knee load reduced this week: 4 high-stress exercises last week, so 2 this week." */
export function jointReductionLine(joint: StressedJoint, lastWeek: number, thisWeek: number): string {
  return `${JOINT_WORD[joint]} load reduced this week: ${lastWeek} high-stress exercises last week, so ${thisWeek} this week.`;
}

/** "In-season: jump contacts halved, change of direction covered by games." */
export const IN_SEASON_LINE =
  'In-season: jump contacts halved, change of direction covered by games.';

/** The R100 runway line, named by the mode this week runs. */
export function tendonRunwayLine(mode: 'isometric' | 'slow_resistance' | 'plyometric'): string {
  if (mode === 'isometric') return 'Tendon runway: isometric holds first while the tendons adapt.';
  if (mode === 'slow_resistance') {
    return 'Tendon runway: slow heavy resistance now, plyometrics from the next block.';
  }
  return 'Tendon runway complete: plyometric emphasis from here.';
}

/** Week 1 of a first program (R76, R92). */
export const WEEK1_LINE =
  'Week 1 has one maximal effort session: the test day. The strength top set is held at 80%.';

/** "Basketball: the jump session and the change-of-direction block both run this week." */
export const BASKETBALL_LINE =
  'Basketball: the jump session and the change-of-direction block both run this week.';

/** "New this week · replaces Nordic curl (3 weeks)". */
export function rotationLine(replacedName: string, weeks: number): string {
  return `New this week · replaces ${replacedName} (${weeks} weeks)`;
}

/** "Accessories rotated this week: lateral lunge replaces Nordic curl." */
export function accessoryRotationLine(entries: readonly string[]): string {
  return `Accessories rotated this week: ${entries.join(', ')}.`;
}

/** "Restricted plan: no jumps or knee-stress lifts while knee pain is 5+." */
export function restrictedLine(sentence: string): string {
  return sentence;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Mon" for a local date, for the tendon and peak lines. */
export function weekdayLabelOf(date: LocalDate, weekday: number): string {
  void date;
  return WEEKDAY_SHORT[weekday] ?? '';
}
