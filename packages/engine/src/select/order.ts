/**
 * Block 2: what blocks a session has, in what order, and which role fills each
 * slot (R29 to R44 and the Required Blocks table).
 *
 * Warm-up first (2 to 4 mobility and activation movements), Primer, the
 * primary block by day type, then secondary strength, accessory, injury
 * prevention or core; conditioning after strength or power; cool-down last, or
 * cool-down then recovery. High-CNS and high-skill work goes early (R42, R43).
 *
 * Declared reading of the 8-exercise cap: a grouped block renders as one row,
 * so it counts once. The warm-up and cool-down groups are excluded outright,
 * which is what the implementation checklist says. This reproduces the brief's
 * worked Power + Speed day at exactly 8 displayed rows.
 */
import type { DayType, ExerciseRole, SessionBlockName, Sport } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SessionBlock } from '../types/plan.js';

/** One slot in a day-type template. */
export interface RoleSlot {
  block: SessionBlockName;
  role: ExerciseRole;
  /** How many rows to fill when the pool allows it. */
  count: number;
  /** Below this the session records an unmet requirement. */
  min: number;
  /** Grouped blocks render as one row (warm-up, cool-down, the test primer). */
  grouped: boolean;
  /** Trim order: the lowest precedence goes first (implementation checklist). */
  precedence: number;
  /** An extra condition the candidate must meet (R102, R103 sprint classes). */
  filter?: (exercise: Exercise) => boolean;
  /**
   * A preferred slot (`min` 0) the session records as trimmed, against the row
   * it would have taken, when the budgets leave it empty.
   */
  dropReason?: string;
}

/** Everything the template needs to branch. */
export interface TemplateOptions {
  isTestDay: boolean;
  /** R137: basketball needs a change-of-direction session in the week. */
  includeCod: boolean;
  /** The Speed day is extensive-only because it follows Power (brief 09). */
  extensiveOnly: boolean;
  /**
   * R138 and R140: football needs one acceleration session in the week, track
   * and field one max-velocity session. R102 and R103 classify by distance.
   */
  sprintClass: SprintClass;
  /** Deload, taper and peak weeks drop the optional blocks first. */
  reducedWeek: boolean;
  /** House `house.peak_policy`: the peak session is main lift plus jumps only. */
  peakSession: boolean;
  /**
   * House `house.sc.upper_power_day`: the Upper Strength day runs as an
   * upper-body power and strength day, a weighted pull-up main lift with
   * explosive pulls and throws around it rather than the fixed hypertrophy
   * loads R135 gives it.
   */
  upperPower?: boolean;
  /**
   * House `house.sc.rnt_valgus_control`: this session carries the week's
   * knee-alignment row, so its injury-prevention slot is filtered to it.
   */
  rntSlot?: boolean;
  /**
   * House `house.sc.sport_requirements`: false for speed climbing, whose wall
   * demand is five to seven seconds, so no conditioning block is ever added.
   */
  allowsConditioning?: boolean;
  /**
   * House `house.sc.sequence_strength_rfd_reactive`: a fourth jump row on the
   * jump day, so the block's own intensive family and the two laddered
   * extensive drills both fit.
   */
  extraPowerRow?: boolean;
  /**
   * House `house.sc.sport_requirements`: the reactive day carries an explosive
   * pull beside its jumps, in place of the fourth jump row.
   */
  explosivePullRow?: boolean;
}

/**
 * R42 and R44 with the orchestrator's primer reading: the Primer prepares the
 * day, it does not spend it. A high-CNS row placed there takes one of the
 * session's two high-CNS slots before the main lift and the day's velocity
 * work are placed, so the Primer takes low and moderate CNS rows only. The
 * jump test itself is not a Primer row: it has its own block.
 */
function primerCnsAllows(exercise: Exercise): boolean {
  return exercise.cnsCost !== 'high';
}

/**
 * A med-ball throw: the load type is power, the row is not loadable (the
 * safety override in brief section 09 keeps throws off any percentage) and it
 * needs a med ball. Used by the upper-power template's two throw slots.
 */
export function isMedBallThrow(exercise: Exercise): boolean {
  return (
    exercise.loadType === 'power' && !exercise.loadable && exercise.equipment.includes('med_ball')
  );
}

