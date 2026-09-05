/**
 * The house rules `materializeWeek` has to run itself, because they need the
 * week rather than one session: the readiness gate for today, and the list of
 * `houseRules` entries this athlete's week actually applied.
 *
 * Everything here is additive. An athlete with no readiness input and no
 * climbing settings gets `undefined` from every function, so no other sport's
 * week changes by a byte.
 */
import { findHouseRule } from '../ruleset/index.js';
import { scoreReadiness } from '../readiness/index.js';
import { isOpenHandOnly } from '../select/sport.js';
import { stepLbFor } from '../prescribe/display.js';
import * as copy from './copy.js';
import type { Athlete } from '../types/athlete.js';
import type { ExerciseId } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { MaterializeContext, WeekPlan } from '../types/plan.js';
import type {
  ReadinessOutcome,
  ReadinessTestConfig,
  ReadinessTodayInput,
} from '../types/readiness.js';
import type { Ruleset } from '../types/ruleset.js';

/**
 * The configuration the gate scores against: the caller's, then the
 * athlete's, then the ruleset default. The test is a setting, never a
 * constant in code (house `house.sc.readiness_gate`).
 */
export function resolveReadinessConfig(
  athlete: Athlete,
  ruleset: Ruleset,
  input: ReadinessTodayInput | undefined,
): ReadinessTestConfig {
  return input?.config ?? athlete.readinessConfig ?? ruleset.constants.climbing.readiness;
}

/**
 * Today's gate result, or `undefined` when the athlete gave the gate nothing
 * to read. Pure: it depends on the two channels alone, so it can be scored
 * before the session is built, which is what `holdVolume` needs.
 */
export function scoreReadinessToday(context: MaterializeContext): ReadinessOutcome | undefined {
  const input = context.history.readinessToday;
  if (input === undefined) return undefined;
  const config = resolveReadinessConfig(context.athlete, context.ruleset, input);
  return scoreReadiness(
    config,
    input.whoop ?? null,
    input.test ?? null,
    input.history ?? [],
    context.ruleset,
  );
}

/**
 * The header suffix a gated session carries, or `undefined` when the gate
 * changed nothing. Two words for two different actions, so the header never
 * says "one tier down" about a day that only held its volume.
 */
export function readinessSuffixFor(outcome: ReadinessOutcome): string | undefined {
  if (outcome.adjustment.tierDown) return copy.SUFFIX.readinessTierDown;
  if (outcome.adjustment.holdVolume) return copy.SUFFIX.readinessHeld;
  return undefined;
}

/** The smallest load step this athlete can actually put on a bar (R162). */
export function readinessStepLb(athlete: Athlete): number {
  return stepLbFor(athlete, 'barbell');
}

/**
 * The `houseRules` ids this week applied, in ruleset order, so the Plan's
 * rules summary can mark which entries are live rather than listing all of
 * them as equally relevant. Read off the built week, never guessed: a rule
 * that changed nothing this week is not in the list.
 *
 * @returns the ids, or an empty array for an athlete no house rule touched.
 */
export function houseRuleIdsFor(
  week: WeekPlan,
  context: MaterializeContext,
  byId: ReadonlyMap<ExerciseId, Exercise>,
): string[] {
  const { athlete, ruleset } = context;
  const found = new Set<string>();
  const add = (id: string): void => {
    if (findHouseRule(ruleset, id) !== undefined) found.add(id);
  };
  const rows = week.sessions.flatMap((session) =>
    session.blocks.flatMap((block) => block.exercises),
  );

  if (athlete.sport === 'speed_climbing') {
    add('house.sc.sport_requirements');
    add('house.sc.sequence_strength_rfd_reactive');
    if (week.sessions.some((session) => session.sessionIntent === 'upper_power')) {
      add('house.sc.upper_power_day');
    }
    if (rows.some((row) => row.exerciseId === 'box_squat' && row.role === 'main_lift')) {
      add('house.sc.box_squat_main_lift');
    }
    if (rows.some((row) => byId.get(row.exerciseId)?.tendonTarget === 'calf')) {
      add('house.sc.calf_volume_low');
    }
  }
  // The finger rules all hang off the pulley history, not off the presence of
  // a pull-up: an athlete with healthy fingers pulls on whatever they like.
  if (isOpenHandOnly(athlete)) {
    if (rows.some((row) => byId.get(row.exerciseId)?.isPulling === true)) {
      add('house.sc.open_hand_grip');
    }
    if (week.sessions.some((session) => session.fingerLoad === 'hard')) {
      add('house.sc.hard_finger_spacing');
    }
    if (athlete.fingerPainCeiling !== undefined) add('house.sc.finger_pain_ceiling');
  }
  // Read off the built week like every entry above: with no band in the
  // inventory the seed has no knee-alignment row to place, so the week applied
  // nothing and the Plan's summary may not claim it did.
  if (
    athlete.valgusControl?.required === true &&
    week.sessions.some((session) => session.rntScheduled)
  ) {
    add('house.sc.rnt_valgus_control');
  }
  if (rows.some((row) => row.sideNote !== undefined)) add('house.sc.weaker_side_first');
  if (
    athlete.readinessConfig !== undefined ||
    week.sessions.some((session) => session.readiness !== undefined)
  ) {
    add('house.sc.readiness_gate');
  }
  if (athlete.weakerSide === 'left' || athlete.weakerSide === 'right') {
    add('house.sc.asymmetry_tracking');
  }

  return ruleset.houseRules.filter((rule) => found.has(rule.id)).map((rule) => rule.id);
}
