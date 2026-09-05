import type { SessionContacts, SetPrescription } from '@vert/engine';
import {
  TIMES,
  displayLoadLb,
  formatAddedLoadSet,
  formatInteger,
  kgToLb,
} from '@vert/engine/units';
import { formatCount, joinParts } from '@vert/engine/analytics';
import type { Landing, LocalDate, SessionStatus, SetLog, Timestamp } from '@/data/types';

/**
 * One session in the past or the future, as facts.
 *
 * The runner is Today's job. This screen reports: what was prescribed, what
 * was done, and where the two differ. Everything it says is derived from the
 * stored prescription and the stored logs, so a session read a month later
 * says exactly what it said the evening it was finished.
 */

/** Which of the five shapes this session takes. */
export type SessionView = 'today' | 'done' | 'not_finished' | 'missed' | 'future';

export function sessionView(
  scheduledDate: LocalDate,
  status: SessionStatus,
  today: LocalDate,
): SessionView {
  if (scheduledDate === today) return 'today';
  if (scheduledDate > today) return 'future';
  if (status === 'done') return 'done';
  if (status === 'not_finished') return 'not_finished';
  return 'missed';
}

export interface SetRowModel {
  readonly key: string;
  /** 1, 2, 3, or "R1" for a ramp set. */
  readonly index: number | string;
  /** The prescription as it was written: "5 × 205 lb", "30 s hold". */
  readonly prescription: string;
  /** The muted second line: "did 4", "was 5 × 235", "each side", "ramp". */
  readonly detail: string | null;
  readonly rpe: number | null;
  readonly landing: Landing | null;
  readonly logged: boolean;
  readonly setNumber: number;
  readonly reps: number | null;
  readonly durationS: number | null;
  readonly loadKg: number | null;
}

export interface CompareOptions {
  /** Unilateral rows carry "each side". */
  readonly bothSides?: boolean;
  /** RPE mode shows the effort the athlete logged, not the target. */
  readonly rpeMode?: boolean;
  /**
   * A weighted pull-up prescribes the ADDED load only, so what was actually
   * done reads "was 5 × BW + 35 lb" rather than "was 5 × 35 lb"
   * (house rule `house.sc.upper_power_day`).
   */
  readonly addedLoad?: boolean;
}

/** The word the engine's added-load formatter puts in place of a number. */
const BODYWEIGHT = 'BW';

/**
 * True when this row's prescription is written as bodyweight plus a load: a
 * weighted pull-up or its cluster variant. Read off the stored strings the
 * engine wrote rather than off the exercise tags, so a session read a month
 * later reports what it was prescribed as.
 */
export function usesAddedLoadDisplay(sets: readonly SetPrescription[]): boolean {
  return sets.some((set) => set.loadKg !== undefined && set.displayLoad.includes(BODYWEIGHT));
}

/** The load actually used, in pounds on the display grid. */
function loadLb(kg: number): number {
  return displayLoadLb(kg, 'barbell');
}

function differs(a: number | undefined, b: number | null): boolean {
  if (a === undefined || b === null) return false;
  return Math.abs(a - b) >= 0.25;
}

