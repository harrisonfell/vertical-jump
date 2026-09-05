/**
 * Sport requirements, and the speed-climbing placement rules that key off
 * them. Additive: every sport that existed before speed climbing keeps
 * exactly the requirements it had, and an exercise without a `sports` tag is
 * selectable for all of them.
 *
 * House rules, all shipped in `ruleset.v1.json` and rendered in the Plan's
 * rules summary:
 *   `house.sc.sport_requirements`   one jump or reactive session and one
 *                                   upper-body power session a week, and no
 *                                   conditioning block: the wall is five to
 *                                   seven seconds of work, so R32's optional
 *                                   block is never added. Sprints run per the
 *                                   rule book (R102 to R104, R113).
 *   `house.sc.upper_power_day`      the Upper Strength day runs at
 *                                   `upper_power` for this sport.
 *   `house.sc.open_hand_grip`       a finger-pulley history leaves only
 *                                   open-hand pulling rows in the pool.
 *   `house.sc.hard_finger_spacing`  hard finger sessions sit 48 h apart, on
 *                                   the machinery R90 to R93 already use.
 *   `house.sc.finger_pain_ceiling`  a finger-pain answer above the ceiling
 *                                   takes the hard rows out for the day.
 *   `house.sc.rnt_valgus_control`   two knee-alignment rows a week, each at
 *                                   least six hours from wall work. Its
 *                                   placement lives in `rnt.ts`, which this
 *                                   module re-exports.
 *   `house.sc.calf_volume_low`      one calf day a week, at most two sets.
 */
import { diffDays } from '../calendar.js';
import type { Athlete } from '../types/athlete.js';
import type { LocalDate } from '../types/calendar.js';
import type { Exercise } from '../types/exercise.js';
import type { DayType, FingerLoad, SessionIntent, Sport } from '../types/core.js';
import type { SessionBlock, SessionPlan, SkeletonSession } from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';
import type { SprintClass } from './order.js';
import { sprintClassFor } from './order.js';
import { planRntSessions, wallFingerLine, wallFingerVerdict } from './rnt.js';

// The wall gap and the RNT placement live next door so both files stay
// under the line limit; every caller that reached them through this module
// still can.
export * from './rnt.js';

/** Sports whose week must carry a change-of-direction session (R137, R139). */
const COD_SPORTS = new Set<Sport>(['basketball', 'soccer']);

/** What one sport asks of every training week. */
export interface SportRequirements {
  sport: Sport;
  /** R137, R139: the week needs a change-of-direction session. */
  requiresCod: boolean;
  /** R138, R140: the sprint class the week must carry, or null for none. */
  sprintClass: SprintClass;
  /** House: jump or reactive sessions the week must carry. */
  jumpOrReactiveSessionsPerWeek: number;
  /** House: upper-body power sessions the week must carry. */
  upperPowerSessionsPerWeek: number;
  /**
   * House: false for speed climbing, whose demand is five to seven seconds of
   * phosphagen work, so a conditioning block is never added.
   */
  allowsConditioningBlock: boolean;
  /** House: what the Upper Strength day runs at for this sport. */
  upperDayIntent: SessionIntent;
  /** The house rule the Plan summary links this row to, when there is one. */
  houseRuleId?: string;
}

/**
 * The week-level requirements for one sport, read from the ruleset so no
 * magic number lives here. Every sport but `speed_climbing` gets exactly what
 * it had before: its change-of-direction flag, its sprint class, no jump or
 * upper-power quota, a conditioning block allowed, and a plain `strength`
 * upper day.
 */
export function sportRequirementsFor(sport: Sport, ruleset: Ruleset): SportRequirements {
  if (sport !== 'speed_climbing') {
    return {
      sport,
      requiresCod: COD_SPORTS.has(sport),
      sprintClass: sprintClassFor(sport),
      jumpOrReactiveSessionsPerWeek: 0,
      upperPowerSessionsPerWeek: 0,
      allowsConditioningBlock: true,
      upperDayIntent: 'strength',
    };
  }
  const climbing = ruleset.constants.climbing;
  return {
    sport,
    requiresCod: false,
    // R102 and R113: the wall is an acceleration event and the owner's second
    // goal is speed, so the week carries 10 to 30 m acceleration work. The
    // conditioning BLOCK is still never added (R32 is optional and these goals
    // do not ask for it), so the sprint lands in the Power block.
    sprintClass: sprintClassFor(sport),
    jumpOrReactiveSessionsPerWeek: climbing.jumpOrReactiveSessionsPerWeek,
    upperPowerSessionsPerWeek: climbing.upperPowerSessionsPerWeek,
    allowsConditioningBlock: false,
    upperDayIntent: 'upper_power',
    houseRuleId: 'house.sc.sport_requirements',
  };
}

