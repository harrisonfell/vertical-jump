/**
 * The two plyometric budgets and the R89 trade between them.
 *
 * Extensive contacts sit inside the level range on the Power day (R82 to R84).
 * High-intensity contacts are capped at 25 per session at every level (R85)
 * and high-amplitude contacts at 20 across all high-amplitude drills together
 * (R52). Both are hard caps that no Block 5 rule may raise (safety override).
 *
 * House conventions (brief section 09 "Plyometrics: two budgets"): every
 * landing counts, so a depth jump is 2 contacts per rep, both high-intensity
 * and high-amplitude; test attempts are high-intensity but not high-amplitude;
 * each change-of-direction cut is one extensive contact; the warm-up carries
 * none; primer pogos count as extensive.
 */
import type { Exercise } from './types/exercise.js';
import type { ExerciseId } from './types/core.js';
import type { SessionBlock, SessionContacts } from './types/plan.js';

/**
 * The load half of the house definition of a maximal CNS session (brief
 * section 09): a heavy-strength top set at or above this percent. The contact
 * half lives beside it in `select/volume.ts`. Named here so a rule that has to
 * keep a day off the maximal-CNS list can hold its top set one step below it
 * rather than hard-coding 85 in three places.
 */
export const MAXIMAL_CNS_TOP_SET_PCT = 85;

/** R85 and R52 as literals, so a caller cannot pass a raised cap. */
export const CONTACT_CAPS = {
  /** R85: total high-intensity contacts per session, every level. */
  highIntensityPerSession: 25 as const,
  /** R52: total high-amplitude contacts per session, all drills together. */
  highAmplitudePerSession: 20 as const,
  /** House: every landing counts. */
  depthJumpContactsPerRep: 2 as const,
  /** The binding cap that follows once 5 test attempts are counted. */
  depthJumpRepCap: 10 as const,
} as const;

/** R85: total high-intensity contacts per session, every level. */
export const HIGH_INTENSITY_MAX = CONTACT_CAPS.highIntensityPerSession;

/** R52: total high-amplitude contacts per session, all drills together. */
export const HIGH_AMPLITUDE_MAX = CONTACT_CAPS.highAmplitudePerSession;

/** The binding depth-jump cap once the test has spent its 5 contacts. */
export const DEPTH_JUMP_REPS_MAX = CONTACT_CAPS.depthJumpRepCap;

/** Clamp a value into an inclusive range. */
export function clamp(value: number, low: number, high: number): number {
  if (high < low) throw new RangeError('high is below low');
  return Math.min(high, Math.max(low, value));
}

/**
 * R89 as the brief reads it (the factor is house):
 * E = clamp(bottom + 10k - 2H, bottom, top), with H the planned
 * high-intensity contacts and k the progressed-week counter.
 *
 * `stepPerWeek` and `highIntensityFactor` come from the ruleset so the Plan
 * summary and the generator share one number.
 */
export function computeExtensiveTarget(
  bottom: number,
  top: number,
  k: number,
  H: number,
  stepPerWeek = 10,
  highIntensityFactor = 2,
): number {
  const raw = bottom + stepPerWeek * k - highIntensityFactor * H;
  return Math.round(clamp(raw, bottom, top));
}

/** Reps of a plyometric drill, summed across its prescribed sets. */
function repsOf(sets: { reps?: number }[]): number {
  let total = 0;
  for (const set of sets) total += set.reps ?? 0;
  return total;
}

/**
 * Count a session's contacts from its materialized blocks. Pure: it reads the
 * prescriptions and the exercise tags and nothing else. The warm-up and
 * cool-down blocks carry no contacts by convention.
 */
export function countContacts(
  blocks: SessionBlock[],
  byId: ReadonlyMap<ExerciseId, Exercise>,
  targetExtensive: number,
): SessionContacts {
  let extensive = 0;
  let highIntensity = 0;
  let highAmplitude = 0;

  for (const block of blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down') continue;
    for (const row of block.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise === undefined) continue;
      const reps = repsOf(row.sets);
      const cuts = exercise.codCutsPerRep ?? 0;
      if (cuts > 0) extensive += reps * cuts;
      const plyo = exercise.plyometric;
      if (plyo === undefined) continue;
      const contacts = reps * plyo.contactsPerRep;
      if (plyo.category === 'extensive') extensive += contacts;
      if (plyo.intensity === 'high') highIntensity += contacts;
      if (plyo.amplitude === 'high') highAmplitude += contacts;
    }
  }

  return {
    extensive,
    highIntensity,
    highAmplitude,
    targetExtensive,
    capHigh: CONTACT_CAPS.highIntensityPerSession,
    capAmplitude: CONTACT_CAPS.highAmplitudePerSession,
  };
}

/** True when a session is inside both hard caps. Never a warning, a refusal. */
export function withinHardCaps(contacts: SessionContacts): boolean {
  return (
    contacts.highIntensity <= CONTACT_CAPS.highIntensityPerSession &&
    contacts.highAmplitude <= CONTACT_CAPS.highAmplitudePerSession
  );
}

/**
 * The most depth-jump reps a session may carry, given the high-intensity
 * contacts already spent (the test's 5 attempts, typically). Never negative.
 */
export function depthJumpRepBudget(
  highIntensityAlreadySpent: number,
  sessionCap: number = CONTACT_CAPS.highIntensityPerSession,
): number {
  const cap = Math.min(CONTACT_CAPS.highIntensityPerSession, sessionCap);
  const remaining = cap - highIntensityAlreadySpent;
  return Math.max(0, Math.min(CONTACT_CAPS.depthJumpRepCap, Math.floor(remaining / CONTACT_CAPS.depthJumpContactsPerRep)));
}

/**
 * The step-off height a bodyweight allows: at most 24 in, at most 18 in over
 * 220 lb or when bodyweight is unknown (house safety, brief section 09).
 */
export function dropHeightCapIn(
  bodyweightLb: number | null,
  maxIn = 24,
  heavyMaxIn = 18,
  heavyBodyweightLb = 220,
): number {
  if (bodyweightLb === null || bodyweightLb > heavyBodyweightLb) return heavyMaxIn;
  return maxIn;
}