/**
 * House `house.sc.upper_power_day`: the row that carries the day's velocity
 * pull, an explosive or band-assisted overspeed pull-up.
 */
export function isExplosivePull(exercise: Exercise): boolean {
  return exercise.isPulling && exercise.intent === 'velocity';
}

/** R102 at or under 30 m is acceleration, R103 at or over 40 m is max velocity. */
export type SprintClass = 'acceleration' | 'max_velocity' | null;

/**
 * R138 and R140: which sprint class the athlete's sport requires each week.
 *
 * Speed climbing is an acceleration event: the wall is five to seven seconds
 * off the floor, which is R102's 10 to 30 m band. It joins football here
 * rather than in a house rule, because this is the rule book's own reading of
 * the sport; what stays a house rule is that no CONDITIONING block is added
 * around it (R32 is optional and these goals do not ask for one).
 */
export function sprintClassFor(sport: Sport): SprintClass {
  if (sport === 'football' || sport === 'speed_climbing') return 'acceleration';
  if (sport === 'track_field') return 'max_velocity';
  return null;
}

/** R102, R103: the sprint distances each class covers. */
export function matchesSprintClass(exercise: Exercise, sprintClass: SprintClass): boolean {
  const meters = exercise.sprintDistanceM;
  if (sprintClass === null || meters === undefined) return false;
  if (exercise.movementPattern !== 'sprint') return false;
  return sprintClass === 'acceleration' ? meters <= 30 : meters >= 40;
}

const PRECEDENCE = {
  warmUp: 100,
  jumpTest: 95,
  mainLift: 90,
  power: 88,
  primer: 80,
  tendon: 70,
  secondary: 60,
  cod: 55,
  sprint: 54,
  extraJump: 50,
  core: 40,
  injuryPrevention: 38,
  accessory: 30,
  coolDown: 100,
  recovery: 92,
} as const;

/** The legal block order for one day type (R29 to R40). */
export function blockOrderFor(dayType: DayType): SessionBlockName[] {
  switch (dayType) {
    case 'full_body_strength':
    case 'lower_strength':
    case 'upper_strength':
      return ['warm_up', 'primer', 'main_lift', 'secondary', 'accessory', 'injury_prevention_core', 'conditioning', 'cool_down'];
    case 'upper_mobility':
      return ['warm_up', 'primer', 'main_lift', 'accessory', 'injury_prevention_core', 'cool_down'];
    case 'power_speed':
    case 'power':
    case 'speed':
      return ['warm_up', 'primer', 'jump_test', 'power', 'cod', 'accessory', 'injury_prevention_core', 'conditioning', 'cool_down'];
    case 'recovery_mobility':
      return ['warm_up', 'accessory', 'recovery'];
  }
}

function strengthTemplate(options: TemplateOptions): RoleSlot[] {
  const slots: RoleSlot[] = [
    { block: 'warm_up', role: 'warm_up', count: 3, min: 2, grouped: true, precedence: PRECEDENCE.warmUp },
    { block: 'primer', role: 'primer', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.primer, filter: primerCnsAllows },
    { block: 'main_lift', role: 'main_lift', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.mainLift },
  ];
  if (options.peakSession) {
    slots.push({ block: 'cool_down', role: 'cool_down', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.coolDown });
    return slots;
  }
  slots.push(
    { block: 'secondary', role: 'secondary', count: 1, min: 0, grouped: false, precedence: PRECEDENCE.secondary },
    { block: 'accessory', role: 'accessory', count: options.reducedWeek ? 1 : 2, min: 0, grouped: false, precedence: PRECEDENCE.accessory },
    injuryPreventionSlot(options),
    { block: 'injury_prevention_core', role: 'core', count: 1, min: 0, grouped: false, precedence: PRECEDENCE.core },
    { block: 'cool_down', role: 'cool_down', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.coolDown },
  );
  return slots;
}

/**
 * The injury-prevention slot, narrowed to the RNT knee-alignment row on the
 * sessions the week's placement chose (house `house.sc.rnt_valgus_control`).
 */