/** Prescription against what was logged, set for set. */
export function compareSets(
  prescriptions: readonly SetPrescription[],
  logs: readonly SetLog[],
  options: CompareOptions = {},
): SetRowModel[] {
  const byNumber = new Map<number, SetLog>();
  for (const log of logs) byNumber.set(log.setNumber, log);

  return prescriptions.map((set) => {
    const log = byNumber.get(set.setNumber) ?? null;
    const parts: string[] = [];

    if (set.isRamp) parts.push('ramp');
    if (options.bothSides === true) parts.push('each side');
    if (set.isHeld) parts.push('held');
    if (set.original !== undefined) parts.push(`was ${set.original.displayLoad}`);

    if (log === null) {
      parts.push('not logged');
    } else {
      if (set.reps !== undefined && log.repsDone !== null && log.repsDone !== set.reps) {
        parts.push(`did ${log.repsDone}`);
      }
      if (differs(set.loadKg, log.loadKg) && log.loadKg !== null) {
        const reps = log.repsDone ?? set.reps ?? 0;
        parts.push(
          options.addedLoad === true
            ? `was ${formatAddedLoadSet(reps, loadLb(log.loadKg))}`
            : `was ${reps} ${TIMES} ${loadLb(log.loadKg)}`,
        );
      }
      if (set.durationS !== undefined && log.durationS !== null && log.durationS !== set.durationS) {
        parts.push(`held ${log.durationS} s`);
      }
    }

    return {
      key: `set-${set.setNumber}`,
      index: set.isRamp ? `R${set.setNumber}` : set.setNumber,
      prescription: set.displayLoad,
      detail: parts.length === 0 ? null : parts.join(' · '),
      rpe: options.rpeMode === true ? (log?.rpe ?? null) : null,
      landing: log?.landing ?? null,
      logged: log !== null,
      setNumber: set.setNumber,
      reps: set.reps ?? null,
      durationS: set.durationS ?? null,
      loadKg: set.loadKg ?? null,
    };
  });
}

/** Total weight moved, in pounds, from the logs alone. */
export function tonnageLb(logs: readonly SetLog[]): number {
  let kg = 0;
  for (const log of logs) {
    if (log.loadKg === null || log.repsDone === null) continue;
    kg += log.loadKg * log.repsDone;
  }
  return kgToLb(kg);
}

