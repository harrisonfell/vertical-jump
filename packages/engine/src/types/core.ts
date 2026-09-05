/**
 * Core enumerations for the Vert engine.
 *
 * Every union here is closed: the generator refuses to select an exercise
 * whose tag falls outside these values (R58, R59, R60 make the tags a
 * database requirement). Rule numbers in JSDoc are ThisFiTT Rule Book v5;
 * quoted phrases are from brief section 09 "Program engine".
 */

/** Derived from training age, never shown to the athlete (brief 09 "Level and inputs"). */
export type Level = 'beginner' | 'intermediate' | 'advanced';

/** Onboarding question 3 verbatim (Onboarding V1). */
export type TrainingAge = 'none' | 'lt1' | '1to3' | '4plus';

/** 2 is the declared minimum; six days are gone (brief 16 "Defaults asserted"). */
export type DaysPerWeek = 2 | 3 | 4 | 5;

/** The eight rule-book day types in use (R133 to R136, R141 to R145). */
export type DayType =
  | 'full_body_strength'
  | 'lower_strength'
  | 'upper_strength'
  | 'upper_mobility'
  | 'power_speed'
  | 'power'
  | 'speed'
  | 'recovery_mobility';

/** Strength then Power (R108). Taper and Peak live inside the Power block. */
export type BlockType = 'strength' | 'power';

/** Week character: load, deload (R105, R106), taper, peak (both house). */
export type WeekKind = 'load' | 'deload' | 'taper' | 'peak';

/**
 * Block 6 driver (R149). The first eight are rule-book load types; `ballistic`
 * is the loaded-jump safety override and `bodyweight` the non-loadable type
 * (R159), both added by brief section 09 "Load prescription".
 */
export type LoadType =
  | 'heavy_strength'
  | 'power'
  | 'ballistic'
  | 'hypertrophy'
  | 'endurance'
  | 'speed_strength'
  | 'strength_speed'
  | 'prehab'
  | 'mobility'
  | 'bodyweight';

/**
 * Onboarding question 2 (R137 to R140 key off this). `speed_climbing` is the
 * IFSC 15 m discipline and is additive: every other sport keeps the rules it
 * already had, and the climbing requirements live in `house.sc.*`.
 */
export type Sport =
  | 'basketball'
  | 'football'
  | 'soccer'
  | 'track_field'
  | 'volleyball'
  | 'baseball'
  | 'speed_climbing'
  | 'none';

/** Onboarding question 1 (R112 to R115 key off this). */
export type PrimaryGoal =
  | 'vertical_jump'
  | 'sprint_speed'
  | 'strength'
  | 'overall_athleticism'
  | 'return_from_injury';

/**
 * A second goal the athlete may name beside the primary one. House rule
 * `house.sc.sport_requirements`: for speed climbing the owner names
 * `upper_body_power`, which is what puts an upper-body power session in every
 * week. Absent on every athlete who never answered the question.
 */
export type SecondaryGoal =
  | 'upper_body_power'
  | 'speed'
  | 'strength'
  | 'injury_prevention';

/** Onboarding question 5 locations plus Shin, added by the brief for R7 to R9. */
export type PainLocation =
  | 'knee'
  | 'achilles_calf'
  | 'hamstring'
  | 'hip'
  | 'back'
  | 'shoulder'
  | 'shin'
  | 'finger'
  | 'other';

/** The three answer chips the athlete taps (Onboarding V1 question 5). */
export type PainSeverityRaw = '1-2' | '3-4' | '5+';

/** "Severity 1-2 is mild, 3-4 moderate, 5+ severe" (brief 09 "Pain gate"). */
export type PainSeverity = 'mild' | 'moderate' | 'severe';

/** "Duration under 12 weeks is acute, otherwise chronic (ICD-11)". */
export type PainDuration = 'acute' | 'chronic';

/** Session blocks in their legal placement order (R29 to R39). */
export type SessionBlockName =
  | 'warm_up'
  | 'primer'
  | 'main_lift'
  | 'secondary'
  | 'accessory'
  | 'injury_prevention_core'
  | 'conditioning'
  | 'cool_down'
  | 'recovery'
  | 'power'
  | 'cod'
  | 'jump_test';

/** Joint-stress and cost tags (R59, R60). */
export type StressLevel = 'low' | 'moderate' | 'high';

/** Required attribute (R58); ceiling by level (R53 to R55). */
export type StabilityDemand = StressLevel;

/** Required attribute (R60); drives R42 and R44. */
export type CnsCost = StressLevel;

/** R50 needs a frontal or transverse movement beside any sagittal one. */
export type Plane = 'sagittal' | 'frontal' | 'transverse';

