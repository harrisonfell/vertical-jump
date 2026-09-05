/**
 * Forcing a setup state in development.
 *
 * Both clearance variants are real states of a real database, and getting to
 * one means answering the gate a particular way. For a screenshot pass, or to
 * read the copy side by side, `/clearance?state=self_screen` and
 * `/clearance?state=severe_pain&location=knee` render the variant directly.
 * Nothing is written and no decision is changed: only what is drawn.
 */
import { SELF_SCREEN_SENTENCE, severePainSentence } from '@vert/engine';
import type { ClearanceScreen, PainLocation } from '@vert/engine';

const LOCATIONS: readonly PainLocation[] = [
  'knee',
  'achilles_calf',
  'hamstring',
  'hip',
  'back',
  'shoulder',
  'shin',
  'finger',
  'other',
];

export type ForcedClearanceKind = 'self_screen' | 'severe_pain';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The variant a query string asks for, or null when it asks for nothing. */
export function forcedClearance(
  state: string | string[] | undefined,
  location: string | string[] | undefined,
): ClearanceScreen | null {
  const kind = first(state);
  if (kind === 'self_screen') {
    return { kind: 'self_screen', sentence: SELF_SCREEN_SENTENCE };
  }
  if (kind !== 'severe_pain') return null;
  const site = LOCATIONS.find((entry) => entry === first(location)) ?? 'knee';
  return { kind: 'severe_pain', location: site, sentence: severePainSentence(site) };
}
