/**
 * Block 1, which runs first and which nothing else may loosen (Rule 0, R28).
 *
 * Severity 1-2 is mild, 3-4 moderate, 5+ severe; duration under 12 weeks is
 * acute, otherwise chronic (ICD-11), re-asked at the day-14 reassessment so
 * "chronic by definition" is never assumed.
 *
 * Knee, shin, back, shoulder and Achilles follow R3 to R18 with their
 * exclusions, plyometric gating, 80 percent caps and tendon protocols. The
 * joint-stress exclusions R20 to R22 apply at any severity, which the Plan
 * summary explains. Moderate knee pain halves high-intensity contacts (R4);
 * shin splints cut pogo and sprint volume and exclude high-impact plyometrics
 * (R8, R9); Achilles pain removes plyometrics, or removes high-intensity
 * plyometrics with isometric priority and R100 progression, or drops one
 * intensity tier with tendon work (R16 to R18). Hamstring, hip and other use a
 * house template labelled as such. Severe anywhere shows the clearance screen;
 * only the general self-screen blocks generation. Pain changes apply from the
 * next unlogged session.
 */
import { addDays, diffDays } from '../calendar.js';
import {
  applyAchilles,
  applyBack,
  applyFinger,
  applyHamstring,
  applyHip,
  applyKnee,
  applyOther,
  applyShin,
  applyShoulder,
  capAttribute,
  emptyExclusions,
  pushUnique,
  SELF_SCREEN_SENTENCE,
  severePainSentence,
} from './painTemplates.js';
import type { Accumulator } from './painTemplates.js';

export { SELF_SCREEN_SENTENCE, severePainSentence } from './painTemplates.js';
import type { ClearanceAnswers, PainStatus } from '../types/athlete.js';
import type { LocalDate } from '../types/calendar.js';
import type {
  MovementPattern,
  PainDuration,
  PainLocation,
  PainSeverity,
  PainSeverityRaw,
} from '../types/core.js';
import type { CappedAttribute, ClearanceScreen, PainCaps, PainGateResult } from '../types/pain.js';
import type { Ruleset } from '../types/ruleset.js';

/** The answers Block 1 reads: the seven PAR-Q+ questions and every pain site. */
export interface PainGateAnswers {
  clearance: ClearanceAnswers;
  painStatus: PainStatus[];
  /** R1: under 18 caps maximal loading at 90 percent effort. */
  isAdult: boolean;
  /** For the R6 two-week window and the day-14 reassessment. */
  today: LocalDate;
  /**
   * True when the athlete chose "Build the restricted plan anyway" at a severe
   * site. The exclusions apply either way; this only flags the Plan.
   */
  buildAnyway?: boolean;
}

/**
 * INTERFACE_GAP: `PainCaps` carries one percent and a list of attributes, so a
 * global R1 cap and a scoped R163 cap cannot be told apart, and no closed
 * attribute covers the house hamstring and hip templates. These extras keep
 * the exact per-attribute and per-pattern caps beside the contract shape.
 */
export type RequiredWeeklyWork =
  | 'knee_prehab'
  | 'core_stability'
  | 'scapular_stability'
  | 'hip_mobility'
  | 'hamstring_eccentric'
  | 'calf_tendon';

/** One cap and the exercise attribute it binds (R163). */
export interface AttributeCap {
  attribute: CappedAttribute;
  pct: number;
  reason: string;
}

/** One cap and the movement patterns it binds (house hamstring and hip rules). */
export interface PatternCap {
  patterns: MovementPattern[];
  pct: number;
  reason: string;
}

/** What was actually in force today, after R6 promoted mild acute pain. */
export interface AppliedPain {
  location: PainLocation;
  severity: PainSeverity;
  duration: PainDuration;
  /** True when R6 raised mild acute pain to moderate for two weeks. */
  promotedByR6: boolean;
}

