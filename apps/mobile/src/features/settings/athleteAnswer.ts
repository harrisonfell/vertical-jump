import type { GripMode, Side } from '@vert/engine';

/**
 * One edited athlete answer, on its way to the regeneration confirm.
 *
 * It lives in its own file because both the section and its edit sheet name
 * the type, and the sheet is imported by the section: a shared leaf keeps the
 * two out of a cycle.
 */
export type AthleteAnswer =
  | { readonly field: 'sport'; readonly value: string }
  | { readonly field: 'secondaryGoal'; readonly value: string | null }
  | { readonly field: 'trainingAgeYears'; readonly value: number }
  | { readonly field: 'daysPerWeek'; readonly value: 2 | 3 | 4 | 5 }
  | { readonly field: 'fingerHistory'; readonly value: boolean }
  | { readonly field: 'gripMode'; readonly value: GripMode }
  | { readonly field: 'fingerPainCeiling'; readonly value: number }
  | { readonly field: 'weakerSide'; readonly value: Side | null };
