import { kgToLb, roundHalfUp } from '@vert/engine';
import type { Athlete, LocalDate } from '@/data';
import { readSessionWindow } from '@/lib/engineAthlete';
import { climbingAnswersFrom } from '../setup/climbing';

/**
 * The pending, unsaved program parameters.
 *
 * A leaf of its own so the section and its sheet can both name the type
 * without importing one another. Every text field is kept exactly as typed,
 * so a refusal never clears what the athlete wrote.
 */

export const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export interface ProgramDraft {
  readonly weekdays: readonly number[];
  /**
   * When the athlete lifts, kept as typed. A climber's hard pulling day is
   * placed against it (`house.sc.sport_requirements`).
   */
  readonly gymStart: string;
  readonly gymEnd: string;
  readonly goalHeightMm: number | null;
  readonly targetDate: LocalDate | null;
  readonly inSeason: boolean;
  readonly bodyweightKg: number | null;
  /** What the athlete typed, kept verbatim so an error never clears a field. */
  readonly goalText: string;
  readonly targetText: string;
  readonly bodyweightText: string;
  /** The days spent on the wall (`house.sc.rnt_valgus_control`). */
  readonly wallWorkDays: readonly number[];
  readonly wallStart: string;
  readonly wallEnd: string;
  /** The owner's answer: a wall session IS a hard finger session. */
  readonly wallFingerHard: boolean;
  /** Hours gym finger work keeps from the wall on a shared day. */
  readonly wallGapHours: number;
  readonly valgusControl: boolean;
}

/** A fresh draft from the saved athlete. */
export function draftFrom(athlete: Athlete): ProgramDraft {
  const climbing = climbingAnswersFrom(athlete);
  const gym = readSessionWindow(athlete.sessionWindow ?? null);
  return {
    weekdays: athlete.weekdays,
    gymStart: gym?.start ?? '',
    gymEnd: gym?.end ?? '',
    goalHeightMm: athlete.goalHeightMm,
    targetDate: athlete.targetDate,
    inSeason: athlete.inSeason,
    bodyweightKg: athlete.bodyweightKg,
    goalText: athlete.goalHeightMm === null ? '' : `${roundHalfUp(athlete.goalHeightMm / 25.4, 1)}`,
    targetText: athlete.targetDate ?? '',
    bodyweightText:
      athlete.bodyweightKg === null ? '' : `${roundHalfUp(kgToLb(athlete.bodyweightKg), 0)}`,
    wallWorkDays: climbing.wallWorkDays,
    wallStart: climbing.wallStart,
    wallEnd: climbing.wallEnd,
    wallFingerHard: climbing.wallFingerHard,
    wallGapHours: climbing.wallGapHours,
    valgusControl: climbing.valgusControl,
  };
}

/** "18:00 to 20:00", or "not set" when the athlete named no window. */
export function wallWindowLabel(start: string, end: string): string {
  return start === '' || end === '' ? 'not set' : `${start} to ${end}`;
}
