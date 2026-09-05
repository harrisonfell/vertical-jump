/**
 * Block 1 output. Safety runs first (Rule 0) and nothing in Blocks 2 to 6 may
 * raise a cap it sets (R28). Brief section 09 "Pain gate (Block 1)".
 */
import type { HouseRule } from './ruleset.js';
import type { PainLocation, TendonTarget } from './core.js';

/** Exercise attributes a pain cap may be scoped to (R163). */
export type CappedAttribute =
  | 'knee_stress'
  | 'spine_stress'
  | 'shoulder_stress'
  | 'axial_load'
  | 'pressing'
  | 'overhead'
  | 'all';

/** Every exclusion Block 1 can raise, as flags the selector reads. */
export interface PainExclusions {
  /** R4, R11, R14: exclude exercises with that joint stress at high. */
  kneeHigh: boolean;
  spineHigh: boolean;
  shoulderHigh: boolean;
  /** R3, R16: exclude all plyometrics. */
  allPlyo: boolean;
  /** R8, R17: exclude high-intensity plyometrics. */
  highIntensityPlyo: boolean;
  /** R8: exclude high-impact plyometrics. */
  highImpactPlyo: boolean;
  /** R7: exclude all repetitive impact work. */
  repetitiveImpact: boolean;
  /** R13, R14: exclude overhead work. */
  overhead: boolean;
  /** R13, R14: exclude pressing work. */
  pressing: boolean;
  /** R10, R11: exclude axial loading, heavy first. */
  axialHeavy: boolean;
  /** R10: exclude every axial-loaded exercise. */
  axialAll: boolean;
  /** R3: exclude every knee-stress exercise at any level. */
  allKneeStress: boolean;
  /** R10: exclude every spine-stress exercise. */
  allSpineStress: boolean;
  /** House template: hamstring, hip and other exclusions by movement pattern. */
  excludedPatterns: string[];
}

/** An intensity cap and the attributes it applies to (R5, R12, R15, R163). */
export interface PainCaps {
  /** 80 under a mild-pain rule, 90 under 18 (R1). */
  intensityPct?: number;
  /** The cap binds only these attributes, never the whole session. */
  scopedTo: CappedAttribute[];
}

/** Volume cuts a pain rule imposes (R4, R8, R9). */
export interface PainVolumeCuts {
  /** R8, R9: cut pogo and sprint volume by this percent. */
  pogoSprintPct?: number;
  /** R4: halve high-intensity contacts. */
  highIntensityFactor?: number;
  /** R18: drop plyometric intensity by one tier. */
  intensityTierDown?: boolean;
}

/** The clearance screen the athlete is routed to, when one applies. */
export interface ClearanceScreen {
  /**
   * `self_screen` is the general PAR-Q+ failure and is the only one that
   * blocks generation; `severe_pain` shows two choices and the exclusions
   * apply either way (brief 16 "Defaults asserted").
   */
  kind: 'self_screen' | 'severe_pain';
  location?: PainLocation;
  /** The exact sentence the screen shows (brief section 05 "Medical clearance"). */
  sentence: string;
}

/** The whole Block 1 verdict. */
export interface PainGateResult {
  /** True only for a general self-screen failure (R2). */
  blocksGeneration: boolean;
  clearanceScreen: ClearanceScreen | null;
  exclusions: PainExclusions;
  caps: PainCaps;
  volumeCuts: PainVolumeCuts;
  /** R78 to R80 protocols this athlete must carry every week. */
  tendonProtocols: TendonTarget[];
  /** Set when a house template (hamstring, hip, other) supplied the rules. */
  houseRule?: HouseRule;
  /** The day-14 reassessment: re-ask duration so chronic is never assumed. */
  reassessDueDays?: number;
  /** True when any exclusion, cap or cut is live: the Plan says so. */
  restricted: boolean;
  /** Plain-words lines for the Plan rules summary, one per applied rule. */
  lines: string[];
}