/** The Block 1 verdict plus the extras the closed core types cannot carry. */
export interface PainGateResultWithExtras extends PainGateResult {
  attributeCaps: AttributeCap[];
  patternCaps: PatternCap[];
  requiredWeekly: RequiredWeeklyWork[];
  applied: AppliedPain[];
  /** House: the owner chose to build with severe pain on file. */
  buildAnyway: boolean;
}

/** 1-2 mild, 3-4 moderate, 5+ severe (brief section 09 "Pain gate"). */
export function deriveSeverity(raw: PainSeverityRaw): PainSeverity {
  switch (raw) {
    case '1-2':
      return 'mild';
    case '3-4':
      return 'moderate';
    case '5+':
      return 'severe';
  }
}

/** Under 12 weeks is acute, otherwise chronic (ICD-11). */
export function deriveDuration(weeks: number, acuteMaxWeeks = 12): PainDuration {
  return weeks < acuteMaxWeeks ? 'acute' : 'chronic';
}

/**
 * R6: mild acute pain is treated as moderate for two weeks, then the athlete
 * is re-prompted. Returns the severity in force today.
 */
export function effectiveSeverity(status: PainStatus, today: LocalDate, ruleset: Ruleset): PainSeverity {
  if (status.severity !== 'mild' || status.duration !== 'acute') return status.severity;
  const windowEnd = addDays(status.reportedAt, ruleset.constants.painCaps.moderateAsMildWeeks * 7);
  return diffDays(today, windowEnd) >= 0 ? 'moderate' : 'mild';
}

/**
 * True when any of the seven screening questions is yes and no clinician
 * clearance is on file. The only condition that blocks generation (R2).
 */
export function selfScreenFails(clearance: ClearanceAnswers): boolean {
  const anyYes =
    clearance.heartCondition ||
    clearance.chestPain ||
    clearance.dizziness ||
    clearance.chronicCondition ||
    clearance.prescriptionMedication ||
    clearance.boneOrJointProblem ||
    clearance.supervisedActivityOnly;
  return anyYes && clearance.clearedByClinicianAt === undefined;
}

function isRestricted(acc: Accumulator): boolean {
  const e = acc.exclusions;
  const anyExclusion =
    e.kneeHigh || e.spineHigh || e.shoulderHigh || e.allPlyo || e.highIntensityPlyo ||
    e.highImpactPlyo || e.repetitiveImpact || e.overhead || e.pressing || e.axialHeavy ||
    e.axialAll || e.allKneeStress || e.allSpineStress || e.excludedPatterns.length > 0;
  const anyCut =
    acc.volumeCuts.pogoSprintPct !== undefined ||
    acc.volumeCuts.highIntensityFactor !== undefined ||
    acc.volumeCuts.intensityTierDown === true;
  return anyExclusion || anyCut || acc.attributeCaps.length > 0 || acc.patternCaps.length > 0;
}

function collapseCaps(attributeCaps: AttributeCap[]): PainCaps {
  if (attributeCaps.length === 0) return { scopedTo: [] };
  let lowest = attributeCaps[0]?.pct ?? 100;
  const scopedTo: CappedAttribute[] = [];
  for (const cap of attributeCaps) {
    if (cap.pct < lowest) lowest = cap.pct;
    pushUnique(scopedTo, cap.attribute);
  }
  return { intensityPct: lowest, scopedTo };
}

/**
 * The whole Block 1 verdict: what is excluded, what is capped and to which
 * attributes, what volume is cut, which tendon protocols must run every week,
 * and whether a clearance screen shows.
 */