/** Pattern tags that drive R47, R48, R49, R68, R121 to R124. */
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'push_horizontal'
  | 'push_vertical'
  | 'pull_horizontal'
  | 'pull_vertical'
  | 'carry'
  | 'jump'
  | 'sprint'
  | 'cod'
  | 'brace'
  | 'rotation'
  | 'isolation'
  | 'mobility';

/** Where an exercise may sit in a session (R35 to R40, R141 to R145). */
export type ExerciseRole =
  | 'main_lift'
  | 'secondary'
  | 'accessory'
  | 'injury_prevention'
  | 'core'
  | 'conditioning'
  | 'warm_up'
  | 'cool_down'
  | 'mobility'
  | 'primer'
  | 'power_jump'
  | 'cod'
  | 'tendon'
  | 'activation'
  | 'soft_tissue';

/**
 * A jump-height measurement stream. Streams never share a trend line, a PR,
 * or an axis (brief section 08).
 */
export type Instrument =
  | 'ovr_jump_regular'
  | 'ovr_jump_rsi'
  | 'vertec_reach_touch'
  | 'manual';

/** Inventory-checked equipment (R19, R45, R46). */
export type EquipmentTag =
  | 'barbell'
  | 'rack'
  | 'trap_bar'
  | 'dumbbell'
  | 'kettlebell'
  | 'box'
  | 'hurdle'
  | 'band'
  | 'med_ball'
  | 'vest'
  | 'bench'
  | 'pullup_bar'
  | 'cable'
  | 'sled'
  | 'hangboard'
  | 'box_squat_box'
  | 'none';

/**
 * Identity of a lift that carries a working max. A stable exercise id for
 * loadable main and secondary lifts (for example `back_squat`).
 */
export type LiftId = string;

/** Stable exercise identifier, unique inside the seed file. */
export type ExerciseId = string;

/** Stable progression-ladder identifier (for example `box_jump_height`). */
export type LadderId = string;

/** Joints the R26 weekly budget tracks. */
export type StressedJoint = 'knee' | 'spine' | 'shoulder';

/**
 * Tendon families the R78 to R80 protocols target. `finger` is additive: only
 * the speed-climbing hangboard work carries it (house `house.sc.open_hand_grip`).
 */
export type TendonTarget = 'calf' | 'knee' | 'achilles' | 'finger';

/** The R100 runway: isometric then slow resistance then plyometric. */
export type TendonMode = 'isometric' | 'slow_resistance' | 'plyometric';

/** R116 to R119 count exercises by intent. */
export type ExerciseIntent =
  | 'strength'
  | 'velocity'
  | 'elastic'
  | 'mobility'
  | 'low_fatigue'
  | 'prehab';

/** How a prescription row reads (implementation checklist, page 11). */
export type DisplayMode = 'reps' | 'time' | 'distance';

/** Chart series identity; the fixed categorical slot order in DESIGN.md. */
export type ChartCategory = 'plyometrics' | 'strength' | 'mobility' | 'technique';

/** Where a set's load came from (brief section 12 `load_mode`). */
export type LoadMode = 'entered' | 'epley' | 'rpe' | 'week1' | 'velocity' | 'none';

/** How the working max was derived (R72, R73, R74). */
export type WorkingMaxSource = 'entered' | 'epley' | 'rpe';

/** Landing quality gates the ladder rule (brief 09 "Plyometrics"). */
export type LandingQuality = 'good' | 'ok' | 'poor';

/**
 * Which grip a pulling exercise is performed in. House rule
 * `house.sc.open_hand_grip`: an athlete with a finger-pulley history only ever
 * sees `open_hand` rows, so every pulling exercise in the seed carries this
 * tag and a variant with `open_hand` exists for each one.
 */
export type GripMode = 'open_hand' | 'half_crimp' | 'full_crimp' | 'any';

/**
 * How hard an exercise loads the finger flexors and their pulleys. House rule
 * `house.sc.hard_finger_spacing`: `hard` rows sit at least 48 h apart, on the
 * same machinery R90 to R93 use for maximal CNS work.
 */
export type FingerLoad = 'none' | 'light' | 'hard';

/** Which side of the body a unilateral row runs first. */
export type Side = 'left' | 'right';

/**
 * What a session is for, beside its day type. House rule
 * `house.sc.upper_power_day`: for speed climbing the Upper Strength day runs
 * at `upper_power`, a weighted pull-up main lift with explosive pulls and
 * throws around it, rather than the fixed hypertrophy loads of R135.
 */
export type SessionIntent =
  | 'strength'
  | 'upper_power'
  | 'power'
  | 'speed'
  | 'recovery';