/**
 * R19 read for the `sports` tag: an exercise with no tag is selectable for
 * every sport, and one with a tag only for the sports it names. This is what
 * keeps the basketball, football, soccer and track pools byte-identical to
 * what they were before speed climbing was seeded.
 */
export function sportAllows(exercise: Exercise, sport: Sport): boolean {
  return exercise.sports === undefined || exercise.sports.includes(sport);
}

/**
 * House `house.sc.hard_finger_spacing`: weighted pull-ups, hangboard hangs and
 * explosive pulls load the finger pulleys hard, so a session carrying any of
 * them is a hard finger session.
 */
export function isHardFingerExercise(exercise: Exercise): boolean {
  return exercise.fingerLoad === 'hard';
}

/**
 * House `house.sc.open_hand_grip`: true when this athlete's finger-pulley
 * history leaves only open-hand pulling rows in the pool.
 */
export function isOpenHandOnly(athlete: Athlete): boolean {
  return athlete.fingerHistory === true || athlete.gripMode === 'open_hand';
}

/**
 * House `house.sc.open_hand_grip`: which pulling rows this athlete may see.
 * A row that does not load the hands is untouched; a pulling row is kept only
 * when it is the open-hand variant, which is what "nothing you pull on is ever
 * prescribed in a full crimp" means once the seed carries an open-hand twin
 * for every pulling movement a climber needs.
 */
export function gripAllows(exercise: Exercise, athlete: Athlete): boolean {
  if (!exercise.isPulling) return true;
  if (!isOpenHandOnly(athlete)) return true;
  return exercise.gripMode === 'open_hand';
}

/**
 * The same-day gap this athlete keeps between gym finger work and the wall.
 * Their own answer first, then the ruleset's six hours, which is the same gap
 * the knee-alignment row keeps.
 */
export function sameDayGapHoursFor(athlete: Athlete, ruleset: Ruleset): number {
  return athlete.wallWork?.sameDayGapHours ?? ruleset.constants.climbing.rntWallGapHours;
}

/**
 * House `house.sc.calf_volume_low`: the rows that count as calf volume, read
 * as the rule's own words ("the heavy slow calf raise"), so the loaded calf
 * and Achilles work is what comes down. The single-leg calf isometric is
 * tendon protection under R78 and R99 and is not what the rule cuts, so the
 * jump day keeps it.
 */
export function isCalfVolume(exercise: Exercise): boolean {
  const target = exercise.tendonTarget;
  if (target !== 'calf' && target !== 'achilles') return false;
  return exercise.tendonMode === 'slow_resistance';
}

/** The hardest finger load among a session's chosen rows. */
export function sessionFingerLoad(
  blocks: readonly SessionBlock[],
  byId: ReadonlyMap<string, Exercise>,
): FingerLoad {
  let hardest: FingerLoad = 'none';
  for (const block of blocks) {
    for (const row of block.exercises) {
      const load = byId.get(row.exerciseId)?.fingerLoad;
      if (load === 'hard') return 'hard';
      if (load === 'light') hardest = 'light';
    }
  }
  return hardest;
}

/**
 * Hours between two sessions on different dates. The engine schedules dates,
 * not clock times, so both sessions are taken to start at the same assumed
 * hour: two sessions a calendar day apart are 24 h apart, two days apart are
 * 48 h apart.
 *
 * Start to start, on purpose, and not the window end to window start clock
 * `farFromWall` runs on. The wall gap asks how close two things are; the
 * finger gap asks how often the pulleys are loaded, which is a rate. The
 * shipped text of `house.sc.hard_finger_spacing` names this clock, so a
 * Tuesday and a Thursday read as the closest pair the engine will ever give.
 */
export function hoursBetweenSessions(a: LocalDate, b: LocalDate): number {
  return Math.abs(diffDays(a, b)) * 24;
}

