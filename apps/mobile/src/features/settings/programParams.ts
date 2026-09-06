/**
 * The program parameters, before and after an unsaved edit.
 *
 * A leaf of its own so the screen stays a screen: these two are the whole
 * input to `diffParams`, which is what the regeneration confirm lists, and
 * they read the same climbing answers the setup block wrote.
 */
import type { Athlete } from '@/data';
import { readSessionWindow } from '@/lib/engineAthlete';
import { SPORT_OPTIONS, climbingAnswersFrom, clockWindowLabel, type SportValue } from '../setup';
import { wallWindowLabel, type ProgramDraft } from './programDraft';
import type { ProgramParams } from './regenerate';

/** The stored sport, narrowed. It decides which lifts a best set is offered for. */
export function sportOf(sport: string | null): SportValue {
  return SPORT_OPTIONS.find((option) => option.value === sport)?.value ?? 'basketball';
}

/** The parameters as the unsaved draft and the pending answers would leave them. */
export function paramsOf(athlete: Athlete, draft: ProgramDraft, answers: Partial<Athlete>): ProgramParams {
  const climbing = climbingAnswersFrom({ ...athlete, ...answers });
  return {
    trainingAgeYears: answers.trainingAgeYears ?? athlete.trainingAgeYears,
    sport: answers.sport ?? athlete.sport,
    secondaryGoal: climbing.secondaryGoal,
    daysPerWeek: answers.daysPerWeek ?? athlete.daysPerWeek,
    weekdays: draft.weekdays,
    gymWindow: clockWindowLabel(draft.gymStart, draft.gymEnd),
    goalHeightMm: draft.goalHeightMm,
    targetDate: draft.targetDate,
    inSeason: draft.inSeason,
    bodyweightKg: draft.bodyweightKg,
    fingerHistory: climbing.fingerHistory,
    gripMode: climbing.gripMode,
    fingerPainCeiling: climbing.fingerPainCeiling,
    weakerSide: climbing.weakerSide === 'unsure' ? null : climbing.weakerSide,
    wallWorkDays: draft.wallWorkDays,
    wallWindow: wallWindowLabel(draft.wallStart, draft.wallEnd),
    wallFingerHard: draft.wallFingerHard,
    wallGapHours: draft.wallGapHours,
    valgusControl: draft.valgusControl,
  };
}

/** The parameters as they are on file right now. */
export function savedParams(athlete: Athlete): ProgramParams {
  const climbing = climbingAnswersFrom(athlete);
  const gym = readSessionWindow(athlete.sessionWindow ?? null);
  return {
    trainingAgeYears: athlete.trainingAgeYears,
    sport: athlete.sport,
    secondaryGoal: climbing.secondaryGoal,
    daysPerWeek: athlete.daysPerWeek,
    weekdays: athlete.weekdays,
    gymWindow: clockWindowLabel(gym?.start ?? '', gym?.end ?? ''),
    goalHeightMm: athlete.goalHeightMm,
    targetDate: athlete.targetDate,
    inSeason: athlete.inSeason,
    bodyweightKg: athlete.bodyweightKg,
    fingerHistory: climbing.fingerHistory,
    gripMode: climbing.gripMode,
    fingerPainCeiling: climbing.fingerPainCeiling,
    weakerSide: climbing.weakerSide === 'unsure' ? null : climbing.weakerSide,
    wallWorkDays: climbing.wallWorkDays,
    wallWindow: wallWindowLabel(climbing.wallStart, climbing.wallEnd),
    wallFingerHard: climbing.wallFingerHard,
    wallGapHours: climbing.wallGapHours,
    valgusControl: climbing.valgusControl,
  };
}

