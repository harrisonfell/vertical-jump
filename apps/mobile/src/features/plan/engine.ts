import type {
  DayType as EngineDayType,
  PlanSkeleton,
  SessionIntent,
  SessionPlan,
  SessionRecord,
  SetPrescription,
  WeekPlan,
} from '@vert/engine';
import type { DayType, Json, SessionWithStatus } from '@/data/types';

/**
 * The seam between the store's JSON columns and the engine's own types.
 *
 * `program.snapshot` holds a `PlanSkeleton`, `week.snapshot` a `WeekPlan`, and
 * `session.snapshot` a `SessionPlan`, written verbatim by the generator. They
 * come back out of SQLite as `unknown`, so every read is checked on the few
 * fields the screens actually navigate before it is handed on. A snapshot from
 * an older ruleset that fails the check renders as absent rather than as a
 * crash: the Plan still draws its calendar from the rows.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** The engine's `PlanSkeleton`, or null when the column cannot be one. */
export function readSkeleton(snapshot: Json): PlanSkeleton | null {
  if (!isRecord(snapshot)) return null;
  if (typeof snapshot['W'] !== 'number') return null;
  if (!isDate(snapshot['programStart']) || !isDate(snapshot['targetDate'])) return null;
  if (!Array.isArray(snapshot['weeks']) || !Array.isArray(snapshot['blocks'])) return null;
  if (!Array.isArray(snapshot['weekdays'])) return null;
  return snapshot as unknown as PlanSkeleton;
}

/** The engine's `WeekPlan`, or null when the column cannot be one. */
export function readWeekPlan(snapshot: Json): WeekPlan | null {
  if (!isRecord(snapshot)) return null;
  if (typeof snapshot['w'] !== 'number') return null;
  if (!isDate(snapshot['windowStart']) || !isDate(snapshot['windowEnd'])) return null;
  if (!Array.isArray(snapshot['sessions'])) return null;
  return snapshot as unknown as WeekPlan;
}

/** The engine's `SessionPlan`, or null when the column cannot be one. */
export function readSessionPlan(snapshot: Json): SessionPlan | null {
  if (!isRecord(snapshot)) return null;
  if (typeof snapshot['id'] !== 'string' || !isDate(snapshot['date'])) return null;
  if (!Array.isArray(snapshot['blocks'])) return null;
  return snapshot as unknown as SessionPlan;
}

/** The `SetPrescription[]` a `session_exercise` row stores, or an empty list. */
export function readPrescriptions(perSet: Json): SetPrescription[] {
  if (!Array.isArray(perSet)) return [];
  return perSet.filter((entry): entry is SetPrescription => {
    if (!isRecord(entry)) return false;
    return typeof entry['setNumber'] === 'number' && typeof entry['displayLoad'] === 'string';
  });
}

/** Display day type back to the engine's own key. */
const ENGINE_DAY_TYPES: Readonly<Record<DayType, EngineDayType>> = {
  'Full Body Strength': 'full_body_strength',
  'Lower Strength': 'lower_strength',
  'Upper Strength': 'upper_strength',
  'Upper + Mobility': 'upper_mobility',
  'Power + Speed': 'power_speed',
  Power: 'power',
  Speed: 'speed',
  'Recovery - Mobility': 'recovery_mobility',
};

/** The engine key for a stored day type. */
export function toEngineDayType(dayType: DayType): EngineDayType {
  return ENGINE_DAY_TYPES[dayType];
}

/** The words brief section 13 uses, keyed by the engine's own day type. */
const DISPLAY_DAY_TYPES: Readonly<Record<EngineDayType, DayType>> = {
  full_body_strength: 'Full Body Strength',
  lower_strength: 'Lower Strength',
  upper_strength: 'Upper Strength',
  upper_mobility: 'Upper + Mobility',
  power_speed: 'Power + Speed',
  power: 'Power',
  speed: 'Speed',
  recovery_mobility: 'Recovery - Mobility',
};

/** The display day type for an engine key, for skeleton sessions. */
export function fromEngineDayType(dayType: EngineDayType): DayType {
  return DISPLAY_DAY_TYPES[dayType];
}

/**
 * What the Upper Strength day is called when the sport runs it as a power day
 * (house rule `house.sc.upper_power_day`).
 *
 * The stored day type stays `Upper Strength`, because that is the rule book's
 * template and the whole adherence and spacing machinery keys off it. Only the
 * word the athlete reads changes: on a speed climber's Tuesday the main lift
 * is a weighted pull-up held one step under the heavy mark, with throws and
 * explosive pulls around it, and calling that "Upper Strength" would be a lie
 * about what the day is for.
 */
export const UPPER_POWER_LABEL = 'Upper power';

/** The full words for one day, once the session's own intent is known. */
export function dayTypeLabel(dayType: DayType, upperPower = false): string {
  return upperPower && dayType === 'Upper Strength' ? UPPER_POWER_LABEL : dayType;
}

/**
 * The session's intent as the generator wrote it into the snapshot, or null
 * for a session that has no snapshot yet or that carries no intent beyond its
 * day type.
 */
export function readSessionIntent(snapshot: Json): SessionIntent | null {
  const plan = readSessionPlan(snapshot);
  const intent = plan?.sessionIntent;
  return intent === 'strength' ||
    intent === 'upper_power' ||
    intent === 'power' ||
    intent === 'speed' ||
    intent === 'recovery'
    ? intent
    : null;
}

/**
 * A stored session as the engine's adherence reads it. Status is derived from
 * logs by the store, never stamped, so this carries it straight across.
 */
export function toSessionRecord(session: SessionWithStatus): SessionRecord {
  return {
    sessionId: session.id,
    date: session.scheduledDate,
    dayType: toEngineDayType(session.dayType),
    status: session.status,
    ...(session.markedCompleteAt === null ? null : { markedCompleteAt: session.markedCompleteAt }),
    ...(session.sorenessPre === null ? null : { sorenessPre: session.sorenessPre }),
    ...(session.rpe === null ? null : { rpe: session.rpe }),
    ...(session.legsFeel === 'fresh' || session.legsFeel === 'normal' || session.legsFeel === 'heavy'
      ? { legsFeel: session.legsFeel }
      : null),
  };
}
