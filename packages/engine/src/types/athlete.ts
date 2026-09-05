/**
 * The athlete singleton and everything the generator reads off it
 * (brief section 12 "Data model", Athlete row).
 */
import type {
  DaysPerWeek,
  EquipmentTag,
  GripMode,
  Instrument,
  LiftId,
  Level,
  PainDuration,
  PainLocation,
  PainSeverity,
  PainSeverityRaw,
  PrimaryGoal,
  SecondaryGoal,
  Side,
  Sport,
  TrainingAge,
  WorkingMaxSource,
} from './core.js';
import type { IsoInstant, LocalDate, Weekday } from './calendar.js';
import type { ReadinessTestConfig } from './readiness.js';

/**
 * Structured inventory. R19 excludes any exercise whose equipment is absent;
 * R45 and R46 gate barbell compounds on `weightRoomAccess`, which is derived,
 * never asked (brief section 12 "derived weight_room_access").
 */
export interface Inventory {
  barbell: boolean;
  rack: boolean;
  /** Smallest pair of plates on hand, in pounds; the fallback load grid. */
  plates: { smallestPairLb: number };
  trapBar: boolean;
  dumbbells: { maxLb: number; incrementLb: number } | null;
  kettlebells: boolean;
  /** Available box heights in inches, ascending. Drives ladder rungs. */
  boxHeightsIn: number[];
  /** Available hurdle heights in inches, ascending. */
  hurdleHeightsIn: number[];
  bands: boolean;
  medBall: boolean;
  /** Weight-vest load in pounds when one is owned. */
  vestLb?: number;
  bench: boolean;
  pullupBar: boolean;
  cable: boolean;
  sled: boolean;
  /**
   * A fingerboard for open-hand hangs. Absent reads as false, so an athlete
   * who never answered the question keeps the inventory they already had.
   */
  hangboard?: boolean;
  /** A box at squat height, which the box squat needs. Absent reads as false. */
  boxSquatBox?: boolean;
  /**
   * A climbing wall the athlete trains on. Absent reads as false: the app
   * never programmes wall work, it only spaces the gym work around it
   * (house rule `house.sc.rnt_valgus_control`).
   */
  climbingWall?: boolean;
  /** Derived: barbell and rack and plates. Never asked directly. */
  weightRoomAccess: boolean;
}

/**
 * When the athlete climbs. The app schedules nothing here; it reads the days
 * so the RNT row lands at least `valgusControl.minHoursFromWall` from a wall
 * session (house rule `house.sc.rnt_valgus_control`).
 */
export interface WallWork {
  /** Weekdays the athlete is on the wall, Sunday at 0. */
  weekdays: Weekday[];
  /** Local 24-hour clock time, "18:00". Absent means the whole day counts. */
  typicalStart?: string;
  /** Local 24-hour clock time, "20:30". */
  typicalEnd?: string;
  /**
   * How hard the wall loads the fingers. The owner's answer: a speed-climbing
   * wall session IS a hard finger session, so this is `hard` unless the
   * athlete says otherwise, and the 48 h spacing counts it
   * (house rule `house.sc.hard_finger_spacing`). Absent reads as `hard`.
   */
  fingerLoad?: 'hard' | 'light';
  /**
   * The gap, in hours, gym finger work keeps from wall work ON THE SAME DAY.
   * The owner's exception to the 48 h rule: upper-body gym work and climbing
   * on one day is fine when they are this far apart, window end to window
   * start either way round. Absent reads as
   * `constants.climbing.rntWallGapHours`, which is the same six hours.
   */
  sameDayGapHours?: number;
}

/**
 * A best recent set the athlete typed for one lift (reps, load and effort),
 * stored as a retro-logged set with entry source `entered`. R73 reads it as an
 * Epley source; the house 0.95 confidence factor is waived when the effort and
 * the rep count make it a true near-max (RPE 8 or higher at 6 reps or fewer).
 */