/**
 * House `house.sc.hard_finger_spacing`: true when the session at `index` may
 * carry hard finger work, that is, when no other hard finger session inside
 * `sessions` sits closer than `hours` to it. Same machinery as the R90 to R93
 * maximal-CNS spacing, measured in hours rather than in calendar days because
 * the rule is stated in hours.
 *
 * The wall counts as one of those sessions (the owner's own reading): pass
 * `athlete` and a session on a wall day is legal only through the same-day
 * exception, and a session near one is not legal at all.
 *
 * @param sessions every session in date order, the one at `index` included.
 * @param index the session being placed.
 * @param hours the gap to keep, `constants.climbing.fingerSpacingHours`.
 * @param athlete read for `wallWork`; omitted, only the gym sessions count.
 * @param sameDayGapHours the same-day exception's gap, `sameDayGapHoursFor`.
 */
export function fingerSpacingOk(
  sessions: readonly SessionPlan[],
  index: number,
  hours: number,
  athlete?: Athlete,
  sameDayGapHours = 0,
): boolean {
  const session = sessions[index];
  if (session === undefined) return true;
  if (athlete !== undefined) {
    if (!wallFingerVerdict(session.date, athlete, hours, sameDayGapHours).ok) return false;
  }
  return sessions.every((other, at) => {
    if (at === index) return true;
    if (other.fingerLoad !== 'hard') return true;
    return hoursBetweenSessions(session.date, other.date) >= hours;
  });
}

/** Which of a week's sessions may carry hard finger work, and which may not. */
export interface HardFingerPlan {
  /** `dayIndex` values that keep their hard finger rows. */
  allowed: Set<number>;
  /** `dayIndex` values whose pull work is demoted to light finger work. */
  demoted: Set<number>;
  /**
   * The line a demoted session shows, by `dayIndex`, when it was the WALL that
   * took the hard rows: it names the climbing day, because that is the fact
   * the athlete needs ("climbing Tue evening"). A session demoted only by
   * another gym session has no entry here and keeps the plain line.
   */
  wallLines: Record<number, string>;
}

/**
 * House `house.sc.hard_finger_spacing` at the week level: walk the week in
 * date order and keep the hard finger rows on the first candidate session and
 * on every later one that is at least `hours` from the last kept. A session
 * closer than that is demoted, which means the hard rows leave its pool and
 * the light ones (rows, band pulls with straps, med-ball throws) stay.
 *
 * The wall is walked first and counts as a hard finger session of its own
 * (the owner's reading): a gym session on a wall day survives only through
 * the same-day gap, and a gym session near one is demoted with a line naming
 * the climbing day.
 *
 * Pure and independent of selection: candidacy is read off the seed's day
 * types, so every session of the week decides the same way no matter which
 * order they are materialized in.
 *
 * @param athlete read for `wallWork`; omitted, only the gym sessions count.
 * @param sameDayGapHours the same-day exception's gap, `sameDayGapHoursFor`.
 */
export function planHardFingerSessions(
  sessions: readonly SkeletonSession[],
  exercises: readonly Exercise[],
  sport: Sport,
  hours: number,
  athlete?: Athlete,
  sameDayGapHours = 0,
): HardFingerPlan {
  const hard = exercises.filter(
    (exercise) => isHardFingerExercise(exercise) && sportAllows(exercise, sport),
  );
  const allowed = new Set<number>();
  const demoted = new Set<number>();
  const wallLines: Record<number, string> = {};
  const ordered = [...sessions].sort((a, b) => diffDays(b.date, a.date));
  let last: LocalDate | undefined;
  for (const session of ordered) {
    const candidate = hard.some((exercise) => exercise.dayTypes.includes(session.dayType));
    if (!candidate) continue;
    // Rule 0 order: the wall is the hardest finger work in the week and the
    // athlete does not move it, so it is checked before the gym sessions are
    // spaced against each other.
    const wall =
      athlete === undefined
        ? { ok: true as const }
        : wallFingerVerdict(session.date, athlete, hours, sameDayGapHours);
    if (!wall.ok) {
      demoted.add(session.dayIndex);
      if (wall.blockedBy !== undefined) {
        wallLines[session.dayIndex] = wallFingerLine(wall.blockedBy, hours);
      }
      continue;
    }
    if (last !== undefined && hoursBetweenSessions(last, session.date) < hours) {
      demoted.add(session.dayIndex);
      continue;
    }
    allowed.add(session.dayIndex);
    last = session.date;
  }
  return { allowed, demoted, wallLines };
}