export function evaluatePainGate(answers: PainGateAnswers, ruleset: Ruleset): PainGateResultWithExtras {
  const constants = ruleset.constants.painCaps;
  const acc: Accumulator = {
    exclusions: emptyExclusions(),
    attributeCaps: [],
    patternCaps: [],
    volumeCuts: {},
    tendonProtocols: [],
    requiredWeekly: [],
    lines: [],
    houseRules: [],
    severe: null,
  };
  const applied: AppliedPain[] = [];
  const mild = constants.mildIntensityCapPct;

  const active = answers.painStatus.filter((status) => status.clearedAt === undefined);
  for (const status of active) {
    const severity = effectiveSeverity(status, answers.today, ruleset);
    applied.push({
      location: status.location,
      severity,
      duration: status.duration,
      promotedByR6: severity !== status.severity,
    });
    switch (status.location) {
      case 'knee':
        applyKnee(acc, severity, mild, constants.moderateKneeHighIntensityFactor);
        break;
      case 'shin':
        applyShin(acc, severity, constants.shinModeratePct, constants.shinMildPct);
        break;
      case 'back':
        applyBack(acc, severity, mild);
        break;
      case 'shoulder':
        applyShoulder(acc, severity, mild);
        break;
      case 'achilles_calf':
        applyAchilles(acc, severity);
        break;
      case 'hamstring':
        applyHamstring(acc, severity, ruleset, mild);
        break;
      case 'hip':
        applyHip(acc, severity, ruleset, mild);
        break;
      case 'finger':
        applyFinger(acc, severity, ruleset, mild);
        break;
      case 'other':
        applyOther(acc, severity, ruleset, mild);
        break;
    }
  }

  if (!answers.isAdult) {
    capAttribute(acc, 'all', constants.under18CapPct, 'under 18');
    acc.lines.push('Under 18: nothing is prescribed above 90 percent effort.');
  }

  const blocksGeneration = selfScreenFails(answers.clearance);
  let clearanceScreen: ClearanceScreen | null = null;
  if (blocksGeneration) {
    clearanceScreen = { kind: 'self_screen', sentence: SELF_SCREEN_SENTENCE };
  } else if (acc.severe !== null) {
    clearanceScreen = {
      kind: 'severe_pain',
      location: acc.severe,
      sentence: severePainSentence(acc.severe),
    };
  }

  const result: PainGateResultWithExtras = {
    blocksGeneration,
    clearanceScreen,
    exclusions: acc.exclusions,
    caps: collapseCaps(acc.attributeCaps),
    volumeCuts: acc.volumeCuts,
    tendonProtocols: acc.tendonProtocols,
    restricted: isRestricted(acc),
    lines: acc.lines,
    attributeCaps: acc.attributeCaps,
    patternCaps: acc.patternCaps,
    requiredWeekly: acc.requiredWeekly,
    applied,
    buildAnyway: answers.buildAnyway === true && acc.severe !== null,
  };
  const firstHouseRule = acc.houseRules[0];
  if (firstHouseRule !== undefined) result.houseRule = firstHouseRule;
  if (active.length > 0) result.reassessDueDays = constants.reassessDays;
  return result;
}

/**
 * The pain cap that binds one exercise, or undefined when none does. Block 6
 * takes the lowest of this, R154, R1 and the week-2 guard (R163).
 */
export function painCapPctFor(
  gate: PainGateResultWithExtras,
  exercise: {
    kneeStress: string;
    spineStress: string;
    shoulderStress: string;
    isAxialLoad: boolean;
    isPressing: boolean;
    isOverhead: boolean;
    movementPattern: MovementPattern;
  },
): number | undefined {
  const candidates: number[] = [];
  for (const cap of gate.attributeCaps) {
    const binds =
      (cap.attribute === 'all') ||
      (cap.attribute === 'knee_stress' && exercise.kneeStress !== 'low') ||
      (cap.attribute === 'spine_stress' && exercise.spineStress !== 'low') ||
      (cap.attribute === 'shoulder_stress' && exercise.shoulderStress !== 'low') ||
      (cap.attribute === 'axial_load' && exercise.isAxialLoad) ||
      (cap.attribute === 'pressing' && exercise.isPressing) ||
      (cap.attribute === 'overhead' && exercise.isOverhead);
    if (binds) candidates.push(cap.pct);
  }
  for (const cap of gate.patternCaps) {
    if (cap.patterns.includes(exercise.movementPattern)) candidates.push(cap.pct);
  }
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}