export interface BestSet {
  /** Reps completed. On an added-load lift, at the added load. */
  reps: number;
  /** The load, in kilograms. On an added-load lift, the ADDED load. */
  loadKg: number;
  /** Effort out of 10, when the athlete gave one. */
  rpe?: number;
  /** The local day the set was done. */
  at: LocalDate;
}

/**
 * Reactive neuromuscular training for knee alignment: a band pulls the knee
 * into valgus and the athlete resists it. House rule
 * `house.sc.rnt_valgus_control`: twice a week, at least six hours from wall
 * work, and every set ends when alignment goes rather than at a rep count.
 */
export interface ValgusControl {
  required: boolean;
  /** Sessions per week the injury-prevention slot must carry. */
  sessionsPerWeek: number;
  /** The gap from wall work, in hours, the placement rule keeps. */
  minHoursFromWall: number;
}

/**
 * When the athlete usually trains, on a local 24-hour clock. The engine
 * schedules dates, not clock times, so this is only read to measure the gap
 * from wall work (house rule `house.sc.rnt_valgus_control`). Absent falls back
 * to `ASSUMED_SESSION_WINDOW`, so an athlete who never answered keeps the
 * placement they had.
 */
export interface SessionWindow {
  /** "17:00". */
  start: string;
  /** "19:00". */
  end: string;
}

/** One reported pain site (Onboarding V1 question 5 plus the brief's duration question). */
export interface PainStatus {
  location: PainLocation;
  /** The chip the athlete tapped. */
  severityRaw: PainSeverityRaw;
  /** Derived: 1-2 mild, 3-4 moderate, 5+ severe. */
  severity: PainSeverity;
  /** Derived: under 12 weeks acute, otherwise chronic (ICD-11). */
  duration: PainDuration;
  /** How long it has bothered them, in weeks, as answered. */
  durationWeeks: number;
  reportedAt: LocalDate;
  /** R6: mild acute is treated as moderate for 2 weeks, then re-prompted. */
  reassessDueAt: LocalDate;
  clearedAt?: LocalDate;
}

/** Gate 0. Any yes on the seven blocks generation until a clinician clears it (R2). */
export interface ClearanceAnswers {
  /** 1. Heart condition or supervised-activity advice. */
  heartCondition: boolean;
  /** 2. Chest pain at rest or with activity. */
  chestPain: boolean;
  /** 3. Loss of balance from dizziness or loss of consciousness. */
  dizziness: boolean;
  /** 4. Other chronic medical condition. */
  chronicCondition: boolean;
  /** 5. Prescription medication for a chronic condition. */
  prescriptionMedication: boolean;
  /** 6. Bone, joint or soft-tissue problem worsened by activity. */
  boneOrJointProblem: boolean;
  /** 7. A doctor has said to do medically supervised activity only. */
  supervisedActivityOnly: boolean;
  /** R1: under 18 caps maximal loading at 90% effort. */
  isAdult: boolean;
  attestedAt?: LocalDate;
  clearedByClinicianAt?: LocalDate;
  nextPromptAt?: LocalDate;
}

/**
 * The frozen working max for one lift (safety override in brief section 09:
 * frozen and monotone rather than recomputed live).
 */
export interface WorkingMax {
  lift: LiftId;
  valueKg: number;
  /** R72 entered, R73 Epley, R74 RPE mode. */
  source: WorkingMaxSource;
  /** House 0.95 on Epley-only maxes until an RPE 8 set at 6 reps or fewer. */
  confidence: number;
  /** The generation instant this value was pinned at. */
  frozenAt: IsoInstant;
  /** Last time it rose; the +5% per week cap is measured from here. */
  lastRaiseAt?: IsoInstant;
  /** Consecutive weeks with a failed prescribed set; drives R97 (5% then 10%). */
  failStreak: number;
}

/** The 0 to 10 row at the top of Today, or null when skipped (R27). */
export type SorenessAnswer = number | null;