function injuryPreventionSlot(options: TemplateOptions): RoleSlot {
  const slot: RoleSlot = {
    block: 'injury_prevention_core',
    role: 'injury_prevention',
    count: 1,
    min: 1,
    grouped: false,
    precedence: PRECEDENCE.injuryPrevention,
  };
  if (options.rntSlot === true) slot.filter = (exercise) => exercise.isRnt;
  return slot;
}

/**
 * House `house.sc.upper_power_day`: the Upper Strength day for speed climbing.
 * The weighted pull-up is the main lift (R67 still bounds the day at three
 * strength movements and R44 at two high-CNS rows), an explosive or
 * band-assisted pull is the velocity pull, a chest throw and a rotational
 * throw carry the power intent and R50, and a push press or dumbbell press is
 * the R48 pairing. At most eight displayed rows, as everywhere.
 */
function upperPowerTemplate(options: TemplateOptions): RoleSlot[] {
  const slots: RoleSlot[] = [
    { block: 'warm_up', role: 'warm_up', count: 3, min: 2, grouped: true, precedence: PRECEDENCE.warmUp },
    {
      block: 'primer',
      role: 'primer',
      count: 1,
      min: 1,
      grouped: false,
      precedence: PRECEDENCE.primer,
      // R42 and R44: a high-CNS primer would spend the day's two-exercise CNS
      // budget before the main lift and the explosive pull are placed.
      filter: primerCnsAllows,
    },
    { block: 'main_lift', role: 'main_lift', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.mainLift },
  ];
  if (options.peakSession) {
    slots.push({ block: 'cool_down', role: 'cool_down', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.coolDown });
    return slots;
  }
  slots.push(
    {
      block: 'secondary',
      role: 'secondary',
      count: 1,
      min: 1,
      grouped: false,
      precedence: PRECEDENCE.secondary,
      filter: isExplosivePull,
    },
    {
      block: 'accessory',
      role: 'accessory',
      count: 1,
      min: 1,
      grouped: false,
      precedence: PRECEDENCE.accessory + 8,
      // The chest throw, not the overhead slam: a slam is a hinge, and a hinge
      // pulls two more accessory rows in behind it (R47, R68).
      filter: (exercise) =>
        isMedBallThrow(exercise) && exercise.movementPattern === 'push_horizontal',
    },
    {
      block: 'accessory',
      role: 'accessory',
      count: 1,
      min: 0,
      grouped: false,
      precedence: PRECEDENCE.accessory + 4,
      // R50: the rotational throw is the transverse-plane movement.
      filter: (exercise) => isMedBallThrow(exercise) && exercise.plane !== 'sagittal',
    },
    {
      block: 'accessory',
      role: 'accessory',
      count: 1,
      min: 0,
      grouped: false,
      precedence: PRECEDENCE.accessory,
      // R48: the push beside the pull, a push press at strength speed or a
      // dumbbell press at hypertrophy loads.
      filter: (exercise) =>
        exercise.isPush &&
        exercise.loadable &&
        exercise.movementPattern === 'push_vertical' &&
        (exercise.loadType === 'strength_speed' || exercise.loadType === 'hypertrophy'),
    },
    injuryPreventionSlot(options),
    { block: 'cool_down', role: 'cool_down', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.coolDown },
  );
  return slots;
}