/** Minutes between the first row tap and the finish mark. */
export function sessionMinutes(
  startedAt: Timestamp | null,
  markedCompleteAt: Timestamp | null,
): number | null {
  if (startedAt === null || markedCompleteAt === null) return null;
  const from = Date.parse(startedAt);
  const to = Date.parse(markedCompleteAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return Math.round((to - from) / 60000);
}

export interface DoneSummaryInput {
  readonly loggedSets: number;
  readonly prescribedSets: number;
  readonly minutes: number | null;
  readonly contacts: SessionContacts | null;
  readonly tonnageLb: number;
  readonly rpe: number | null;
}

/** "18 of 18 sets · 52 min · 60 contacts · 8,240 lb · RPE 7". */
export function doneSummaryLine(input: DoneSummaryInput): string {
  const contacts =
    input.contacts === null || input.contacts.extensive === 0
      ? null
      : `${formatInteger(input.contacts.extensive)} contacts`;
  return joinParts([
    `${input.loggedSets} of ${input.prescribedSets} sets`,
    input.minutes === null ? null : `${formatInteger(input.minutes)} min`,
    contacts,
    input.tonnageLb < 1 ? null : `${formatCount(input.tonnageLb)} lb`,
    input.rpe === null ? null : `RPE ${input.rpe}`,
  ]);
}

const LEGS: Readonly<Record<string, string>> = {
  fresh: 'legs fresh',
  normal: 'legs normal',
  heavy: 'legs heavy',
};

/** "Soreness 3/10 · legs normal", the two answers the Finish sheet asked for. */
export function feelLine(sorenessPre: number | null, legsFeel: string | null): string | null {
  const legs = legsFeel === null ? null : (LEGS[legsFeel] ?? null);
  const line = joinParts([
    sorenessPre === null ? null : `Soreness ${sorenessPre}/10`,
    legs,
  ]);
  return line === '' ? null : line;
}

/** "Not finished · 7 of 18 sets · counts as missed unless you finish it". */
export function notFinishedLine(loggedSets: number, prescribedSets: number): string {
  return `Not finished · ${loggedSets} of ${prescribedSets} sets · counts as missed unless you finish it`;
}

/** After the next week exists, finishing changes the ledger and nothing else. */
export function finishedAfterBuildLine(nextWeek: number): string {
  return `Finished after week ${nextWeek} was built · counts in the ledger, week ${nextWeek} unchanged`;
}

export interface FutureTargetsInput {
  readonly dayType: string;
  readonly mainLiftName: string | null;
  readonly workingSets: number | null;
  /** The week this session sits in. */
  readonly weekNumber: number;
  /** False while the week has not been generated: no loads exist yet. */
  readonly built: boolean;
  /**
   * True when this day carries weighted pull-ups, hangboard hangs or explosive
   * pulls. It is worth knowing three days out, because it is the day the 48 h
   * finger gap is measured from (house rule `house.sc.hard_finger_spacing`).
   */
  readonly hardFinger?: boolean;
}

/**
 * "Lower Strength · main lift: back squat · 3 working sets · loads set when
 * week 8 is built". Per-set loads are withheld even for a built future day:
 * soreness or a pain change re-materializes the session on the morning, and a
 * number read three days early would be a number that moved.
 */
export function futureTargetsLine(input: FutureTargetsInput): string {
  return joinParts([
    input.dayType,
    input.mainLiftName === null ? null : `main lift: ${input.mainLiftName}`,
    input.workingSets === null ? null : `${input.workingSets} working sets`,
    input.hardFinger === true ? 'hard finger work' : null,
    input.built ? 'loads shown on the day' : `loads set when week ${input.weekNumber} is built`,
  ]);
}

/**
 * The second line under one exercise's name on a past session: why it rotated
 * in, which side went first (`house.sc.weaker_side_first`), and what grip it
 * was prescribed in (`house.sc.open_hand_grip`). Null when the row carried
 * none of them.
 */
export function rowNoteLine(
  rotationNote: string | null,
  sideNote: string | null,
  fingerNote: string | null,
): string | null {
  const parts = [rotationNote, sideNote, fingerNote].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The finger answer the athlete gave before this session, as a fact rather
 * than as a judgement (house rule `house.sc.finger_pain_ceiling`). Null when
 * the question was never asked; a 0 is an answer and is shown.
 */
export function fingerPainLine(value: number | null): string | null {
  if (value === null) return null;
  return `Finger pain ${formatInteger(value)} out of 10`;
}

export interface MatchWindow {
  readonly fromIso: Timestamp;
  readonly toIso: Timestamp;
}

/**
 * The instants a candidate Whoop workout could start in. Whoop records on its
 * own clock, so the window is generous around the session rather than clipped
 * to the local day.
 */
export function matchWindow(
  date: LocalDate,
  startedAt: Timestamp | null,
  markedCompleteAt: Timestamp | null,
): MatchWindow {
  const hour = 3600000;
  const anchor = startedAt === null ? Date.parse(`${date}T00:00:00.000Z`) : Date.parse(startedAt);
  const end =
    markedCompleteAt === null ? anchor + 24 * hour : Date.parse(markedCompleteAt) + 6 * hour;
  return {
    fromIso: new Date(anchor - 6 * hour).toISOString(),
    toIso: new Date(end).toISOString(),
  };
}

export interface WorkoutEvidence {
  readonly sportName: string | null;
  readonly minutes: number | null;
  readonly strain: number | null;
  readonly averageHeartRate: number | null;
  readonly matchSource: 'auto' | 'manual' | null;
}

/** "Weightlifting · 52 min · strain 12.4 · avg HR 132 · matched automatically". */
export function workoutEvidenceLine(evidence: WorkoutEvidence): string {
  return joinParts([
    evidence.sportName,
    evidence.minutes === null ? null : `${formatInteger(evidence.minutes)} min`,
    evidence.strain === null ? null : `strain ${evidence.strain.toFixed(1)}`,
    evidence.averageHeartRate === null
      ? null
      : `avg HR ${formatInteger(evidence.averageHeartRate)}`,
    evidence.matchSource === null
      ? null
      : evidence.matchSource === 'auto'
        ? 'matched automatically'
        : 'matched by you',
  ]);
}

/** What a session with no matched workout says. */
export const AWAITING_WORKOUT = 'Whoop: awaiting workout (checks for 24 h)';