/** One day's soreness answer, kept for the recovery-versus-output table. */
export interface SorenessEntry {
  date: LocalDate;
  value: SorenessAnswer;
}

/** The athlete singleton (brief section 12). */
export interface Athlete {
  id: string;
  primaryGoal: PrimaryGoal;
  /**
   * A second goal, when the athlete named one. For the climbing owner it is
   * `upper_body_power`, which is what earns the weekly upper-power session
   * (house rule `house.sc.sport_requirements`).
   */
  secondaryGoal?: SecondaryGoal;
  sport: Sport;
  trainingAge: TrainingAge;
  /** Derived from `trainingAge`, never shown as such. */
  level: Level;
  daysPerWeek: DaysPerWeek;
  /** Chosen weekdays in template order; index 0 is day 0 of the training week. */
  weekdays: Weekday[];
  isAdult: boolean;
  clearance: ClearanceAnswers;
  painStatus: PainStatus[];
  inventory: Inventory;
  bodyweightKg: number | null;
  workingMaxes: WorkingMax[];
  /**
   * A best recent set per lift, typed in setup step two or Settings > Lifts.
   * Additive: an athlete who typed none has no key here and every working max
   * resolves exactly as it did before (R73, R74).
   */
  bestSets?: Partial<Record<LiftId, BestSet>>;
  /** R137 house override: in-season games count as the COD session. */
  inSeason: boolean;
  /** Depth-jump readiness checklist passed on this date, or never. */
  readinessPassedAt?: LocalDate;
  /** Display only; never converted into a jump-height stream. */
  standingReachMm: number | null;
  goalHeightMm: number;
  targetDate: LocalDate;
  /** The stream every decision number is read from (brief section 08). */
  primaryInstrument: Instrument;
  /** Baseline height on the primary instrument, fixed at program start. */
  baselineHeightMm: number;
  timezone: string;
  /** Hour of the local day a session still counts as yesterday's. */
  rolloverHour: number;
  /** Free text describing the athlete's canonical test conditions. */
  canonicalTestNote: string;
  sorenessHistory: SorenessEntry[];
  /** Equipment the athlete owns that is not covered by `inventory` tags. */
  extraEquipment: EquipmentTag[];
  /**
   * An A2 pulley or other finger-pulley history. Absent reads as false.
   * House rule `house.sc.open_hand_grip`: true forces `gripMode` to
   * `open_hand` on every pulling row.
   */
  fingerHistory?: boolean;
  /**
   * The grip every pulling row is shown in. Absent reads as `any`, which is
   * what every athlete without a finger history gets.
   */
  gripMode?: GripMode;
  /**
   * The 0 to 10 finger-pain answer at or above which hard finger work is
   * removed for the day. Absent reads as
   * `constants.climbing.fingerPainCeiling` (house rule
   * `house.sc.finger_pain_ceiling`, ceiling 3, so 4 and above removes it).
   */
  fingerPainCeiling?: number;
  /** When the athlete is on the wall. Absent means no wall days are known. */
  wallWork?: WallWork;
  /**
   * When the athlete usually trains. Read only to measure the gap from wall
   * work; absent falls back to `ASSUMED_SESSION_WINDOW`
   * (house rule `house.sc.rnt_valgus_control`).
   */
  sessionWindow?: SessionWindow;
  /** RNT knee-alignment work. Absent means it is not required. */
  valgusControl?: ValgusControl;
  /**
   * The leg that goes first on unilateral work. Absent or null means no
   * single-leg test and no answer yet, so the seeded order stands
   * (house rule `house.sc.weaker_side_first`).
   */
  weakerSide?: Side | null;
  /**
   * The readiness gate's swappable test. Absent means the gate runs on
   * `constants.climbing.readiness` (house rule `house.sc.readiness_gate`).
   */
  readinessConfig?: ReadinessTestConfig;
}