function powerTemplate(options: TemplateOptions): RoleSlot[] {
  const slots: RoleSlot[] = [
    { block: 'warm_up', role: 'warm_up', count: 3, min: 2, grouped: true, precedence: PRECEDENCE.warmUp },
    {
      block: 'primer',
      role: 'primer',
      count: 2,
      min: 1,
      // The test-day primer is constant and renders as one grouped row.
      grouped: options.isTestDay,
      precedence: PRECEDENCE.primer,
      filter: primerCnsAllows,
    },
  ];
  if (options.isTestDay) {
    slots.push({ block: 'jump_test', role: 'power_jump', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.jumpTest });
  }
  // R138 and R140 are weekly requirements, so the sport's sprint takes its
  // place in the two-high-CNS budget (R44, a hard cap) ahead of an optional
  // maximal jump. It still renders after the power block (R31 to R40).
  if (options.sprintClass !== null && !options.peakSession && options.allowsConditioning !== false) {
    slots.push({
      block: 'conditioning',
      role: 'conditioning',
      count: 1,
      min: 1,
      grouped: false,
      precedence: PRECEDENCE.sprint,
      filter: (exercise) => matchesSprintClass(exercise, options.sprintClass),
    });
  }
  // The same weekly requirement for a sport that adds no conditioning block:
  // the sprint runs inside the Power block instead, which is where R38 puts
  // it anyway ("Power: jumps, throws, sprints"). Its slot is pushed AFTER the
  // jump slot below, because R112's vertical jump is the primary goal and
  // R113's speed the secondary: the two high-CNS rows R44 allows go to the
  // weekly test and the sport's maximal jump, and the acceleration fills in
  // behind them.
  const sprintRow =
    options.sprintClass !== null && !options.peakSession && options.allowsConditioning === false;
  // House `house.sc.sport_requirements`: the reactive day carries an explosive
  // or band-assisted pull beside the jumps, and a med-ball throw instead when
  // the 48 h finger spacing has taken the hard rows off this session. It
  // spends the extra jump row rather than a ninth displayed one.
  // The throws it may fall back on are the rotational and scoop ones, not the
  // chest throw or the slam: a slam is a hinge and a chest throw is a push,
  // and each drags two more accessory rows in behind it (R48, R68) onto a day
  // whose eight rows are already spent.
  const pullRow = options.explosivePullRow === true && !options.peakSession && !options.reducedWeek;
  if (pullRow) {
    slots.push({
      block: 'power', role: 'power_jump', count: 1, min: 0, grouped: false, precedence: PRECEDENCE.power - 1,
      filter: (exercise) =>
        isExplosivePull(exercise) ||
        (isMedBallThrow(exercise) && !exercise.isPush && exercise.movementPattern !== 'hinge'),
    });
  }
  // House `house.sc.sequence_strength_rfd_reactive`: a sport whose jump day
  // must carry both the block's own intensive family and the two laddered
  // extensive drills gets a fourth jump row. Every row the house slots above
  // added is a row the jump slot gives back, so the 8-row display cap never
  // has to trim a pairing repair out.
  const spent = (pullRow ? 1 : 0) + (sprintRow ? 1 : 0);
  const powerCount = options.peakSession
    ? 2
    : options.reducedWeek
      ? 2
      : Math.max(2, (options.extraPowerRow === true ? 4 : 3) - spent);
  const powerSlot: RoleSlot = {
    block: 'power',
    role: 'power_jump',
    count: powerCount,
    min: 1,
    grouped: false,
    precedence: PRECEDENCE.power,
  };
  // One acceleration row, not two: the slot below carries the week's sprint
  // requirement, so the jump rows beside it stay jump rows.
  if (sprintRow) powerSlot.filter = (exercise) => !matchesSprintClass(exercise, options.sprintClass);
  slots.push(powerSlot);
  if (sprintRow) {
    // Preferred, not mandatory (R113 is the secondary goal): a day that cannot
    // fit the acceleration under R44 or the 8-row cap drops it with a trimmed
    // reason, and never the maximal jump R112 asked for.
    slots.push({
      block: 'power', role: 'power_jump', count: 1, min: 0, grouped: false, precedence: PRECEDENCE.sprint,
      filter: (exercise) => matchesSprintClass(exercise, options.sprintClass),
      dropReason: 'No room for the acceleration sprint beside the jump work',
    });
    // The test day's primer renders as one grouped row, so the jump day has
    // one display row in hand. It goes to a third extensive drill, which is
    // what lets R84's contact target be reached beside a maximal jump, and it
    // is the first row the display cap takes back, below the acceleration.
    if (options.isTestDay && options.extraPowerRow === true && !options.reducedWeek) {
      slots.push({
        block: 'power', role: 'power_jump', count: 1, min: 0, grouped: false, precedence: PRECEDENCE.extraJump,
        filter: (exercise) => !matchesSprintClass(exercise, options.sprintClass),
      });
    }
  }
  if (options.includeCod && !options.peakSession) {
    slots.push({ block: 'cod', role: 'cod', count: 2, min: 1, grouped: false, precedence: PRECEDENCE.cod });
  }
  if (!options.peakSession) {
    slots.push({ block: 'accessory', role: 'tendon', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.tendon });
  }
  // House `house.sc.rnt_valgus_control`: a power or speed day can be one of
  // the two sessions far enough from the wall, and its own template has no
  // injury-prevention slot.
  if (options.rntSlot === true && !options.peakSession) slots.push(injuryPreventionSlot(options));
  slots.push({ block: 'cool_down', role: 'cool_down', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.coolDown });
  return slots;
}