/**
 * The week-level house placements one speed-climbing session reads. All of it
 * is a pure function of the skeleton week, so every session of the week
 * decides the same way whatever order they are materialized in.
 */
export interface ClimbingPlacement {
  requirements: SportRequirements;
  /** False when the hard finger rows leave this session's pool. */
  allowHardFinger: boolean;
  /** True when the 48 h spacing is what took them out. */
  demotedFinger: boolean;
  /**
   * The line the demotion shows when a WALL session is what took the hard rows
   * out, naming the climbing day. Undefined when another gym session did it,
   * which keeps the plain 48 h wording.
   */
  fingerWallLine?: string;
  /** True when today's finger-pain answer is what took them out. */
  fingerPainOver: boolean;
  /** House `house.sc.calf_volume_low`: this is the week's calf day. */
  allowCalfVolume: boolean;
  /** House `house.sc.rnt_valgus_control`: this session carries the RNT row. */
  rnt: boolean;
  /** True when the week has a placement at all, so other sessions may not. */
  rntRequired: boolean;
  /** Placed anyway because no session in the week cleared the wall gap. */
  rntForced: boolean;
  /**
   * What a forced session says: the cue, and the explanation for any day the
   * row moved off. The explanation also reaches the week's own lines, so it is
   * still shown when the row moved successfully and nothing was forced.
   */
  rntLines: string[];
}

/** Day types whose template carries a main lift and a secondary lift. */
const STRENGTH_DAY_TYPES = new Set<DayType>([
  'full_body_strength',
  'lower_strength',
  'upper_strength',
]);

/**
 * House `house.sc.calf_volume_low`: which sessions of the week may carry calf
 * volume. The strength days come first, earliest first, which is the brief's
 * tendon line ("heavy slow calf raise Mon").
 */
export function calfDayIndexes(sessions: readonly SkeletonSession[], days: number): Set<number> {
  const ordered = [...sessions].sort((a, b) => diffDays(b.date, a.date));
  const strength = ordered.filter((session) => STRENGTH_DAY_TYPES.has(session.dayType));
  const pool = strength.length > 0 ? strength : ordered;
  return new Set(pool.slice(0, Math.max(0, days)).map((session) => session.dayIndex));
}

/** What one session may carry, once the week's house placements are made. */
export function climbingPlacementFor(
  athlete: Athlete,
  ruleset: Ruleset,
  sessions: readonly SkeletonSession[],
  session: SkeletonSession,
  exercises: readonly Exercise[],
  fingerPainToday?: number | null,
): ClimbingPlacement {
  const requirements = sportRequirementsFor(athlete.sport, ruleset);
  const base: ClimbingPlacement = {
    requirements,
    allowHardFinger: true,
    demotedFinger: false,
    fingerPainOver: false,
    allowCalfVolume: true,
    rnt: false,
    rntRequired: false,
    rntForced: false,
    rntLines: [],
  };
  if (athlete.sport !== 'speed_climbing') return base;
  const climbing = ruleset.constants.climbing;
  const finger = planHardFingerSessions(
    sessions,
    exercises,
    athlete.sport,
    climbing.fingerSpacingHours,
    athlete,
    sameDayGapHoursFor(athlete, ruleset),
  );
  const rntPlan = planRntSessions(sessions, athlete, ruleset);
  const ceiling = athlete.fingerPainCeiling ?? climbing.fingerPainCeiling;
  const fingerPainOver =
    fingerPainToday !== undefined && fingerPainToday !== null && fingerPainToday > ceiling;
  const demotedFinger = finger.demoted.has(session.dayIndex);
  const wallLine = finger.wallLines[session.dayIndex];
  return {
    requirements,
    allowHardFinger: !demotedFinger && !fingerPainOver,
    demotedFinger,
    ...(wallLine === undefined ? {} : { fingerWallLine: wallLine }),
    fingerPainOver,
    allowCalfVolume: calfDayIndexes(sessions, climbing.calfDaysPerWeek).has(session.dayIndex),
    rnt: rntPlan.dayIndexes.has(session.dayIndex),
    rntRequired: rntPlan.dayIndexes.size > 0,
    rntForced: rntPlan.forced.has(session.dayIndex),
    rntLines: rntPlan.lines,
  };
}
