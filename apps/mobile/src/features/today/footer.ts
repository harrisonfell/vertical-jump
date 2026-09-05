import { MINUS, formatInteger, formatLoadLb, kgToLb } from '@vert/engine/units';
import type { SessionContactsView, TodayExercise, TodaySession } from './model';

/**
 * The two lines that close a session, and the counting behind them.
 *
 * Contacts are counted from what was logged, not from what was planned, so the
 * footer is a ledger rather than a promise. High-intensity contacts carry their
 * own hard cap and are named separately, because the cap is the safety rule.
 */

export interface ContactTally {
  readonly total: number;
  readonly highIntensity: number;
}

/**
 * Every landing counts (house convention). A depth jump is two contacts a rep;
 * anything the engine put off the budget carries zero.
 */
export function countContacts(
  exercises: readonly TodayExercise[],
  logs: ReadonlyMap<string, ReadonlyMap<number, number>>,
): ContactTally {
  let total = 0;
  let highIntensity = 0;

  for (const exercise of exercises) {
    if (exercise.contactsPerRep <= 0) continue;
    const byExercise = logs.get(exercise.id);
    if (byExercise === undefined) continue;

    for (const set of exercise.sets) {
      const reps = byExercise.get(set.setNumber);
      if (reps === undefined) continue;
      const contacts = reps * exercise.contactsPerRep;
      total += contacts;
      if (exercise.contactsPerRep >= 2 || exercise.block === 'power') highIntensity += contacts;
    }
  }

  return { total, highIntensity };
}

export interface FooterInput {
  readonly setsLogged: number;
  readonly setsPlanned: number;
  readonly contacts: SessionContactsView | null;
  readonly tally: ContactTally;
}

/**
 * "Sets 2 of 22 · contacts 0 of 6" on a strength day, and on a jump day it
 * grows the count the hard cap applies to: "· high-intensity 21 of 25".
 */
export function footerLeft({ setsLogged, setsPlanned, contacts, tally }: FooterInput): string {
  const parts = [`Sets ${formatInteger(setsLogged)} of ${formatInteger(setsPlanned)}`];

  if (contacts !== null && contacts.targetExtensive > 0 && contacts.extensive > 0) {
    parts.push(
      `contacts ${formatInteger(tally.total)} of ${formatInteger(contacts.targetExtensive)}`,
    );
  }
  if (contacts !== null && contacts.highIntensity > 0) {
    parts.push(
      `high-intensity ${formatInteger(tally.highIntensity)} of ${formatInteger(contacts.capHigh)}`,
    );
  }

  return parts.join(' · ');
}

export interface NextTestInput {
  /** Weekday of the next scheduled test, already short: "Sat". */
  readonly weekday: string | null;
  readonly inDays: number | null;
  readonly isToday: boolean;
  readonly done: boolean;
}

/** "Test Sat · in 5 days", "Test today", "Test logged". */
export function footerRight({ weekday, inDays, isToday, done }: NextTestInput): string | undefined {
  if (done) return 'Test logged';
  if (isToday) return 'Test today';
  if (weekday === null || inDays === null) return undefined;
  if (inDays <= 0) return `Test ${weekday}`;
  return `Test ${weekday} · in ${formatInteger(inDays)} ${inDays === 1 ? 'day' : 'days'}`;
}

/** "(+15 lb)" or "(−10 lb)". Empty when the next set carries the same load. */
export function loadDelta(fromKg: number | undefined, toKg: number | undefined): string {
  if (fromKg === undefined || toKg === undefined) return '';
  const delta = Math.round(kgToLb(toKg) - kgToLb(fromKg));
  if (delta === 0) return '';
  return delta > 0 ? ` (+${formatLoadLb(delta)})` : ` (${MINUS}${formatLoadLb(Math.abs(delta))})`;
}

/** A session's planned sets, so the footer's denominator is one number. */
export function plannedSets(session: TodaySession): number {
  return session.blocks.reduce(
    (total, block) => total + block.exercises.reduce((sum, e) => sum + e.sets.length, 0),
    0,
  );
}