function upperMobilityTemplate(): RoleSlot[] {
  return [
    { block: 'warm_up', role: 'warm_up', count: 3, min: 2, grouped: true, precedence: PRECEDENCE.warmUp },
    { block: 'main_lift', role: 'main_lift', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.mainLift },
    { block: 'accessory', role: 'accessory', count: 2, min: 1, grouped: false, precedence: PRECEDENCE.accessory },
    { block: 'injury_prevention_core', role: 'core', count: 1, min: 0, grouped: false, precedence: PRECEDENCE.core },
    { block: 'cool_down', role: 'cool_down', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.coolDown },
  ];
}

function recoveryTemplate(): RoleSlot[] {
  return [
    { block: 'warm_up', role: 'warm_up', count: 2, min: 2, grouped: true, precedence: PRECEDENCE.warmUp },
    { block: 'accessory', role: 'soft_tissue', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.accessory },
    { block: 'accessory', role: 'mobility', count: 2, min: 1, grouped: false, precedence: PRECEDENCE.accessory },
    { block: 'accessory', role: 'activation', count: 1, min: 1, grouped: false, precedence: PRECEDENCE.accessory },
    { block: 'recovery', role: 'mobility', count: 2, min: 1, grouped: true, precedence: PRECEDENCE.recovery },
  ];
}

/** The slot list for one day type, in the order the blocks are built. */
export function templateFor(dayType: DayType, options: TemplateOptions): RoleSlot[] {
  switch (dayType) {
    case 'upper_strength':
      return options.upperPower === true ? upperPowerTemplate(options) : strengthTemplate(options);
    case 'full_body_strength':
    case 'lower_strength':
      return strengthTemplate(options);
    case 'upper_mobility':
      return upperMobilityTemplate();
    case 'power_speed':
    case 'power':
    case 'speed':
      return powerTemplate(options);
    case 'recovery_mobility':
      return recoveryTemplate();
  }
}

const CNS_RANK = { low: 0, moderate: 1, high: 2 } as const;

/**
 * R42 and R43: high-CNS and high-technical-skill work goes early. A stable
 * sort, so equal rows keep the order the pool produced them in.
 */
export function orderWithinBlock(exercises: readonly Exercise[]): Exercise[] {
  return exercises
    .map((exercise, index) => ({ exercise, index }))
    .sort((a, b) => {
      const cns = CNS_RANK[b.exercise.cnsCost] - CNS_RANK[a.exercise.cnsCost];
      if (cns !== 0) return cns;
      const skill = Number(b.exercise.technicalSkillHigh) - Number(a.exercise.technicalSkillHigh);
      if (skill !== 0) return skill;
      return a.index - b.index;
    })
    .map((entry) => entry.exercise);
}

/** Sort assembled blocks into the day type's legal placement order. */
export function sortSessionBlocks(blocks: readonly SessionBlock[], dayType: DayType): SessionBlock[] {
  const order = blockOrderFor(dayType);
  return blocks
    .map((block, index) => ({ block, index, rank: order.indexOf(block.name) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.block);
}

/**
 * Rows the 8-exercise cap counts: a grouped block is one row, and the warm-up
 * and cool-down groups do not count at all.
 */
export function displayedRowCount(blocks: readonly SessionBlock[]): number {
  let rows = 0;
  for (const block of blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down') continue;
    if (block.exercises.length === 0) continue;
    rows += block.grouped ? 1 : block.exercises.length;
  }
  return rows;
}

/** R137 and R135, R136: which day carries the week's change-of-direction work. */
export function codDayTypeFor(daysPerWeek: 2 | 3 | 4 | 5): DayType {
  return daysPerWeek === 5 ? 'speed' : 'power_speed';
}

/** R137: which day carries the week's jump or reactive plyometric work. */
export function jumpDayTypeFor(daysPerWeek: 2 | 3 | 4 | 5): DayType {
  return daysPerWeek === 5 ? 'power' : 'power_speed';
}
